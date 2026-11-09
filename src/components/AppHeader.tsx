import { Link } from 'react-router-dom'
import Logo from './Logo'
import Avatar from './Avatar'
import { useAuth } from '../hooks/useAuth'

export default function AppHeader() {
  const { profile, signOut } = useAuth()

  return (
    <header className="sticky top-0 z-30 border-b border-white/60 bg-cream/80 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-lg items-center justify-between px-5 py-3">
        <Link to="/app" aria-label="خانه‌ی کنارت">
          <Logo withWordmark={false} />
        </Link>

        <div className="flex items-center gap-2">
          <Link
            to="/settings"
            aria-label="تنظیمات"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-white/80 text-ink-500 shadow-card transition hover:text-blush-600"
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.7" />
              <path
                d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.55-1.1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.55 1z"
                stroke="currentColor"
                strokeWidth="1.4"
              />
            </svg>
          </Link>

          <button
            type="button"
            onClick={() => {
              if (confirm('از حسابت خارج می‌شوی؟')) void signOut()
            }}
            aria-label="خروج از حساب"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-white/80 text-ink-500 shadow-card transition hover:text-red-500"
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M15 17l5-5-5-5M20 12H9M12 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h6"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>

          <Link to="/settings" aria-label="پروفایل من">
            <Avatar src={profile?.avatar_url} name={profile?.display_name} size={36} />
          </Link>
        </div>
      </div>
    </header>
  )
}
