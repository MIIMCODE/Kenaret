import type { ReactNode } from 'react'

type Tone = 'error' | 'success' | 'info'

const TONES: Record<Tone, { wrap: string; icon: string; glyph: ReactNode }> = {
  error: {
    wrap: 'border-red-200 bg-red-50 text-red-700',
    icon: 'text-red-500',
    glyph: (
      <>
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" fill="none" />
        <path d="M12 7.5v5.5M12 16.4v.2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </>
    ),
  },
  success: {
    wrap: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    icon: 'text-emerald-500',
    glyph: (
      <>
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" fill="none" />
        <path d="M8 12.4l2.6 2.6L16 9.6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </>
    ),
  },
  info: {
    wrap: 'border-lilac-300 bg-lilac-100 text-ink-700',
    icon: 'text-lilac-500',
    glyph: (
      <>
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" fill="none" />
        <path d="M12 11v5.5M12 7.6v.2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </>
    ),
  },
}

export default function Alert({
  tone = 'error',
  children,
  className = '',
}: {
  tone?: Tone
  children: ReactNode
  className?: string
}) {
  const style = TONES[tone]
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`flex items-start gap-2.5 rounded-2xl border px-3.5 py-3 text-[13px] font-medium leading-6 animate-fade-up ${style.wrap} ${className}`}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" className={`mt-0.5 shrink-0 ${style.icon}`}>
        {style.glyph}
      </svg>
      <div className="flex-1">{children}</div>
    </div>
  )
}
