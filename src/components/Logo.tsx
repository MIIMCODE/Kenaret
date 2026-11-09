interface Props {
  className?: string
  withWordmark?: boolean
}

/** The Kenaret heart mark — two halves leaning on each other. */
export function HeartMark({ className = 'h-10 w-10' }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="kenaret-heart" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffaec3" />
          <stop offset="0.55" stopColor="#f9628b" />
          <stop offset="1" stopColor="#e84874" />
        </linearGradient>
      </defs>
      <path
        d="M24 42C13.4 34.6 6 27.6 6 20.7 6 14.8 10.5 10.3 16.2 10.3c3.3 0 6.1 1.6 7.8 4.2 1.7-2.6 4.5-4.2 7.8-4.2C37.5 10.3 42 14.8 42 20.7c0 6.9-7.4 13.9-18 21.3z"
        fill="url(#kenaret-heart)"
      />
      <path
        d="M24 42V14.5"
        stroke="#fff"
        strokeOpacity="0.45"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeDasharray="2.4 3.2"
      />
    </svg>
  )
}

export default function Logo({ className = '', withWordmark = true }: Props) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <HeartMark className="h-9 w-9 drop-shadow-sm" />
      {withWordmark && (
        <div className="leading-none">
          <div className="text-[22px] font-extrabold tracking-tight text-ink-900">کنارت</div>
          <div className="mt-1 text-[10px] font-medium tracking-wide text-ink-500">
            همیشه کنار هم
          </div>
        </div>
      )}
    </div>
  )
}
