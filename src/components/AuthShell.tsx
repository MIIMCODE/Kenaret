import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'
import Logo from './Logo'

interface Props {
  title: string
  subtitle?: string
  children: ReactNode
  footer?: ReactNode
}

export default function AuthShell({ title, subtitle, children, footer }: Props) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="mx-auto flex w-full max-w-md items-center justify-between px-5 py-5">
        <Link to="/" aria-label="بازگشت به صفحه‌ی اصلی">
          <Logo />
        </Link>
        <Link to="/" className="text-[12.5px] font-semibold text-ink-500 transition hover:text-blush-600">
          صفحه‌ی اصلی
        </Link>
      </header>

      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-5 pb-12">
        <div className="card animate-fade-up p-6 sm:p-7">
          <h1 className="text-[21px] font-extrabold text-ink-900">{title}</h1>
          {subtitle && <p className="mt-2 text-[13px] leading-6 text-ink-500">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </div>
        {footer && <div className="mt-5 text-center text-[13px] text-ink-500">{footer}</div>}
      </main>
    </div>
  )
}
