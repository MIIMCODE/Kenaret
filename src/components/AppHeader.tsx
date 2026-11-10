import { Link } from 'react-router-dom'
import Logo from './Logo'
import ReminderBell from './ReminderBell'

/**
 * The header is now only the wordmark.
 *
 * Settings, avatar and sign-out moved to `BottomNav`, inside the thumb's
 * reach; sign-out now lives in Settings, where a destructive button does not
 * sit one mis-tap from the logo.
 *
 * The reminder bell stays. It is not a destination — it is a thing that
 * interrupts, and an interruption belongs at the top of the screen where the
 * system puts its own, not tucked between four tabs. It is also the only way
 * a reminder reaches anyone while email delivery is still unsolved.
 */
export default function AppHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-white/60 bg-cream/80 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-lg items-center justify-between px-5 py-3">
        {/* Balancing spacer: keeps the mark optically centred without
            absolute-positioning it, which would break the sticky blur. */}
        <span aria-hidden="true" className="h-9 w-9" />

        <Link to="/app" aria-label="خانه‌ی کنارت">
          <Logo withWordmark={false} />
        </Link>

        <ReminderBell />
      </div>
    </header>
  )
}
