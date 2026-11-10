import { useCallback, useEffect, useState } from 'react'
import Alert from './Alert'
import Spinner from './Spinner'
import { fetchPushDevices } from '../lib/api'
import { capability, currentEndpoint, disablePush, enablePush, testPush } from '../lib/push'
import { toPersianError } from '../lib/errors'
import type { PushCapability, PushDevice } from '../types/database'

/**
 * "Notifications on this phone" — the permission card.
 *
 * Order matters here. The switch is rendered *before* any prompt exists, and
 * permission is requested only when the person flips it. Asking on page load
 * is how apps end up permanently blocked: Safari and Chrome both treat a
 * prompt shown without a tap as a reason to refuse outright from then on.
 *
 * The three states people actually land in:
 *
 *   · supported and off        → a switch, plus what it will actually send
 *   · blocked at the OS level  → instructions, because no API can undo it
 *   · iPhone in a Safari tab   → "install it first", because iOS has no
 *                                PushManager outside an installed app
 */
export default function PushSettings() {
  const [cap, setCap] = useState<PushCapability | null>(null)
  const [devices, setDevices] = useState<PushDevice[]>([])
  const [on, setOn] = useState(false)
  const [busy, setBusy] = useState(false)
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const state = capability()
    const endpoint = state.supported ? await currentEndpoint() : null
    setCap({ ...state, subscribed: endpoint !== null })
    setOn(endpoint !== null)

    if (endpoint) {
      try {
        setDevices(await fetchPushDevices())
      } catch {
        setDevices([])
      }
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function toggle(next: boolean) {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      if (next) {
        const result = await enablePush()
        if (!result.ok) {
          setError(messageFor(result.reason))
          await refresh()
          return
        }
        setNotice('روشن شد — همین حالا می‌توانی امتحانش کنی.')
      } else {
        await disablePush()
        setNotice('این دستگاه دیگر نوتیفیکیشن نمی‌گیرد.')
      }
      await refresh()
    } catch (err) {
      setError(toPersianError(err))
    } finally {
      setBusy(false)
    }
  }

  async function handleTest() {
    setTesting(true)
    setError(null)
    setNotice(null)
    try {
      const result = await testPush()

      if (!result.ok) {
        setError(
          'این گوشی هنوز ثبت نشده. اول کلید بالا را روشن کن، بعد اجازه‌ی نوتیفیکیشن را بده.',
        )
        return
      }

      if (result.sent > 0) {
        setNotice('فرستادیم! تا چند ثانیه دیگر باید روی گوشی بیاید.')
        return
      }

      // Nothing was delivered, and the server said why in the device row.
      setError(
        'فرستادیم اما سرویس پوش قبولش نکرد. اگر روی آیفون هستی، کنارت باید از صفحه‌ی خانه باز شده باشد؛ وگرنه یک بار خاموش و روشن کن.',
      )
    } catch (err) {
      // The most common failure here is the browser blocking a cross-origin
      // call; saying "try again" would hide that.
      setError(`${toPersianError(err)} اگر تکرار شد، صفحه را تازه کن و دوباره امتحان کن.`)
    } finally {
      setTesting(false)
    }
  }

  if (!cap) {
    return (
      <section className="card p-5">
        <div className="flex items-center gap-2 text-[12px] text-ink-500">
          <Spinner className="h-4 w-4 text-blush-400" /> در حال بررسی گوشی…
        </div>
      </section>
    )
  }

  // ---- the three dead ends, each with its own explanation ----------------
  if (!cap.supported) {
    const copy =
      cap.reason === 'ios-not-installed'
        ? {
            title: 'اول کنارت را نصب کن',
            body: 'روی آیفون، نوتیفیکیشن فقط وقتی کار می‌کند که کنارت روی صفحه‌ی خانه باشد. از دکمه‌ی اشتراک‌گذاری سافاری «Add to Home Screen» را بزن و از همان آیکون بازش کن.',
            tone: 'info' as const,
          }
        : cap.reason === 'insecure'
          ? {
              title: 'اتصال امن لازم است',
              body: 'مرورگر فقط روی اتصال امن (https) اجازه‌ی نوتیفیکیشن می‌دهد.',
              tone: 'info' as const,
            }
          : {
              title: 'این مرورگر پشتیبانی نمی‌کند',
              body: 'مرورگر یا نسخه‌ی فعلی‌ات نوتیفیکیشن وب را ندارد. با کروم، سافاری یا فایرفاکس جدید روی گوشی امتحان کن — یا نسخه‌ی آیکونی کنارت را نصب کن.',
              tone: 'info' as const,
            }

    return (
      <section className="card space-y-2 p-5">
        <h2 className="text-[14px] font-extrabold text-ink-900">نوتیفیکیشن روی گوشی</h2>
        <div className="rounded-2xl bg-blush-50 px-3.5 py-3">
          <p className="text-[12.5px] font-extrabold text-ink-900">{copy.title}</p>
          <p className="mt-1 text-[11px] leading-6 text-ink-700">{copy.body}</p>
        </div>
        <p className="text-[10.5px] leading-5 text-ink-500">
          زنگوله‌ی داخل اپ همیشه کار می‌کند؛ نوتیفیکیشن فقط راهِ رسیدن بدون باز کردن اپ است.
        </p>
      </section>
    )
  }

  const blocked =
    (globalThis as { Notification?: { permission: string } }).Notification?.permission === 'denied'

  return (
    <section className="card space-y-3 p-5">
      <div>
        <h2 className="text-[14px] font-extrabold text-ink-900">نوتیفیکیشن روی گوشی</h2>
        <p className="mt-1 text-[11px] leading-5 text-ink-500">
          حتی وقتی کنارت بسته است. دیدار بعدی، روزهای مهم، و «دلم تنگ شده»ی شریکت.
        </p>
      </div>

      {error && <Alert tone="error">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}

      {blocked ? (
        <div className="rounded-2xl bg-blush-50 px-3 py-3">
          <p className="text-[12px] font-extrabold text-ink-900">دسترسی مسدود شده</p>
          <p className="mt-1 text-[11px] leading-6 text-ink-700">
            یک بار «Block» را زده‌ای، و مرورگر دیگر اجازه‌ی پرسیدن نمی‌دهد. از تنظیمات خودِ مرورگر
            (قفل کنار آدرس → Notifications → Allow) بازش کن و صفحه را تازه کن.
          </p>
        </div>
      ) : (
        <button
          type="button"
          role="switch"
          aria-checked={on}
          disabled={busy}
          onClick={() => void toggle(!on)}
          className={`flex w-full items-center justify-between gap-3 rounded-2xl border px-3.5 py-3 text-right transition disabled:opacity-60 ${
            on ? 'border-blush-300 bg-blush-50' : 'border-blush-100 bg-white hover:bg-blush-50/50'
          }`}
        >
          <span className="min-w-0">
            <span className="block text-[12.5px] font-extrabold text-ink-900">
              {busy ? 'در حال ذخیره…' : on ? 'روشن است' : 'روشن کن'}
            </span>
            <span className="mt-0.5 block text-[10.5px] leading-5 text-ink-500">
              {on
                ? 'این دستگاه ثبت شده است.'
                : 'یک بار اجازه می‌خواهد، بعد از آن بی‌صدا کار می‌کند.'}
            </span>
          </span>
          <span
            className={`relative h-6 w-11 shrink-0 rounded-full transition ${
              on ? 'bg-blush-500' : 'bg-blush-200'
            }`}
            aria-hidden="true"
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-all ${
                on ? 'right-0.5' : 'right-5.5'
              }`}
            />
          </span>
        </button>
      )}

      {on && !blocked && (
        <button
          type="button"
          onClick={() => void handleTest()}
          disabled={testing}
          className="btn-ghost w-full !py-2.5 text-[12px] disabled:opacity-60"
        >
          {testing ? 'در حال فرستادن…' : 'یک نوتیفیکیشن آزمایشی بفرست'}
        </button>
      )}

      {devices.length > 0 && (
        <p className="text-[10px] leading-5 text-ink-500">
          {devices.length === 1
            ? 'یک دستگاه ثبت شده است.'
            : `${devices.length.toLocaleString('fa-IR')} دستگاه ثبت شده است.`}{' '}
          اگر گوشی عوض کردی، از همان گوشی خاموشش کن تا این لیست تمیز بماند.
        </p>
      )}

      <p className="rounded-xl bg-lilac-100/60 px-3 py-2 text-[10px] leading-5 text-ink-700">
        نوتیفیکیشن هیچ‌وقت متن پیام نمی‌فرستد: فقط عنوان و یک جمله‌ی کوتاه. تاریخ‌های چرخه فقط
        وقتی در آن می‌آید که خودت اشتراک‌گذاری را روشن کرده باشی، و اگر یادآوری‌ها را خاموش کنی
        هیچ نوتیفیکیشن تاریخی نمی‌آید.
      </p>
    </section>
  )
}

/** Every refusal has a specific, actionable Persian sentence. */
function messageFor(reason: string): string {
  switch (reason) {
    case 'denied':
      return 'اجازه ندادی. از تنظیمات مرورگر می‌توانی بعداً روشنش کنی.'
    case 'dismissed':
      return 'پنجره‌ی اجازه بسته شد. دوباره امتحان کن و «Allow» را بزن.'
    case 'ios-not-installed':
      return 'روی آیفون اول باید کنارت را به صفحه‌ی خانه اضافه کنی.'
    case 'server-disabled':
      return 'نوتیفیکیشن روی سرور هنوز تنظیم نشده است.'
    case 'bad-key':
      return 'کلید نوتیفیکیشن درست نیست. به مدیر خبر بده.'
    case 'subscribe-failed':
      return 'مرورگر نتوانست عضو شود. یک بار صفحه را تازه کن.'
    case 'insecure':
      return 'این صفحه امن نیست؛ نوتیفیکیشن فقط روی https کار می‌کند.'
    default:
      return 'این دستگاه نمی‌تواند نوتیفیکیشن بگیرد.'
  }
}
