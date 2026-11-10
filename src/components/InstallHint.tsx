import { useEffect, useState } from 'react'
import {
  canPromptInstall,
  dismissInstallHint,
  installHintDismissed,
  isIos,
  isStandalone,
  onInstallAvailable,
  promptInstall,
} from '../lib/pwa'

/**
 * «کنارت را روی گوشی نصب کن»
 *
 * A card, not a modal: it sits at the bottom of the dashboard, can be ignored,
 * and stays away for two weeks once dismissed. On Android it opens the real
 * install dialog; on iPhone, where Apple offers no such API, it shows the two
 * taps in Safari's share sheet — the only path that actually works there.
 */
export default function InstallHint() {
  const [visible, setVisible] = useState(false)
  const [installable, setInstallable] = useState(false)
  const [busy, setBusy] = useState(false)
  const [installed, setInstalled] = useState(false)

  useEffect(() => {
    if (isStandalone()) return
    if (installHintDismissed()) return
    // Give the dashboard a beat to paint before adding another card.
    const timer = window.setTimeout(() => setVisible(true), 900)
    const off = onInstallAvailable(setInstallable)
    return () => {
      window.clearTimeout(timer)
      off()
    }
  }, [])

  if (!visible || installed) return null

  const ios = isIos() && !canPromptInstall()

  async function handleInstall() {
    setBusy(true)
    const accepted = await promptInstall()
    setBusy(false)
    if (accepted) setInstalled(true)
  }

  function handleDismiss() {
    dismissInstallHint()
    setVisible(false)
  }

  return (
    <section
      className="animate-fade-up rounded-[1.75rem] bg-clay-100 p-4 shadow-neo"
      aria-label="نصب روی گوشی"
    >
      <div className="flex items-start gap-3">
        <img
          src={`${import.meta.env.BASE_URL}icons/icon-192.png`}
          alt=""
          width={44}
          height={44}
          className="h-11 w-11 shrink-0 rounded-xl bg-clay-200 p-1 shadow-neo-in-sm"
        />

        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] font-extrabold text-ink-900">
            کنارت را روی گوشی‌ات نصب کن
          </p>
          <p className="mt-1 text-[11px] leading-5 text-ink-700">
            {ios
              ? 'بعد از نصب، آیکونش کنار بقیه‌ی برنامه‌ها می‌نشیند و هر بار مستقیم باز می‌شود.'
              : 'بعد از نصب، مثل بقیه‌ی برنامه‌ها از صفحه‌ی خانه بازش می‌کنی، بدون نوار آدرس.'}
          </p>
        </div>

        <button
          type="button"
          onClick={handleDismiss}
          aria-label="بستن"
          className="-mt-1 -mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-ink-700 transition hover:bg-blush-50 hover:text-ink-900"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M6 6l12 12M18 6L6 18"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      {ios ? (
        <ol className="mt-3 space-y-2 rounded-2xl bg-clay-200 px-3.5 py-3 shadow-neo-in-sm">
          <li className="flex items-center gap-2 text-[11px] leading-5 text-ink-700">
            <Step n="۱" />
            <span>
              در سافاری دکمه‌ی{' '}
              <span className="inline-flex items-center gap-1 rounded-md bg-clay-100 px-1.5 py-0.5 font-bold shadow-neo-sm">
                <ShareGlyph />
                اشتراک‌گذاری
              </span>{' '}
              را بزن.
            </span>
          </li>
          <li className="flex items-center gap-2 text-[11px] leading-5 text-ink-700">
            <Step n="۲" />
            <span>
              «افزودن به صفحه‌ی خانه» را انتخاب کن و بعد «افزودن».
            </span>
          </li>
        </ol>
      ) : installable ? (
        <button
          type="button"
          onClick={handleInstall}
          disabled={busy}
          className="btn-soft mt-3 w-full !py-2.5 text-[12.5px]"
        >
          {busy ? 'در حال باز کردن…' : 'نصب کن'}
        </button>
      ) : (
        <p className="mt-3 text-[11px] leading-5 text-ink-700">
          از منوی مرورگر گزینه‌ی «افزودن به صفحه‌ی خانه» یا «نصب برنامه» را انتخاب کن.
        </p>
      )}
    </section>
  )
}

function Step({ n }: { n: string }) {
  return (
    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-clay-100 text-[10px] font-extrabold text-blush-800 shadow-neo-sm">
      {n}
    </span>
  )
}

/** The iOS share glyph (box with an arrow leaving it). */
function ShareGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 3v11m0-11L8.5 6.5M12 3l3.5 3.5M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
