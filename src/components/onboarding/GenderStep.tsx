import type { Gender } from '../../types/database'

interface Props {
  value: Gender | null
  onChange: (gender: Gender) => void
}

const OPTIONS: { gender: Gender; title: string; hint: string; emoji: string }[] = [
  { gender: 'girl', title: 'دختر', hint: 'بخش پیش‌بینی پریود هم فعال می‌شود', emoji: '🌸' },
  { gender: 'boy', title: 'پسر', hint: 'بدون بخش پریود', emoji: '🌿' },
]

export default function GenderStep({ value, onChange }: Props) {
  return (
    <div className="space-y-3">
      {OPTIONS.map((option) => {
        const active = value === option.gender
        return (
          <button
            key={option.gender}
            type="button"
            onClick={() => onChange(option.gender)}
            aria-pressed={active}
            className={`flex w-full items-center gap-4 rounded-none border p-4 text-right transition-all duration-200 ${
              active ? 'border-[#1a1424] bg-[#ffd23f] shadow-[4px_4px_0_#1a1424]' : 'tile tile-hover border-[#1a1424]'
            }`}
          >
            <span
              className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-none text-2xl ${
                active ? 'bg-[#1a1424]' : 'bg-[#1a1424]'
              }`}
              aria-hidden="true"
            >
              {option.emoji}
            </span>
            <span className="flex-1">
              <span className="block text-[16px] font-extrabold text-ink-900">{option.title}</span>
              <span className="mt-0.5 block text-[12px] text-ink-500">{option.hint}</span>
            </span>
            <span
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition ${
                active ? 'border-blush-600 bg-blush-600' : 'tile border-[#1a1424]'
              }`}
              aria-hidden="true"
            >
              {active && (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M5 12.5l4.5 4.5L19 7"
                    stroke="#fff"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </span>
          </button>
        )
      })}
    </div>
  )
}
