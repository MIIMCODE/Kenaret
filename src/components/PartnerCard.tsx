import Avatar from './Avatar'
import type { PairingState } from '../types/database'
import { daysBetweenIso, formatJalaliLong, todayIso } from '../lib/jalali'

type Partner = NonNullable<PairingState['partner']>

export default function PartnerCard({ partner, onUnlink }: { partner: Partner; onUnlink: () => void }) {
  const birthday = partner.birth_date
  const nextBirthday = birthday ? daysUntilNextBirthday(birthday) : null

  return (
    <section className="card overflow-hidden">
      <div className="relative px-5 pb-5 pt-6">
        <div
          className="absolute inset-x-0 top-0 h-24"
          style={{ backgroundImage: 'linear-gradient(135deg, #ffe9ef, #f3eefb)' }}
          aria-hidden="true"
        />

        <div className="relative flex flex-col items-center text-center">
          <Avatar src={partner.avatar_url} name={partner.display_name} size={88} ring />

          <h2 className="mt-3 text-[19px] font-extrabold text-ink-900">
            {partner.display_name ?? 'شریک تو'}
          </h2>

          <span className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-mint-100 px-3 py-1 text-[11px] font-bold text-mint-500">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-mint-500" />
            به هم وصل هستید
          </span>

          {birthday && (
            <p className="mt-3 text-[12.5px] text-ink-500">
              تولد: <span className="font-bold text-ink-700">{formatJalaliLong(birthday)}</span>
              {nextBirthday !== null && nextBirthday <= 30 && (
                <span className="mr-1.5 rounded-md bg-blush-100 px-1.5 py-0.5 text-[10.5px] font-bold text-blush-700">
                  {nextBirthday === 0 ? 'امروزه! 🎂' : `${fa(nextBirthday)} روز مانده`}
                </span>
              )}
            </p>
          )}
        </div>
      </div>

      {partner.interests.length > 0 && (
        <div className="border-t border-blush-100 px-5 py-4">
          <p className="mb-2 text-[11.5px] font-bold text-ink-500">علاقه‌مندی‌ها</p>
          <div className="flex flex-wrap gap-1.5">
            {partner.interests.map((interest) => (
              <span
                key={interest}
                className="rounded-full bg-blush-50 px-2.5 py-1 text-[12px] font-medium text-blush-700"
              >
                {interest}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="border-t border-blush-100 px-5 py-3">
        <button
          type="button"
          onClick={onUnlink}
          className="w-full rounded-xl py-2 text-[12px] font-semibold text-ink-500 transition hover:bg-red-50 hover:text-red-500"
        >
          قطع ارتباط با {partner.display_name ?? 'شریک'}
        </button>
      </div>
    </section>
  )
}

/** Whole days until the next occurrence of a birthday (0 = today). */
export function daysUntilNextBirthday(birthIso: string): number {
  const today = todayIso()
  const [, bm, bd] = birthIso.split('-').map(Number)
  const [ty] = today.split('-').map(Number)
  const thisYear = `${ty}-${String(bm).padStart(2, '0')}-${String(bd).padStart(2, '0')}`
  if (thisYear >= today) return daysBetweenIso(today, thisYear)
  const nextYear = `${ty + 1}-${String(bm).padStart(2, '0')}-${String(bd).padStart(2, '0')}`
  return daysBetweenIso(today, nextYear)
}

function fa(value: number): string {
  return String(value).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)])
}
