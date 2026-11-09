import { Link } from 'react-router-dom'
import Logo, { HeartMark } from '../components/Logo'
import { useAuth } from '../hooks/useAuth'

const FEATURES = [
  {
    title: 'کد جفت‌شدن',
    body: 'یک کد ۸ حرفی، فقط برای تو. اون را برای شریکت می‌فرستی و با یک تأیید به هم وصل می‌شوید.',
    icon: (
      <>
        <rect x="3" y="6" width="18" height="12" rx="4" stroke="currentColor" strokeWidth="1.7" fill="none" />
        <path d="M8 12h8M12 8v8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </>
    ),
  },
  {
    title: 'خصوصی و امن',
    body: 'چرخه‌ی پریود فقط برای خودت قابل مشاهده است؛ حتی شریکت هم به آن دسترسی ندارد.',
    icon: (
      <>
        <rect x="5" y="10" width="14" height="10" rx="3" stroke="currentColor" strokeWidth="1.7" fill="none" />
        <path d="M8.5 10V8a3.5 3.5 0 1 1 7 0v2" stroke="currentColor" strokeWidth="1.7" fill="none" />
      </>
    ),
  },
  {
    title: 'شروع ساده',
    body: 'بدون نصب اپلیکیشن. روی گوشی و مرورگر کار می‌کند و حالت‌هایت ذخیره می‌شود.',
    icon: (
      <>
        <rect x="7" y="3" width="10" height="18" rx="3" stroke="currentColor" strokeWidth="1.7" fill="none" />
        <path d="M10.5 18h3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </>
    ),
  },
]

export default function LandingPage() {
  const { status } = useAuth()
  const signedIn = status === 'signed-in'

  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-5 py-5 sm:px-8">
        <Logo />
        <nav className="flex items-center gap-2">
          {signedIn ? (
            <Link to="/app" className="btn-primary !px-4 !py-2 text-[13px]">
              ورود به کنارت
            </Link>
          ) : (
            <>
              <Link to="/login" className="btn-ghost !px-4 !py-2 text-[13px]">
                ورود
              </Link>
              <Link to="/signup" className="btn-primary !px-4 !py-2 text-[13px]">
                ثبت‌نام
              </Link>
            </>
          )}
        </nav>
      </header>

      <main className="mx-auto w-full max-w-5xl px-5 sm:px-8">
        {/* Hero */}
        <section className="relative overflow-hidden rounded-[2rem] border border-white bg-white/70 shadow-soft">
          <div className="grid gap-0 sm:grid-cols-2">
            <div className="order-2 flex flex-col justify-center p-7 sm:order-1 sm:p-10">
              <span className="mb-4 inline-flex w-fit items-center gap-1.5 rounded-full bg-blush-100 px-3 py-1 text-[11px] font-bold text-blush-700">
                <HeartMark className="h-3.5 w-3.5" />
                برای دل‌هایی که دورند
              </span>

              <h1 className="text-balance text-[26px] font-extrabold leading-[1.5] text-ink-900 sm:text-[32px]">
                هرچند کیلومترها دوریم،
                <br />
                <span className="text-blush-600">کنارت</span>م.
              </h1>

              <p className="mt-4 max-w-md text-[14px] leading-7 text-ink-700">
                کنارت فضای خصوصیِ دو نفره‌ی شماست؛ جایی که با یک کد، به هم وصل می‌شوید، به روزهای
                مهم شریکت نزدیک می‌مانید و فقط شما دو نفر می‌بینید.
              </p>

              <div className="mt-7 flex flex-wrap gap-3">
                <Link to={signedIn ? '/app' : '/signup'} className="btn-primary">
                  {signedIn ? 'برو به صفحه‌ی من' : 'شروع کنیم'}
                </Link>
                <Link to="/login" className="btn-ghost">
                  حساب دارم
                </Link>
              </div>

              <p className="mt-5 text-[11px] leading-5 text-ink-500">
                ثبت‌نام با ایمیل انجام می‌شود؛ ایمیلت را تأیید کن تا حسابت فعال شود.
              </p>
            </div>

            <div className="order-1 sm:order-2">
              <img
                src={`${import.meta.env.BASE_URL}og-cover.png`}
                alt="دو قلب کاغذی که به سمت هم پرواز می‌کنند"
                className="h-48 w-full object-cover sm:h-full"
                loading="eager"
              />
            </div>
          </div>
        </section>

        {/* Features */}
        <section className="mt-8 grid gap-3 sm:grid-cols-3">
          {FEATURES.map((feature) => (
            <div key={feature.title} className="card p-5">
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-2xl bg-blush-100 text-blush-600">
                <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
                  {feature.icon}
                </svg>
              </div>
              <h2 className="text-[15px] font-bold text-ink-900">{feature.title}</h2>
              <p className="mt-1.5 text-[13px] leading-6 text-ink-500">{feature.body}</p>
            </div>
          ))}
        </section>

        {/* Steps */}
        <section className="mt-8 card overflow-hidden">
          <div className="border-b border-blush-100 bg-white/60 px-6 py-4">
            <h2 className="text-[16px] font-extrabold text-ink-900">کنارت توی سه قدم</h2>
          </div>
          <ol className="divide-y divide-blush-100">
            {[
              ['حساب بساز', 'با ایمیل ثبت‌نام کن و ایمیلت را تأیید کن.'],
              ['خودت را معرفی کن', 'جنسیت، اسم، تاریخ تولد و علاقه‌مندی‌هایت را وارد کن.'],
              ['کدت را بفرست', 'کد ۸ حرفی‌ات را برای شریکت بفرست و منتظر تأییدش باش.'],
            ].map(([title, body], index) => (
              <li key={title} className="flex items-start gap-4 px-6 py-4">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blush-500 text-[12px] font-bold text-white">
                  {['۱', '۲', '۳'][index]}
                </span>
                <div>
                  <h3 className="text-[14px] font-bold text-ink-900">{title}</h3>
                  <p className="mt-0.5 text-[12.5px] leading-6 text-ink-500">{body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <footer className="mt-10 border-t border-blush-100 py-6 text-center">
          <p className="text-[11.5px] leading-6 text-ink-500">
            ساخته‌شده با ❤ برای فاصله‌هایی که یک روز تمام می‌شوند.
          </p>
        </footer>
      </main>
    </div>
  )
}
