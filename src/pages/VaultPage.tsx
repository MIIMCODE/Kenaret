import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Spinner from '../components/Spinner'
import { addVaultNote, addVaultPhoto, deleteVaultItem, fetchCurrentCouple, fetchVaultItems, fetchVaultState, setupVault } from '../lib/api'
import { toPersianError } from '../lib/errors'
import { toPersianDigits } from '../lib/jalali'
import { supabase } from '../lib/supabase'
import {
  createVault,
  openVault,
  openBytes,
  openText,
  sealBytes,
  sealText,
  type VaultSession,
} from '../lib/vault'
import { useAuth } from '../hooks/useAuth'
import type { VaultItem, VaultState } from '../types/database'

/**
 * فضای خصوصی.
 *
 * A room with different air. Everything the rest of the app is — cream, blush,
 * rounded cards, a header with bells — stops at the door. Inside it is dark,
 * warm, and quiet, and the only thing on the screen is what the two of you put
 * there. That change of atmosphere is not decoration: it is the signal that
 * you have stepped out of the shared, glanceable part of the app.
 *
 * The lock is real (see `src/lib/vault.ts`): the PIN never leaves the device,
 * the server stores only wrapped keys and ciphertext, and a lost PIN is a lost
 * room. The copy says so — twice, before anyone commits.
 */

const BACKDROP =
  'radial-gradient(120% 90% at 50% -20%, #3b1f2e 0%, #1b1016 45%, #120a0e 100%)'

type Phase = 'loading' | 'locked' | 'open'

interface Decoded {
  item: VaultItem
  text: string | null
  /** Object URL for a decrypted photo. Revoked when the room closes. */
  url: string | null
}

export default function VaultPage() {
  const { user } = useAuth()
  const navigate = useNavigate()

  const [phase, setPhase] = useState<Phase>('loading')
  const [state, setState] = useState<VaultState | null>(null)
  const [session, setSession] = useState<VaultSession | null>(null)
  const [items, setItems] = useState<Decoded[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // setup
  const [pin, setPin] = useState('')
  const [pin2, setPin2] = useState('')
  const [acknowledged, setAcknowledged] = useState(false)

  // composing
  const [mode, setMode] = useState<'none' | 'note' | 'photo'>('none')
  const [noteText, setNoteText] = useState('')
  const [photoCaption, setPhotoCaption] = useState('')
  const [pendingPhoto, setPendingPhoto] = useState<File | null>(null)

  const [viewing, setViewing] = useState<Decoded | null>(null)
  const fileInput = useRef<HTMLInputElement | null>(null)
  const partner = useRef<{ id: string; name: string } | null>(null)
  const coupleId = useRef<string | null>(null)

  // ---------------------------------------------------------------- loading
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [vault, couple] = await Promise.all([fetchVaultState(), fetchCurrentCouple()])
        if (cancelled) return
        coupleId.current = couple?.id ?? null
        partner.current = couple ? { id: couple.partner_id, name: 'او' } : null
        setState(vault)
        setPhase('locked')
      } catch (e) {
        if (!cancelled) {
          setError(toPersianError(e))
          setPhase('locked')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  /** Decrypts a page of rows. A row that fails is shown as unreadable, not dropped. */
  const decode = useCallback(
    async (key: VaultSession, rows: VaultItem[]): Promise<Decoded[]> => {
      const out: Decoded[] = []
      for (const item of rows) {
        let text: string | null = null
        let url: string | null = null
        try {
          if (item.body_cipher && item.body_iv) {
            text = await openText(key, item.body_cipher, item.body_iv)
          }
          if (item.kind === 'photo' && item.storage_path && item.media_iv) {
            const { data, error: downloadError } = await supabase.storage
              .from('vault')
              .download(item.storage_path)
            if (!downloadError && data) {
              const plain = await openBytes(key, await data.arrayBuffer(), item.media_iv)
              url = URL.createObjectURL(new Blob([plain]))
            }
          }
        } catch {
          // Someone changed the key material, or a file was tampered with.
          // Showing a lock instead of a broken image keeps the room calm.
          text = null
          url = null
        }
        out.push({ item, text, url })
      }
      return out
    },
    [],
  )

  const load = useCallback(
    async (key: VaultSession) => {
      const rows = await fetchVaultItems()
      return decode(key, rows)
    },
    [decode],
  )

  // ---------------------------------------------------------------- open
  async function handleOpen(e: React.FormEvent) {
    e.preventDefault()
    if (!state?.configured) return
    setBusy(true)
    setError(null)
    try {
      const opened = await openVault(pin, {
        kdf_salt: state.kdf_salt ?? '',
        kdf_iters: state.kdf_iters ?? 310000,
        wrap_iv: state.wrap_iv ?? '',
        wrapped_key: state.wrapped_key ?? '',
      })
      if (!opened) {
        setError('این رمز این اتاق را باز نمی‌کند.')
        return
      }
      const decoded = await load(opened)
      setSession(opened)
      setItems(decoded)
      setPin('')
      setPhase('open')
    } catch (err) {
      setError(toPersianError(err))
    } finally {
      setBusy(false)
    }
  }

  // ---------------------------------------------------------------- setup
  async function handleSetup(e: React.FormEvent) {
    e.preventDefault()
    if (pin.length < 6) {
      setError('رمز حداقل ۶ کاراکتر باشد.')
      return
    }
    if (pin !== pin2) {
      setError('دو رمز با هم یکی نیستند.')
      return
    }
    if (!acknowledged) {
      setError('برای ادامه باید تأیید کنی که از دست رفتن رمز یعنی از دست رفتن همه‌چیز.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const created = await createVault(pin)
      await setupVault(created.material)
      setSession(created.session)
      setItems([])
      setPin('')
      setPin2('')
      setPhase('open')
      setState((prev) => ({ ...(prev as VaultState), configured: true, items: 0 }))
    } catch (err) {
      setError(toPersianError(err))
    } finally {
      setBusy(false)
    }
  }

  /** Closing the room must also drop every decrypted image from memory. */
  const close = useCallback(() => {
    items.forEach((d) => d.url && URL.revokeObjectURL(d.url))
    setViewing(null)
    setItems([])
    setSession(null)
    setPhase('locked')
  }, [items])

  useEffect(() => {
    return () => {
      items.forEach((d) => d.url && URL.revokeObjectURL(d.url))
    }
  }, [items])

  // ---------------------------------------------------------------- write
  async function saveNote(e: React.FormEvent) {
    e.preventDefault()
    if (!session) return
    const body = noteText.trim()
    if (!body) return
    setBusy(true)
    setError(null)
    try {
      const sealed = await sealText(session, body)
      const { id } = await addVaultNote({ body: sealed.cipher, bodyIv: sealed.iv })
      const now = new Date().toISOString()
      setItems((prev) => [
        {
          item: {
            id,
            user_id: user?.id ?? '',
            kind: 'note',
            storage_path: null,
            media_iv: null,
            body_cipher: sealed.cipher,
            body_iv: sealed.iv,
            width: null,
            height: null,
            created_at: now,
          },
          text: body,
          url: null,
        },
        ...prev,
      ])
      setNoteText('')
      setMode('none')
    } catch (err) {
      setError(toPersianError(err))
    } finally {
      setBusy(false)
    }
  }

  async function savePhoto(e: React.FormEvent) {
    e.preventDefault()
    if (!session || !pendingPhoto) return
    const cid = coupleId.current
    if (!cid) {
      setError('ارتباط فعالی پیدا نشد.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const bytes = new Uint8Array(await pendingPhoto.arrayBuffer())
      const sealedFile = await sealBytes(session, bytes)

      const path = `${cid}/${crypto.randomUUID()}.enc`
      const { error: uploadError } = await supabase.storage
        .from('vault')
        .upload(path, new Blob([sealedFile.cipher], { type: 'application/octet-stream' }), {
          contentType: 'application/octet-stream',
          cacheControl: '31536000',
          upsert: false,
        })
      if (uploadError) throw uploadError

      let bodyCipher: string | null = null
      let bodyIv: string | null = null
      const caption = photoCaption.trim()
      if (caption) {
        const sealedCaption = await sealText(session, caption)
        bodyCipher = sealedCaption.cipher
        bodyIv = sealedCaption.iv
      }

      const size = await imageSize(pendingPhoto)
      const { id } = await addVaultPhoto({
        path,
        mediaIv: sealedFile.iv,
        body: bodyCipher,
        bodyIv,
        width: size?.width ?? null,
        height: size?.height ?? null,
      })

      // Show it immediately from the bytes we still have, so the new photograph
      // does not make a round trip back through storage to appear.
      const url = URL.createObjectURL(new Blob([bytes.slice().buffer]))
      setItems((prev) => [
        {
          item: {
            id,
            user_id: user?.id ?? '',
            kind: 'photo',
            storage_path: path,
            media_iv: sealedFile.iv,
            body_cipher: bodyCipher,
            body_iv: bodyIv,
            width: size?.width ?? null,
            height: size?.height ?? null,
            created_at: new Date().toISOString(),
          },
          text: caption || null,
          url,
        },
        ...prev,
      ])
      setPendingPhoto(null)
      setPhotoCaption('')
      setMode('none')
    } catch (err) {
      setError(toPersianError(err))
    } finally {
      setBusy(false)
    }
  }

  async function remove(target: Decoded) {
    if (!confirm('این را برای همیشه پاک کنیم؟')) return
    setBusy(true)
    try {
      const path = await deleteVaultItem(target.item.id)
      if (path) {
        // The row is gone either way; the ciphertext blob is unreachable noise
        // after this, so a failure here is not worth surfacing to the user.
        await supabase.storage.from('vault').remove([path])
      }
      target.url && URL.revokeObjectURL(target.url)
      setItems((prev) => prev.filter((d) => d.item.id !== target.item.id))
      setViewing(null)
    } catch (err) {
      setError(toPersianError(err))
    } finally {
      setBusy(false)
    }
  }

  const mine = useMemo(() => new Set([user?.id ?? '']), [user?.id])

  // ---------------------------------------------------------------- render
  if (phase === 'loading') {
    return (
      <div className="flex min-h-dvh items-center justify-center" style={{ background: BACKDROP }}>
        <Spinner />
      </div>
    )
  }

  return (
    <div
      className="relative min-h-dvh w-full overflow-x-hidden text-[#f4e7e2]"
      style={{ background: BACKDROP }}
    >
      {/* a single slow ember, so the room is never quite still */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[45vh] opacity-40"
        style={{
          background:
            'radial-gradient(50% 60% at 50% 0%, rgba(255,168,190,0.30) 0%, transparent 70%)',
        }}
      />

      <div className="relative mx-auto w-full max-w-md px-5 pb-28 pt-5">
        <button
          type="button"
          onClick={() => (phase === 'open' ? close() : navigate('/app'))}
          className="mb-6 flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-white/5 text-[#f4e7e2]/70 transition hover:bg-white/10"
          aria-label={phase === 'open' ? 'قفل کردن اتاق' : 'بازگشت'}
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M9 5l7 7-7 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        {phase === 'locked' && !state?.configured && (
          <SetupRoom
            pin={pin}
            pin2={pin2}
            setPin={setPin}
            setPin2={setPin2}
            acknowledged={acknowledged}
            setAcknowledged={setAcknowledged}
            busy={busy}
            onSubmit={handleSetup}
          />
        )}

        {phase === 'locked' && state?.configured && (
          <LockDoor
            pin={pin}
            setPin={setPin}
            busy={busy}
            items={state.items}
            onSubmit={handleOpen}
          />
        )}

        {phase === 'open' && (
          <>
            <header className="mb-6">
              <p className="text-[11px] tracking-[0.3em] text-[#e7a1b6]/70">فقط برای ما دو نفر</p>
              <h1 className="mt-1.5 text-2xl font-bold">اینجا جای دیگری است</h1>
              <p className="mt-1 text-[12.5px] leading-6 text-[#f4e7e2]/50">
                هر چه اینجاست، پیش از رسیدن به سرور رمز شده. هیچ‌کس — نه ما، نه کس دیگری —
                نمی‌تواند ببیندش.
              </p>
            </header>

            <div className="mb-6 flex gap-2.5">
              <button
                type="button"
                onClick={() => {
                  setMode('note')
                  setPendingPhoto(null)
                }}
                className="flex-1 rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3 text-[12.5px] font-bold transition hover:bg-white/[0.10]"
              >
                یک نوشته
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('photo')
                  setNoteText('')
                }}
                className="flex-1 rounded-2xl border border-[#f0a8be]/30 bg-[#f0a8be]/15 px-4 py-3 text-[12.5px] font-bold text-[#ffd7e1] transition hover:bg-[#f0a8be]/25"
              >
                یک عکس
              </button>
            </div>

            {mode === 'note' && (
              <form onSubmit={saveNote} className="mb-6 rounded-3xl border border-white/10 bg-white/[0.05] p-4">
                <textarea
                  autoFocus
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  rows={5}
                  maxLength={4000}
                  placeholder="چیزی که فقط او باید بخواند…"
                  className="w-full resize-none bg-transparent text-[14px] leading-7 text-[#f8ece8] outline-none placeholder:text-[#f4e7e2]/30"
                />
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-[10.5px] text-[#f4e7e2]/30">
                    {toPersianDigits(noteText.length)} / {toPersianDigits(4000)}
                  </span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setMode('none')
                        setNoteText('')
                      }}
                      className="rounded-xl px-3 py-2 text-[12px] text-[#f4e7e2]/50"
                    >
                      بی‌خیال
                    </button>
                    <button
                      type="submit"
                      disabled={busy || !noteText.trim()}
                      className="rounded-xl bg-[#f0a8be] px-4 py-2 text-[12px] font-bold text-[#2a1420] disabled:opacity-40"
                    >
                      {busy ? 'دارد قفل می‌شود…' : 'قفل کن و بگذار'}
                    </button>
                  </div>
                </div>
              </form>
            )}

            {mode === 'photo' && (
              <form onSubmit={savePhoto} className="mb-6 rounded-3xl border border-white/10 bg-white/[0.05] p-4">
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => setPendingPhoto(e.target.files?.[0] ?? null)}
                />
                <button
                  type="button"
                  onClick={() => fileInput.current?.click()}
                  className="flex w-full items-center justify-center rounded-2xl border border-dashed border-white/20 py-8 text-[12.5px] text-[#f4e7e2]/60"
                >
                  {pendingPhoto
                    ? `${pendingPhoto.name} — ${toPersianDigits(Math.round(pendingPhoto.size / 1024))} کیلوبایت`
                    : 'یک عکس انتخاب کن'}
                </button>
                <input
                  value={photoCaption}
                  onChange={(e) => setPhotoCaption(e.target.value)}
                  maxLength={300}
                  placeholder="یک جمله همراهش… (اختیاری)"
                  className="mt-3 w-full bg-transparent text-[13px] text-[#f8ece8] outline-none placeholder:text-[#f4e7e2]/30"
                />
                <div className="mt-3 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setMode('none')
                      setPendingPhoto(null)
                      setPhotoCaption('')
                    }}
                    className="rounded-xl px-3 py-2 text-[12px] text-[#f4e7e2]/50"
                  >
                    بی‌خیال
                  </button>
                  <button
                    type="submit"
                    disabled={busy || !pendingPhoto}
                    className="rounded-xl bg-[#f0a8be] px-4 py-2 text-[12px] font-bold text-[#2a1420] disabled:opacity-40"
                  >
                    {busy ? 'دارد قفل می‌شود…' : 'قفل کن و بگذار'}
                  </button>
                </div>
              </form>
            )}

            {items.length === 0 ? (
              <div className="rounded-3xl border border-white/10 bg-white/[0.03] px-6 py-14 text-center">
                <p className="text-[13px] leading-7 text-[#f4e7e2]/45">
                  هنوز خالی است.
                  <br />
                  اولین چیزی که فقط مال خودتان است را بگذارید.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {items.map((d) => (
                  <Tile
                    key={d.item.id}
                    decoded={d}
                    mine={mine.has(d.item.user_id)}
                    onOpen={() => setViewing(d)}
                  />
                ))}
              </div>
            )}
          </>
        )}

        {error && (
          <p className="mt-4 rounded-2xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-[12px] leading-6 text-red-200">
            {error}
          </p>
        )}
      </div>

      {viewing && <Viewer decoded={viewing} onClose={() => setViewing(null)} onDelete={() => void remove(viewing)} />}
    </div>
  )
}

// ---------------------------------------------------------------- door: setup
function SetupRoom(props: {
  pin: string
  pin2: string
  setPin: (v: string) => void
  setPin2: (v: string) => void
  acknowledged: boolean
  setAcknowledged: (v: boolean) => void
  busy: boolean
  onSubmit: (e: React.FormEvent) => void
}) {
  return (
    <form onSubmit={props.onSubmit}>
      <div className="mb-7 text-center">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full border border-[#f0a8be]/30 bg-[#f0a8be]/10">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <rect x="4.5" y="10" width="15" height="10" rx="3" stroke="#f4c3d1" strokeWidth="1.6" />
            <path d="M8 10V7.5a4 4 0 0 1 8 0V10" stroke="#f4c3d1" strokeWidth="1.6" strokeLinecap="round" />
            <circle cx="12" cy="15" r="1.3" fill="#f4c3d1" />
          </svg>
        </div>
        <h1 className="text-[19px] font-bold">یک اتاق بسازید که فقط شما دو نفر کلیدش را دارید</h1>
        <p className="mt-2 text-[12.5px] leading-6 text-[#f4e7e2]/50">
          یک رمز انتخاب کنید. این رمز روی هیچ سروری ذخیره نمی‌شود؛ فقط با آن می‌شود قفل را باز
          کرد.
        </p>
      </div>

      <label className="mb-1.5 block text-[11.5px] text-[#f4e7e2]/50">رمز اتاق</label>
      <input
        type="password"
        value={props.pin}
        onChange={(e) => props.setPin(e.target.value)}
        autoComplete="new-password"
        dir="ltr"
        className="mb-3 w-full rounded-2xl border border-white/15 bg-white/[0.06] px-4 py-3 text-center text-[15px] tracking-[0.3em] text-[#f8ece8] outline-none focus:border-[#f0a8be]/50"
      />

      <label className="mb-1.5 block text-[11.5px] text-[#f4e7e2]/50">همان رمز، دوباره</label>
      <input
        type="password"
        value={props.pin2}
        onChange={(e) => props.setPin2(e.target.value)}
        autoComplete="new-password"
        dir="ltr"
        className="mb-5 w-full rounded-2xl border border-white/15 bg-white/[0.06] px-4 py-3 text-center text-[15px] tracking-[0.3em] text-[#f8ece8] outline-none focus:border-[#f0a8be]/50"
      />

      <button
        type="button"
        onClick={() => props.setAcknowledged(!props.acknowledged)}
        className={`mb-5 flex w-full items-start gap-3 rounded-2xl border p-3.5 text-right transition ${
          props.acknowledged ? 'border-[#f0a8be]/40 bg-[#f0a8be]/10' : 'border-white/10 bg-white/[0.03]'
        }`}
      >
        <span
          className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${
            props.acknowledged ? 'border-[#f0a8be] bg-[#f0a8be]' : 'border-white/25'
          }`}
        >
          {props.acknowledged && (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M5 12.5l4.5 4.5L19 7" stroke="#2a1420" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </span>
        <span className="text-[11.5px] leading-6 text-[#f4e7e2]/70">
          می‌دانم اگر این رمز را فراموش کنیم، هیچ راهی برای بازیابی نیست — نه با ایمیل، نه به
          دست ما. محتوای این اتاق آن‌قدر رمز شده که خودمان هم نمی‌توانیم بخوانیمش.
        </span>
      </button>

      <button
        type="submit"
        disabled={props.busy}
        className="w-full rounded-2xl bg-[#f0a8be] py-3.5 text-[13.5px] font-bold text-[#2a1420] transition active:scale-[0.99] disabled:opacity-50"
      >
        {props.busy ? 'دارد ساخته می‌شود…' : 'اتاق را بساز'}
      </button>
    </form>
  )
}

// ---------------------------------------------------------------- door: locked
function LockDoor(props: {
  pin: string
  setPin: (v: string) => void
  busy: boolean
  items: number
  onSubmit: (e: React.FormEvent) => void
}) {
  return (
    <form onSubmit={props.onSubmit} className="pt-6 text-center">
      <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full border border-[#f0a8be]/25 bg-[#f0a8be]/[0.08]">
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect x="4.5" y="10" width="15" height="10" rx="3" stroke="#f4c3d1" strokeWidth="1.5" />
          <path d="M8 10V7.5a4 4 0 0 1 8 0V10" stroke="#f4c3d1" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="12" cy="15" r="1.2" fill="#f4c3d1" />
        </svg>
      </div>

      <h1 className="text-[19px] font-bold">اتاق قفل است</h1>
      <p className="mt-2 text-[12.5px] leading-6 text-[#f4e7e2]/50">
        {props.items > 0
          ? `${toPersianDigits(props.items)} چیز داخلش هست، به‌انتظار رمز شما.`
          : 'رمز اتاق را وارد کنید.'}
      </p>

      <input
        type="password"
        value={props.pin}
        onChange={(e) => props.setPin(e.target.value)}
        autoComplete="current-password"
        dir="ltr"
        placeholder="••••••"
        className="my-6 w-full rounded-2xl border border-white/15 bg-white/[0.06] px-4 py-3.5 text-center text-[16px] tracking-[0.35em] text-[#f8ece8] outline-none focus:border-[#f0a8be]/50"
      />

      <button
        type="submit"
        disabled={props.busy || !props.pin}
        className="w-full rounded-2xl bg-[#f0a8be] py-3.5 text-[13.5px] font-bold text-[#2a1420] disabled:opacity-50"
      >
        {props.busy ? 'دارد باز می‌شود…' : 'باز کن'}
      </button>

      <p className="mt-6 text-[11px] leading-6 text-[#f4e7e2]/30">
        رمز فقط روی دستگاه خودت بررسی می‌شود. جایی ذخیره نشده که یادآوری‌اش کنیم.
      </p>
    </form>
  )
}

// ---------------------------------------------------------------- tile
function Tile({ decoded, mine, onOpen }: { decoded: Decoded; mine: boolean; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group relative aspect-[3/4] overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] text-right transition hover:border-white/20"
    >
      {decoded.url ? (
        <img src={decoded.url} alt="" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full flex-col justify-between p-3.5">
          <span className="text-[15px] leading-7 text-[#f8ece8]/85">
            {decoded.text ? (
              <>
                {decoded.text.length > 90 ? `${decoded.text.slice(0, 90)}…` : decoded.text}
              </>
            ) : (
              <span className="text-[#f4e7e2]/25">قفل‌شده</span>
            )}
          </span>
          <span className="text-[10px] text-[#f4e7e2]/25">
            {mine ? 'از تو' : 'از او'}
          </span>
        </div>
      )}
      {decoded.url && (
        <span className="absolute bottom-2 right-2 rounded-full bg-black/45 px-2 py-0.5 text-[9.5px] text-white/75">
          {mine ? 'از تو' : 'از او'}
        </span>
      )}
    </button>
  )
}

// ---------------------------------------------------------------- viewer
function Viewer({ decoded, onClose, onDelete }: { decoded: Decoded; onClose: () => void; onDelete: () => void }) {
  /*
    A near-black lightbox, not a glass sheet: the whole point of this screen is
    to show a photo with nothing on top of it, so the surface stays dark and
    flat. `/97` used to sit on the colour here and Tailwind silently generated
    nothing for that step — the overlay was fully transparent in production.
    Solid colour, no opacity modifier.
  */
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#0c0609] backdrop-blur-sm">
      <div className="flex items-center justify-between px-5 py-4">
        <button type="button" onClick={onClose} className="text-[12.5px] text-[#f4e7e2]/60" aria-label="بستن">
          بستن
        </button>
        <button type="button" onClick={onDelete} className="text-[12.5px] text-red-300/80">
          پاک کردن
        </button>
      </div>
      <div className="flex flex-1 items-center justify-center px-5 pb-6">
        {decoded.url ? (
          <img src={decoded.url} alt="" className="max-h-full max-w-full rounded-2xl object-contain" />
        ) : (
          <p className="max-w-sm whitespace-pre-wrap text-center text-[15px] leading-8 text-[#f8ece8]">
            {decoded.text}
          </p>
        )}
      </div>
      {decoded.url && decoded.text && (
        <p className="px-6 pb-8 text-center text-[13px] leading-7 text-[#f4e7e2]/60">{decoded.text}</p>
      )}
    </div>
  )
}

async function imageSize(file: File): Promise<{ width: number; height: number } | null> {
  try {
    const bitmap = await createImageBitmap(file)
    const size = { width: bitmap.width, height: bitmap.height }
    bitmap.close?.()
    return size
  } catch {
    return null
  }
}
