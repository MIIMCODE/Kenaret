import { useCallback, useEffect, useState } from 'react'
import Alert from './Alert'
import Spinner from './Spinner'
import {
  fetchCycleShared,
  fetchPairingState,
  shareCycleWithPartner,
  stopSharingCycle,
} from '../lib/api'

/**
 * The girl's control over what her partner may know about her cycle.
 *
 * Deliberately built around three states, because the difference between
 * "off" and "on" is the whole point:
 *
 *   1. off, never shared  → a calm invitation, nothing is visible to him
 *   2. off, was shared    → "you stopped it", with the promise that it stays off
 *   3. on                 → a loud, unmissable banner saying he can see her phase
 *
 * Nothing here is saved on load; turning it on is always one deliberate tap.
 */
export default function CycleShareSettings({ hasCycle }: { hasCycle: boolean }) {
  const [shared, setShared] = useState<boolean | null>(null)
  const [everShared, setEverShared] = useState(false)
  const [paired, setPaired] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [flag, pairing] = await Promise.all([fetchCycleShared(), fetchPairingState()])
      setShared(flag)
      if (flag) setEverShared(true)
      setPaired(Boolean(pairing.partner))
    } catch {
      setShared(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const turnOn = async () => {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await shareCycleWithPartner()
      setShared(true)
      setEverShared(true)
      setNotice('به اشتراک گذاشته شد. حالا شریکت می‌داند این روزها چه حالی داری.')
    } catch (err) {
      const code = (err as { message?: string })?.message ?? ''
      setError(
        code.includes('NO_CYCLE_DATA')
          ? 'اول تاریخ شروع آخرین پریودت را ذخیره کن، بعد می‌توانی به اشتراک بگذاری.'
          : code.includes('NO_ACTIVE_COUPLE')
            ? 'برای به اشتراک گذاشتن باید شریک داشته باشی.'
            : 'به اشتراک گذاشتن انجام نشد. یک‌بار دیگر امتحان کن.',
      )
    } finally {
      setBusy(false)
    }
  }

  const turnOff = async () => {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await stopSharingCycle()
      setShared(false)
      setNotice('اشتراک‌گذاری خاموش شد. از همین حالا چیزی از چرخه‌ات نمی‌بیند.')
    } catch {
      setError('خاموش کردن انجام نشد. یک‌بار دیگر امتحان کن.')
    } finally {
      setBusy(false)
    }
  }

  if (shared === null) {
    return (
      <div className="flex items-center gap-2 py-2 text-[12px] text-ink-500">
        <Spinner className="h-4 w-4" />
        در حال بررسی…
      </div>
    )
  }

  const disabled = busy || !paired || !hasCycle

  return (
    <div className="tile space-y-3 rounded-2xl p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[12.5px] font-extrabold text-ink-900">اشتراک‌گذاری با شریکم</p>
          <p className="mt-1 text-[11px] leading-5 text-ink-500">
            اگر روشنش کنی، شریکت فقط می‌فهمد این روزها پریود هستی یا نزدیکش است — نه تاریخ‌ها، نه
            طول چرخه. هر وقت بخواهی می‌توانی خاموشش کنی.
          </p>
        </div>
      </div>

      {shared ? (
        <div className="rounded-2xl border border-blush-300 bg-blush-50 px-3.5 py-3">
          <p className="flex items-center gap-1.5 text-[12px] font-extrabold text-blush-800">
            <span aria-hidden="true">👁</span> الان روشن است — شریکت می‌بیند
          </p>
          <p className="mt-1 text-[11px] leading-5 text-ink-700">
            در صفحه‌ی «روزهای مهم» یک کارت کوچک برایش نشان داده می‌شود. هیچ تاریخی برایش نمایش
            داده نمی‌شود.
          </p>
        </div>
      ) : (
        <div className="rounded-2xl bg-blush-50/70 px-3.5 py-3">
          <p className="text-[12px] font-extrabold text-ink-700">
            {everShared ? 'خاموش است — از وقتی خاموش کردی چیزی نمی‌بیند' : 'خاموش است — چیزی نمی‌بیند'}
          </p>
          <p className="mt-1 text-[11px] leading-5 text-ink-500">
            این اطلاعات پیش‌فرض فقط برای خودت است.
          </p>
        </div>
      )}

      {!paired && (
        <p className="text-[11px] leading-5 text-ink-500">
          هنوز شریکی وصل نیست؛ بعد از وصل شدن می‌توانی این را روشن کنی.
        </p>
      )}

      {paired && !hasCycle && (
        <p className="text-[11px] leading-5 text-ink-500">
          اول تاریخ شروع آخرین پریودت را ذخیره کن.
        </p>
      )}

      {error && <Alert tone="error">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}

      <button
        type="button"
        onClick={shared ? turnOff : turnOn}
        disabled={disabled}
        className={shared ? 'btn-ghost w-full !py-2.5 text-[12.5px]' : 'btn-soft w-full !py-2.5 text-[12.5px]'}
      >
        {busy ? <Spinner className="h-4 w-4" /> : null}
        {shared ? 'خاموشش کن' : 'به اشتراک بگذار'}
      </button>
    </div>
  )
}
