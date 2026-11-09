import JalaliDatePicker from '../JalaliDatePicker'
import { daysBetweenIso, todayIso } from '../../lib/jalali'

interface Props {
  name: string
  birthDate: string | null
  onNameChange: (name: string) => void
  onBirthDateChange: (iso: string) => void
  errors: { name?: string; birthDate?: string }
}

export default function IdentityStep({
  name,
  birthDate,
  onNameChange,
  onBirthDateChange,
  errors,
}: Props) {
  const today = todayIso()
  // 1900-01-01 floor keeps obvious typos out; the DB has the same guard.
  const minIso = '1930-01-01'

  const age = birthDate ? Math.floor(daysBetweenIso(birthDate, today) / 365.25) : null
  const ageIsOdd = age !== null && (age < 13 || age > 100)

  return (
    <div className="space-y-5">
      <div>
        <label className="label" htmlFor="display-name">
          اسمی که صدات می‌کنن
        </label>
        <input
          id="display-name"
          className={`field ${errors.name ? 'border-red-300 ring-2 ring-red-100' : ''}`}
          placeholder="مثلاً: سارا"
          value={name}
          maxLength={40}
          autoComplete="given-name"
          onChange={(event) => onNameChange(event.target.value)}
        />
        {errors.name ? (
          <p className="mt-1.5 text-[12px] font-medium text-red-500">{errors.name}</p>
        ) : (
          <p className="hint mt-1.5">این اسم را شریکت می‌بیند.</p>
        )}
      </div>

      <div>
        <JalaliDatePicker
          id="birth-date"
          label="تاریخ تولد (شمسی)"
          value={birthDate}
          onChange={onBirthDateChange}
          maxIso={today}
          minIso={minIso}
          defaultYear={1380}
          error={errors.birthDate}
          placeholder="مثلاً ۱۲ اسفند ۱۳۷۸"
        />
        {age !== null && !errors.birthDate && (
          <p className={`hint mt-1.5 ${ageIsOdd ? 'text-amber-600' : ''}`}>
            {ageIsOdd
              ? 'این تاریخ کمی عجیب به نظر می‌رسد؛ دوباره چکش کن.'
              : 'تاریخ تولدت فقط برای شریکت نمایش داده می‌شود.'}
          </p>
        )}
      </div>
    </div>
  )
}
