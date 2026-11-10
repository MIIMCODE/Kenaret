import { useState } from 'react'

interface Props {
  code: string | null
  displayName?: string | null
}

export default function PairingCodeCard({ code, displayName }: Props) {
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)

  async function copy() {
    if (!code) return
    const text = `${displayName ? `${displayName} ` : ''}کد کنارت من: ${code}`

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(code)
      } else {
        throw new Error('clipboard unavailable')
      }
      setCopied(true)
      setCopyFailed(false)
      setTimeout(() => setCopied(false), 2200)
    } catch {
      // Older iOS Safari / insecure contexts: fall back to a manual selection hint.
      try {
        const area = document.createElement('textarea')
        area.value = code
        area.style.position = 'fixed'
        area.style.opacity = '0'
        document.body.appendChild(area)
        area.select()
        document.execCommand('copy')
        document.body.removeChild(area)
        setCopied(true)
        setCopyFailed(false)
        setTimeout(() => setCopied(false), 2200)
      } catch {
        setCopyFailed(true)
        setTimeout(() => setCopyFailed(false), 3000)
      }
    }

    void text
  }

  async function share() {
    if (!code) return
    const text = `سلام! این کد کنارت من است: ${code}\nتوی کنارت واردش کن تا به هم وصل شویم 💗\n${window.location.origin}${import.meta.env.BASE_URL}`
    if (navigator.share) {
      try {
        await navigator.share({ title: 'کد کنارت', text })
        return
      } catch {
        // user dismissed the sheet — fall through to copy
      }
    }
    await copy()
  }

  const grouped = code ? code.replace(/(.{4})(?=.)/g, '$1 ') : '—'

  return (
    <div
      className="relative overflow-hidden rounded-[1.75rem] p-5 text-white shadow-[8px_8px_20px_rgba(201,53,96,0.28),-8px_-8px_20px_rgba(255,255,255,0.9)]"
      style={{ backgroundImage: 'linear-gradient(135deg, #e84874 0%, #c93560 52%, #a52c50 100%)' }}
    >
      {/* decorative bubbles */}
      <div className="pointer-events-none absolute -left-8 -top-10 h-28 w-28 rounded-full bg-white/15" />
      <div className="pointer-events-none absolute -bottom-12 -right-6 h-32 w-32 rounded-full bg-white/10" />

      <div className="relative">
        <div className="flex items-center justify-between">
          <p className="text-[12px] font-bold text-white/90">کد جفت‌شدن تو</p>
          <span className="rounded-full bg-black/15 px-2.5 py-1 text-[10.5px] font-bold">
            ۸ کاراکتر
          </span>
        </div>

        <div
          dir="ltr"
          className="mt-2 select-all font-mono text-[30px] font-extrabold leading-tight tracking-[0.18em] text-center"
          aria-label={`کد جفت‌شدن: ${code ?? ''}`}
        >
          {grouped}
        </div>

        <p className="mt-2 text-center text-[11.5px] leading-5 text-white/90">
          این کد را برای شریکت بفرست تا بتواند درخواست وصل شدن بدهد.
        </p>

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={copy}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-2xl bg-white px-4 py-2.5 text-[13px] font-extrabold text-blush-800 transition active:scale-[0.98]"
          >
            {copied ? (
              <>
                <CheckIcon /> کپی شد!
              </>
            ) : copyFailed ? (
              'دستی انتخاب کن'
            ) : (
              <>
                <CopyIcon /> کپی کد
              </>
            )}
          </button>

          <button
            type="button"
            onClick={share}
            className="flex items-center justify-center gap-1.5 rounded-2xl bg-black/20 px-4 py-2.5 text-[13px] font-bold text-white transition active:scale-[0.98]"
          >
            <ShareIcon />
            فرستادن
          </button>
        </div>
      </div>
    </div>
  )
}

function CopyIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="9" y="9" width="11" height="11" rx="3" stroke="currentColor" strokeWidth="1.8" />
      <path d="M15 5.5A2.5 2.5 0 0 0 12.5 3H6.5A3.5 3.5 0 0 0 3 6.5v6A2.5 2.5 0 0 0 5.5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 7" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ShareIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 15V4m0 0L8 8m4-4l4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 13v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}
