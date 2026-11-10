import JalaliDatePicker from '../JalaliDatePicker'
import { todayIso } from '../../lib/jalali'

export interface PeriodDraft {
  lastPeriodStart: string | null
  cycleLength: number
  periodLength: number
  isRegular: boolean
}

interface Props {
  value: PeriodDraft
  onChange: (next: Partial<PeriodDraft>) => void
  errors: { lastPeriodStart?: string }
}

export default function PeriodStep({ value, onChange, errors }: Props) {
  const today = todayIso()
  const minIso = shiftYears(today, -1)

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-blush-100 bg-blush-50/70 px-4 py-3">
        <p className="text-[12px] leading-6 text-ink-700">
          🔒 این اطلاعات <span className="font-bold">فقط برای خودت</span> قابل مشاهده است؛ حتی شریکت
          هم به آن دسترسی ندارد.
        </p>
      </div>

      <JalaliDatePicker
        id="last-period-start"
        label="اولین روز آخرین پریودت"
        value={value.lastPeriodStart}
        onChange={(iso) => onChange({ lastPeriodStart: iso })}
        maxIso={today}
        minIso={minIso}
        error={errors.lastPeriodStart}
        placeholder="تاریخ شمسی را انتخاب کن"
      />

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="cycle-length">
            طول چرخه
          </label>
          <div className="relative">
            <input
              id="cycle-length"
              type="number"
              inputMode="numeric"
              min={15}
              max={60}
              className="field pl-14"
              value={value.cycleLength}
              onChange={(event) => {
                const raw = Number(event.target.value)
                onChange({ cycleLength: Number.isFinite(raw) ? raw : 28 })
              }}
            />
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-[12px] text-ink-500">
              روز
            </span>
          </div>
          <p className="hint mt-1.5">پیش‌فرض ۲۸</p>
        </div>

        <div>
          <label className="label" htmlFor="period-length">
            طول پریود
          </label>
          <div className="relative">
            <input
              id="period-length"
              type="number"
              inputMode="numeric"
              min={1}
              max={15}
              className="field pl-14"
              value={value.periodLength}
              onChange={(event) => {
                const raw = Number(event.target.value)
                onChange({ periodLength: Number.isFinite(raw) ? raw : 5 })
              }}
            />
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-[12px] text-ink-500">
              روز
            </span>
          </div>
          <p className="hint mt-1.5">پیش‌فرض ۵</p>
        </div>
      </div>

      <fieldset>
        <legend className="label">چرخه‌ات منظم است؟</legend>
        <div className="grid grid-cols-2 gap-2">
          {[
            { label: 'بله، منظمه', value: true },
            { label: 'نه، نامنظمه', value: false },
          ].map((option) => {
            const active = value.isRegular === option.value
            return (
              <button
                key={String(option.value)}
                type="button"
                onClick={() => onChange({ isRegular: option.value })}
                aria-pressed={active}
                className={`rounded-2xl border px-3 py-3 text-[13px] font-bold transition ${
                  active
                    ? 'border-blush-400 bg-blush-500 text-white shadow-soft'
                    : 'border-blush-200 bg-white text-ink-700 hover:border-blush-300'
                }`}
              >
                {option.label}
              </button>
            )
          })}
        </div>
      </fieldset>

      <p className="hint">
        بر اساس همین چند عدد، روزهای بعدی را تخمین می‌زنیم و روز قبلش یادت می‌اندازیم. این بخش فقط
        برای خودت است.
      </p>
    </div>
  )
}

function shiftYears(iso: string, years: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  return `${y + years}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}
