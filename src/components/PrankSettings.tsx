import { useCallback, useEffect, useState } from 'react'
import Alert from './Alert'
import {
  armPrank,
  fetchPrankStatus,
  type PrankArmedState,
} from '../lib/prankApi'
import { toPersianError } from '../lib/errors'

/**
 * «شوخی روی گوشی او» — the sender's button.
 *
 * One tap arms the prank; the other phone plays it the next time it comes to
 * the foreground. Nothing on this screen reaches across and starts an
 * animation — that is not something a web app can do, and building the button
 * as if it could would be a lie told in the interface.
 *
 * What the button honestly promises is in the copy: «هر وقت اپ را باز کند»,
 * not «همین حالا».
 *
 * The status line matters more than the button. A prank you are not sure you
 * sent is worse than one you did not send, so the screen keeps saying, in
 * plain words, whether it is waiting.
 */
export default function PrankSettings() {
  const [status, setStatus] = useState<PrankArmedState | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setStatus(await fetchPrankStatus())
    } catch {
      // A status line that cannot load is not worth an error banner.
      setStatus(null)
    }
  }, [])

  useEffect(() => {
    void refresh()
    // The other phone might play it while this screen is open.
    const id = window.setInterval(() => void refresh(), 20_000)
    return () => window.clearInterval(id)
  }, [refresh])

  async function arm() {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await armPrank()
      setNotice('آماده شد. حالا فقط بگو اپ را باز کند.')
      await refresh()
    } catch (armError) {
      setError(toPersianError(armError, 'شوخی آماده نشد.'))
    } finally {
      setBusy(false)
    }
  }

  const armed = Boolean(status?.armed)
  const played = Boolean(status?.played) && !armed

  return (
    <section className="card space-y-4 p-5">
      <div>
        <h2 className="text-[14px] font-extrabold text-ink-900">شوخی روی گوشی او</h2>
        <p className="mt-1 text-[11.5px] leading-6 text-ink-700">
          یک شوخی دوستانه: چند ثانیه که انگار گوشی‌اش هک شده، بعد خودش همه‌چیز را لو می‌دهد و
          تبدیل می‌شود به جشن. هیچ‌چیزِ خصوصی‌ای خوانده نمی‌شود — همه‌اش نمایش است.
        </p>
      </div>

      {notice && <Alert tone="success">{notice}</Alert>}
      {error && <Alert tone="error">{error}</Alert>}

      {/* The state, in one line somebody can actually read. */}
      <div className="well rounded-2xl px-3 py-2.5">
        {armed ? (
          <p className="text-[12px] font-bold text-blush-800">
            🎭 آماده است — منتظر باز شدن اپ توسط او.
          </p>
        ) : played ? (
          <p className="text-[12px] font-bold text-ink-900">
            ✅ یک بار اجرا شد.
          </p>
        ) : (
          <p className="text-[12px] font-bold text-ink-700">هنوز چیزی نفرستاده‌ای.</p>
        )}
        <p className="mt-1 text-[10.5px] leading-6 text-ink-700">
          روی گوشی خودش، در همان صفحه‌ای که هست، باز می‌شود. اگر تا دو ساعت اپ را باز نکند، خودش
          منقضی می‌شود تا وسط روزِ بعد غافلگیر نشود.
        </p>
      </div>

      <button
        type="button"
        onClick={() => void arm()}
        disabled={busy}
        className="btn-primary w-full disabled:opacity-50"
      >
        {busy ? 'دارم آماده می‌کنم…' : armed ? 'دوباره آماده کن' : 'شوخی را آماده کن'}
      </button>

      <details className="rounded-2xl bg-clay-100 px-3 py-2.5">
        <summary className="cursor-pointer text-[11.5px] font-bold text-ink-900">
          چه چیزی می‌بیند؟ (قبل از فرستادن بخوان)
        </summary>
        <ul className="mt-2 space-y-1.5 text-[11px] leading-6 text-ink-700">
          <li>
            · یک صفحهٔ سبز با خطوطی که می‌گوید «به گوشی‌ات وصل شدم» — و بعد خط‌به‌خط
            اعتراف می‌کند که شوخی است.
          </li>
          <li>· هر جای صفحه بزند، تمام می‌شود. یک دکمهٔ «کافیه، نشونم بده» هم همیشه هست.</li>
          <li>· حدود نیم دقیقه، بعد خودش می‌رود سراغ صفحهٔ جشن.</li>
          <li>· برای کسی که حرکت کمتر می‌خواهد، لرزش و برفک خاموش می‌شود؛ صفحه می‌ماند.</li>
        </ul>
      </details>
    </section>
  )
}
