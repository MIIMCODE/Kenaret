import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import AppHeader from '../components/AppHeader'
import Avatar from '../components/Avatar'
import Spinner from '../components/Spinner'
import {
  deleteMessage,
  editMessage,
  fetchMessages,
  fetchCurrentCouple,
  fetchPairingState,
  markMessagesRead,
  sendImage,
  sendMessage,
} from '../lib/api'
import {
  dayLabel,
  formatTime,
  readImageSize,
  resolveChatImage,
  uploadChatImage,
  validateChatImage,
} from '../lib/chat'
import { toPersianError } from '../lib/errors'
import { useAuth } from '../hooks/useAuth'
import type { ChatMessage } from '../types/database'

/**
 * گفت‌وگو — the chat screen.
 *
 * A few deliberate decisions, because a chat between two people is easy to
 * get subtly wrong:
 *
 * · **The list is newest-first in state, oldest-first on screen.** The server
 *   pages backwards from a cursor, which is the only shape that stays cheap
 *   when the thread is a year old. The render reverses it.
 *
 * · **Read receipts are sent, not inferred.** Opening the screen marks
 *   everything up to the newest message; that is what makes the partner's
 *   ticks turn. Nothing is marked while the tab is hidden, so a background
 *   phone does not silently swallow «دیده شد».
 *
 * · **Sending is optimistic but honest.** The bubble appears immediately with
 *   a clock, becomes a check when the server confirms, and on failure turns
 *   into a red «دوباره» you can tap — the text is never lost.
 *
 * · **Polling, not websockets.** A couple sends a handful of messages a day.
 *   A 6-second poll while the screen is visible costs almost nothing and
 *   cannot get stuck in a half-open socket on a phone that slept. Push covers
 *   the case where the screen is closed.
 */

const POLL_MS = 6000
const PAGE_SIZE = 30

type Draft = {
  body: string
  replyTo: ChatMessage | null
}

export default function ChatPage() {
  const { user } = useAuth()
  const navigate = useNavigate()

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [partner, setPartner] = useState<{ id: string; name: string; avatar: string | null } | null>(
    null,
  )
  const [coupleId, setCoupleId] = useState<string | null>(null)

  const [draft, setDraft] = useState<Draft>({ body: '', replyTo: null })
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)

  const [editing, setEditing] = useState<ChatMessage | null>(null)
  const [editBody, setEditBody] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)

  const [uploading, setUploading] = useState(false)

  const bottomRef = useRef<HTMLDivElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const pollRef = useRef<number | null>(null)
  /** Set while an optimistic message is in flight, so a poll cannot drop it. */
  const pendingRef = useRef<Set<string>>(new Set())

  // ----------------------------------------------------------------
  // Who am I talking to
  // ----------------------------------------------------------------
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const state = await fetchPairingState()
        if (!alive) return
        if (!state.partner) {
          navigate('/app', { replace: true })
          return
        }
        setPartner({
          id: state.partner.id,
          name: state.partner.display_name ?? 'شریکت',
          avatar: state.partner.avatar_url,
        })
        // The storage policy is keyed on the couple id, and
        // `get_pairing_state()` does not carry it, so ask for it explicitly
        // rather than guessing from the partner id.
        const couple = await fetchCurrentCouple()
        setCoupleId(couple?.id ?? null)
      } catch (err) {
        if (alive) setError(toPersianError(err))
      }
    })()
    return () => {
      alive = false
    }
  }, [navigate])

  // ----------------------------------------------------------------
  // Loading + polling
  // ----------------------------------------------------------------
  const mergeLatest = useCallback(async (showSpinner: boolean) => {
    if (showSpinner) setLoading(true)
    try {
      const page = await fetchMessages(null, PAGE_SIZE)
      setMessages((prev) => {
        // Keep any optimistic bubble that the server has not echoed yet.
        const optimistic = prev.filter((m) => pendingRef.current.has(m.id))
        const ids = new Set(page.map((m) => m.id))
        const merged = [...page, ...optimistic.filter((m) => !ids.has(m.id))]
        // `chat_messages` returns newest-first; keep that invariant.
        merged.sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
        return merged
      })
      setHasMore(page.length === PAGE_SIZE)
      setError(null)
    } catch (err) {
      setError(toPersianError(err))
    } finally {
      if (showSpinner) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void mergeLatest(true)
  }, [mergeLatest])

  // Poll only while the screen is actually visible. A hidden tab polling is
  // battery for nothing, and it would also mark messages read behind the
  // user's back if reads were tied to the fetch.
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== 'visible') return
      void mergeLatest(false)
    }

    const start = () => {
      if (pollRef.current !== null) return
      pollRef.current = window.setInterval(tick, POLL_MS)
    }
    const stop = () => {
      if (pollRef.current === null) return
      window.clearInterval(pollRef.current)
      pollRef.current = null
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void mergeLatest(false)
        start()
      } else {
        stop()
      }
    }

    start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [mergeLatest])

  // Mark read whenever a partner message arrives while the screen is visible.
  const newestIncoming = messages.find((m) => m.sender_id !== user?.id && !m.deleted_at)
  useEffect(() => {
    if (!newestIncoming) return
    if (document.visibilityState !== 'visible') return
    void markMessagesRead(newestIncoming.created_at).catch(() => undefined)
  }, [newestIncoming])

  // ----------------------------------------------------------------
  // Scrolling
  // ----------------------------------------------------------------
  const scrollToBottom = useCallback((smooth = false) => {
    // `scrollIntoView` is missing on some older Android WebViews, and an
    // optional chain on the *element* does not save you from that. Falling
    // back to scrollTop keeps the newest message reachable regardless.
    const anchor = bottomRef.current
    const list = listRef.current
    if (anchor && typeof anchor.scrollIntoView === 'function') {
      anchor.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'end' })
    } else if (list) {
      list.scrollTop = list.scrollHeight
    }
  }, [])

  // First paint lands at the newest message, like every chat ever.
  const landedRef = useRef(false)
  useEffect(() => {
    if (landedRef.current || loading || messages.length === 0) return
    landedRef.current = true
    requestAnimationFrame(() => scrollToBottom(false))
  }, [loading, messages.length, scrollToBottom])

  const loadOlder = useCallback(async () => {
    if (loadingOlder || !hasMore || messages.length === 0) return
    const oldest = messages[messages.length - 1]
    setLoadingOlder(true)
    const before = listRef.current?.scrollHeight ?? 0
    try {
      const older = await fetchMessages(oldest.created_at, PAGE_SIZE)
      setHasMore(older.length === PAGE_SIZE)
      setMessages((prev) => {
        const ids = new Set(prev.map((m) => m.id))
        return [...prev, ...older.filter((m) => !ids.has(m.id))]
      })
      // Keep the reading position instead of jumping to the restored offset.
      requestAnimationFrame(() => {
        const el = listRef.current
        if (el) el.scrollTop += el.scrollHeight - before
      })
    } catch (err) {
      setError(toPersianError(err))
    } finally {
      setLoadingOlder(false)
    }
  }, [hasMore, loadingOlder, messages])

  // ----------------------------------------------------------------
  // Sending
  // ----------------------------------------------------------------
  const send = useCallback(async () => {
    const body = draft.body.trim()
    if (!body || sending) return

    const tempId = `temp-${crypto.randomUUID()}`
    const now = new Date().toISOString()
    const optimistic: ChatMessage = {
      id: tempId,
      sender_id: user?.id ?? '',
      body,
      kind: 'text',
      media_path: null,
      media_w: null,
      media_h: null,
      edited_at: null,
      deleted_at: null,
      created_at: now,
      seen: false,
    }

    pendingRef.current.add(tempId)
    setMessages((prev) => [optimistic, ...prev])
    setDraft({ body: '', replyTo: null })
    setSendError(null)
    setSending(true)
    requestAnimationFrame(() => scrollToBottom(true))

    try {
      const saved = await sendMessage(body)
      pendingRef.current.delete(tempId)
      setMessages((prev) =>
        prev.map((m) => (m.id === tempId ? { ...m, id: saved.id, created_at: saved.created_at } : m)),
      )
    } catch (err) {
      pendingRef.current.delete(tempId)
      // Put the text back in the box and drop the ghost bubble: losing what
      // someone just wrote is the one failure a chat must never have.
      setMessages((prev) => prev.filter((m) => m.id !== tempId))
      setDraft((d) => ({ ...d, body }))
      setSendError(toPersianError(err))
    } finally {
      setSending(false)
      inputRef.current?.focus()
    }
  }, [draft.body, scrollToBottom, sending, user?.id])

  const pickImage = useCallback(
    async (file: File | undefined) => {
      if (!file || !coupleId) return
      const problem = validateChatImage(file)
      if (problem) {
        setSendError(problem)
        return
      }

      setUploading(true)
      setSendError(null)
      try {
        const size = await readImageSize(file)
        const path = await uploadChatImage(coupleId, file)
        const saved = await sendImage(path, size?.width ?? null, size?.height ?? null)
        const optimistic: ChatMessage = {
          id: saved.id,
          sender_id: user?.id ?? '',
          body: '',
          kind: 'image',
          media_path: path,
          media_w: size?.width ?? null,
          media_h: size?.height ?? null,
          edited_at: null,
          deleted_at: null,
          created_at: saved.created_at,
          seen: false,
        }
        setMessages((prev) => [optimistic, ...prev.filter((m) => m.id !== saved.id)])
        requestAnimationFrame(() => scrollToBottom(true))
      } catch (err) {
        setSendError(toPersianError(err))
      } finally {
        setUploading(false)
        if (fileRef.current) fileRef.current.value = ''
      }
    },
    [coupleId, scrollToBottom, user?.id],
  )

  // ----------------------------------------------------------------
  // Edit / delete
  // ----------------------------------------------------------------
  const startEdit = useCallback((message: ChatMessage) => {
    setEditing(message)
    setEditBody(message.body)
    setSendError(null)
  }, [])

  const submitEdit = useCallback(async () => {
    if (!editing) return
    const body = editBody.trim()
    if (!body) return
    setBusyId(editing.id)
    try {
      await editMessage(editing.id, body)
      setMessages((prev) =>
        prev.map((m) =>
          m.id === editing.id ? { ...m, body, edited_at: new Date().toISOString() } : m,
        ),
      )
      setEditing(null)
      setEditBody('')
    } catch (err) {
      setSendError(toPersianError(err))
    } finally {
      setBusyId(null)
    }
  }, [editBody, editing])

  const remove = useCallback(async (message: ChatMessage) => {
    if (!confirm('این پیام برای هر دو نفر حذف می‌شود. مطمئنی؟')) return
    setBusyId(message.id)
    try {
      await deleteMessage(message.id)
      setMessages((prev) =>
        prev.map((m) =>
          m.id === message.id
            ? { ...m, body: '', media_path: null, deleted_at: new Date().toISOString() }
            : m,
        ),
      )
    } catch (err) {
      setSendError(toPersianError(err))
    } finally {
      setBusyId(null)
    }
  }, [])

  // ----------------------------------------------------------------
  // Render helpers
  // ----------------------------------------------------------------
  const chronological = useMemo(() => [...messages].reverse(), [messages])

  const rows = useMemo(() => {
    return chronological.map((message, index) => {
      const prev = chronological[index - 1]
      const newDay = !prev || dayLabel(prev.created_at) !== dayLabel(message.created_at)
      return { message, daySeparator: newDay ? dayLabel(message.created_at) : null }
    })
  }, [chronological])

  return (
    <div className="flex min-h-screen flex-col bg-cream">
      <AppHeader />

      <div className="mx-auto flex w-full max-w-lg flex-1 flex-col">
        {/* ---- who you are talking to ---- */}
        <div className="sticky top-[61px] z-20 flex items-center gap-3 border-b border-blush-100/70 bg-cream/95 px-5 py-3 backdrop-blur">
          <Link
            to="/app"
            aria-label="بازگشت"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-white/80 text-ink-500 shadow-card"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M9 6l6 6-6 6"
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinecap="round"
                strokeLinejoin="round"
                transform="rotate(180 12 12)"
              />
            </svg>
          </Link>

          <Avatar src={partner?.avatar} name={partner?.name} size={38} />

          <div className="min-w-0">
            <p className="truncate text-[14px] font-extrabold text-ink-900">{partner?.name ?? '…'}</p>
            <p className="text-[11px] text-ink-500">فقط شما دو نفر می‌بینید</p>
          </div>
        </div>

        {/* ---- the thread ---- */}
        <div
          ref={listRef}
          className="flex-1 overflow-y-auto px-4 py-4"
          style={{ maxHeight: 'calc(100vh - 220px)', minHeight: '50vh' }}
        >
          {loading ? (
            <div className="flex justify-center py-12">
              <Spinner />
            </div>
          ) : messages.length === 0 ? (
            <EmptyThread partnerName={partner?.name} />
          ) : (
            <>
              {hasMore && (
                <div className="mb-3 flex justify-center">
                  <button
                    type="button"
                    onClick={() => void loadOlder()}
                    disabled={loadingOlder}
                    className="rounded-full bg-white px-4 py-1.5 text-[12px] font-bold text-blush-600 shadow-card disabled:opacity-50"
                  >
                    {loadingOlder ? 'در حال آوردن…' : 'پیام‌های قدیمی‌تر'}
                  </button>
                </div>
              )}

              {rows.map(({ message, daySeparator }) => (
                <div key={message.id}>
                  {daySeparator && (
                    <div className="my-4 flex items-center gap-3">
                      <div className="h-px flex-1 bg-blush-100" />
                      <span className="text-[11px] font-bold text-ink-500">{daySeparator}</span>
                      <div className="h-px flex-1 bg-blush-100" />
                    </div>
                  )}
                  <MessageBubble
                    message={message}
                    mine={message.sender_id === user?.id}
                    pending={pendingRef.current.has(message.id)}
                    busy={busyId === message.id}
                    onEdit={startEdit}
                    onDelete={remove}
                  />
                </div>
              ))}
            </>
          )}
          <div ref={bottomRef} />
        </div>

        {/* ---- errors ---- */}
        {error && (
          <div className="mx-4 mb-2 rounded-2xl bg-red-50 px-4 py-2.5 text-[12px] font-bold text-red-600">
            {error}
          </div>
        )}
        {sendError && (
          <div className="mx-4 mb-2 rounded-2xl bg-red-50 px-4 py-2.5 text-[12px] font-bold text-red-600">
            {sendError}
          </div>
        )}

        {/* ---- the composer ---- */}
        <div className="sticky bottom-0 border-t border-blush-100 bg-cream/95 px-3 py-3 backdrop-blur">
          <div className="flex items-end gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(event) => void pickImage(event.target.files?.[0])}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading || !coupleId}
              aria-label="فرستادن عکس"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-ink-500 shadow-card transition hover:text-blush-600 disabled:opacity-40"
            >
              {uploading ? (
                <Spinner className="h-4 w-4" />
              ) : (
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <rect x="3" y="5" width="18" height="14" rx="3" stroke="currentColor" strokeWidth="1.7" />
                  <circle cx="8.5" cy="10" r="1.6" fill="currentColor" />
                  <path
                    d="M4 16.5l4.5-4a2 2 0 0 1 2.7 0L20 20"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                  />
                </svg>
              )}
            </button>

            <textarea
              ref={inputRef}
              value={draft.body}
              onChange={(event) => {
                setDraft((d) => ({ ...d, body: event.target.value }))
                if (sendError) setSendError(null)
              }}
              onKeyDown={(event) => {
                // Enter sends, Shift+Enter is a newline — the convention on a
                // phone keyboard is Enter = send, and a textarea still allows
                // the long message someone needed to write.
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  void send()
                }
              }}
              rows={1}
              maxLength={2000}
              placeholder="یک چیزی بنویس…"
              className="max-h-32 min-h-[40px] flex-1 resize-none rounded-3xl border border-blush-100 bg-white px-4 py-2.5 text-[14px] text-ink-900 outline-none placeholder:text-ink-500/60 focus:border-blush-300"
              style={{ fieldSizing: 'content' } as React.CSSProperties}
            />

            <button
              type="button"
              onClick={() => void send()}
              disabled={!draft.body.trim() || sending}
              aria-label="فرستادن"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blush-500 text-white shadow-soft transition active:scale-95 disabled:opacity-40"
            >
              {sending ? (
                <Spinner className="h-4 w-4 text-white" />
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M4 12l16-7-7 16-2.2-6.8L4 12z"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinejoin="round"
                    transform="scale(-1 1) translate(-24 0)"
                  />
                </svg>
              )}
            </button>
          </div>
          <p className="mt-1.5 px-2 text-[10.5px] text-ink-500/70">
            Enter می‌فرستد، Shift+Enter خط بعدی
          </p>
        </div>
      </div>

      {/* ---- edit sheet ---- */}
      {editing && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-ink-900/40 px-4 pb-6 sm:items-center">
          <div className="w-full max-w-lg rounded-4xl bg-white p-5 shadow-soft">
            <p className="mb-3 text-[14px] font-extrabold text-ink-900">ویرایش پیام</p>
            <textarea
              value={editBody}
              onChange={(event) => setEditBody(event.target.value)}
              rows={3}
              maxLength={2000}
              className="w-full resize-none rounded-2xl border border-blush-100 bg-cream px-4 py-3 text-[14px] text-ink-900 outline-none focus:border-blush-300"
            />
            <p className="mt-1.5 text-[11px] text-ink-500">
              شریکت می‌بیند که این پیام ویرایش شده — چیزی بی‌صدا عوض نمی‌شود.
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setEditing(null)
                  setEditBody('')
                }}
                className="flex-1 rounded-full bg-blush-50 py-2.5 text-[13px] font-bold text-ink-700"
              >
                بی‌خیال
              </button>
              <button
                type="button"
                onClick={() => void submitEdit()}
                disabled={!editBody.trim() || busyId === editing.id}
                className="flex-1 rounded-full bg-blush-500 py-2.5 text-[13px] font-bold text-white disabled:opacity-50"
              >
                {busyId === editing.id ? '…' : 'ذخیره'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ------------------------------------------------------------------
// One bubble
// ------------------------------------------------------------------
function MessageBubble({
  message,
  mine,
  pending,
  busy,
  onEdit,
  onDelete,
}: {
  message: ChatMessage
  mine: boolean
  pending: boolean
  busy: boolean
  onEdit: (m: ChatMessage) => void
  onDelete: (m: ChatMessage) => void
}) {
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [imageFailed, setImageFailed] = useState(false)

  useEffect(() => {
    if (message.kind !== 'image' || !message.media_path || message.deleted_at) return
    let alive = true
    void resolveChatImage(message.media_path).then((url) => {
      if (!alive) return
      if (url) setImageUrl(url)
      else setImageFailed(true)
    })
    return () => {
      alive = false
    }
  }, [message.kind, message.media_path, message.deleted_at])

  // A deleted message keeps its place but says so, in both directions.
  if (message.deleted_at) {
    return (
      <div className={`mb-2 flex ${mine ? 'justify-start' : 'justify-end'}`}>
        <div className="rounded-3xl border border-dashed border-blush-200 px-4 py-2">
          <p className="text-[12px] italic text-ink-500">پیام حذف شد</p>
        </div>
      </div>
    )
  }

  const aspect =
    message.media_w && message.media_h ? message.media_w / message.media_h : undefined

  return (
    <div className={`group mb-2 flex ${mine ? 'justify-start' : 'justify-end'}`}>
      <div className={`flex max-w-[82%] flex-col ${mine ? 'items-start' : 'items-end'}`}>
        <div
          className={`relative rounded-3xl px-4 py-2.5 ${
            mine
              ? 'bg-blush-500 text-white shadow-soft'
              : 'bg-white text-ink-900 shadow-card'
          }`}
        >
          {message.kind === 'image' ? (
            imageFailed ? (
              <p className={`text-[12px] ${mine ? 'text-white/90' : 'text-ink-500'}`}>
                عکس بارگذاری نشد.
              </p>
            ) : imageUrl ? (
              <img
                src={imageUrl}
                alt="عکس فرستاده‌شده"
                loading="lazy"
                width={message.media_w ?? undefined}
                height={message.media_h ?? undefined}
                style={aspect ? { aspectRatio: String(aspect) } : undefined}
                className="max-h-72 w-auto max-w-full rounded-2xl object-cover"
              />
            ) : (
              <div
                className="h-32 w-40 animate-pulse rounded-2xl bg-black/10"
                aria-label="در حال بارگذاری عکس"
              />
            )
          ) : (
            <p className="whitespace-pre-wrap break-words text-[14px] leading-6">{message.body}</p>
          )}

          <div
            className={`mt-1 flex items-center gap-1.5 ${mine ? 'justify-end' : 'justify-start'}`}
          >
            {message.edited_at && (
              <span className={`text-[10px] ${mine ? 'text-white/70' : 'text-ink-500/70'}`}>
                ویرایش‌شده
              </span>
            )}
            <span className={`text-[10px] tabular-nums ${mine ? 'text-white/70' : 'text-ink-500/70'}`}>
              {formatTime(message.created_at)}
            </span>
            {mine && (
              <span
                className="text-[10px] text-white/80"
                aria-label={pending ? 'در حال فرستادن' : message.seen ? 'دیده شد' : 'فرستاده شد'}
                title={pending ? 'در حال فرستادن' : message.seen ? 'دیده شد' : 'فرستاده شد'}
              >
                {pending ? '◷' : message.seen ? '✓✓' : '✓'}
              </span>
            )}
          </div>
        </div>

        {/* own messages only, and only while nothing is in flight */}
        {mine && !pending && (
          <div className="mt-1 flex gap-2 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
            {message.kind === 'text' && (
              <button
                type="button"
                onClick={() => onEdit(message)}
                disabled={busy}
                className="text-[10.5px] font-bold text-ink-500 hover:text-blush-600 disabled:opacity-40"
              >
                ویرایش
              </button>
            )}
            <button
              type="button"
              onClick={() => onDelete(message)}
              disabled={busy}
              className="text-[10.5px] font-bold text-ink-500 hover:text-red-500 disabled:opacity-40"
            >
              حذف
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ------------------------------------------------------------------
// First-run state
// ------------------------------------------------------------------
function EmptyThread({ partnerName }: { partnerName?: string }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-blush-50 text-3xl">
        🤍
      </div>
      <p className="text-[15px] font-extrabold text-ink-900">هنوز چیزی نگفته‌اید</p>
      <p className="mt-2 max-w-xs text-[12.5px] leading-6 text-ink-500">
        اینجا فقط بین تو و {partnerName ?? 'شریکت'} است. یک «سلام» کافی است تا شروع شود.
      </p>
    </div>
  )
}
