import Avatar from './Avatar'
import type { CoupleRequestSummary } from '../types/database'

interface Props {
  title: string
  hint?: string
  items: CoupleRequestSummary[]
  actionLabel: string
  onAction: (item: CoupleRequestSummary) => void
  pendingId: string | null
  variant?: 'incoming' | 'outgoing'
}

export default function RequestList({
  title,
  hint,
  items,
  actionLabel,
  onAction,
  pendingId,
  variant = 'incoming',
}: Props) {
  if (items.length === 0) return null

  return (
    <section className="card p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="text-[14px] font-extrabold text-ink-900">{title}</h3>
        <span className="rounded-full bg-blush-100 px-2 py-0.5 text-[11px] font-bold text-blush-700">
          {fa(items.length)}
        </span>
      </div>
      {hint && <p className="mb-3 text-[11.5px] leading-5 text-ink-500">{hint}</p>}

      <ul className="space-y-2">
        {items.map((item) => (
          <li
            key={item.couple_id}
            className="flex items-center gap-3 rounded-2xl border border-blush-100 bg-white px-3 py-2.5"
          >
            <Avatar src={item.avatar_url} name={item.display_name} size={42} />

            <div className="min-w-0 flex-1">
              <p className="truncate text-[13.5px] font-bold text-ink-900">
                {item.display_name ?? 'کاربر کنارت'}
              </p>
              <p className="text-[11px] text-ink-500">
                {variant === 'incoming' ? 'می‌خواهد به تو وصل شود' : 'منتظر پاسخش هستی'}
              </p>
            </div>

            <button
              type="button"
              onClick={() => onAction(item)}
              disabled={pendingId === item.couple_id}
              className={`shrink-0 rounded-xl px-3 py-1.5 text-[11.5px] font-bold transition active:scale-95 disabled:opacity-50 ${
                variant === 'incoming'
                  ? 'bg-mint-100 text-mint-500 hover:bg-mint-500 hover:text-white'
                  : 'bg-blush-50 text-blush-700 hover:bg-blush-100'
              }`}
            >
              {pendingId === item.couple_id ? '...' : actionLabel}
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

function fa(value: number): string {
  return String(value).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)])
}
