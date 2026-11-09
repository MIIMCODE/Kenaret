import { Link } from 'react-router-dom'
import Logo from '../components/Logo'

export default function NotFoundPage() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6 text-center">
      <Logo />
      <div>
        <p className="text-[64px] font-extrabold leading-none text-blush-200">۴۰۴</p>
        <h1 className="mt-3 text-[18px] font-extrabold text-ink-900">این صفحه پیدا نشد</h1>
        <p className="mt-2 text-[13px] leading-6 text-ink-500">
          شاید آدرس را اشتباه زده‌ای یا این صفحه دیگر وجود ندارد.
        </p>
      </div>
      <Link to="/" className="btn-primary">
        برگشت به خانه
      </Link>
    </div>
  )
}
