export default function Spinner({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg
      className={`animate-spin ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      role="status"
      aria-label="در حال بارگذاری"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function FullPageLoader({ label = 'یک لحظه...' }: { label?: string }) {
  return (
    <div className="flex min-h-[70dvh] flex-col items-center justify-center gap-4 text-blush-500">
      <Spinner className="h-8 w-8" />
      <p className="text-[13px] font-medium text-ink-500">{label}</p>
    </div>
  )
}
