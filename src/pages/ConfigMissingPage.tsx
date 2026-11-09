/**
 * Shown only when the build ran without VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY.
 * Gives whoever deploys the site an actionable message instead of a white screen.
 */
export default function ConfigMissingPage() {
  return (
    <div className="flex min-h-dvh items-center justify-center px-5 py-10">
      <div className="card w-full max-w-md p-6">
        <h1 className="text-[18px] font-extrabold text-ink-900">تنظیمات اتصال کامل نیست</h1>
        <p className="mt-2 text-[13px] leading-6 text-ink-700">
          این نسخه بدون اطلاعات اتصال به Supabase ساخته شده است. برای فعال کردن کنارت، این دو مقدار
          را به‌عنوان <span className="font-bold">GitHub Actions Variables</span> (یا Secrets) اضافه
          کن و دوباره دیپلوی کن:
        </p>
        <pre
          dir="ltr"
          className="mt-4 overflow-x-auto rounded-2xl bg-ink-900/95 p-4 text-left text-[12px] leading-6 text-blush-100"
        >
          <code>
            VITE_SUPABASE_URL{'\n'}
            VITE_SUPABASE_ANON_KEY
          </code>
        </pre>
        <p className="mt-4 text-[12px] leading-6 text-ink-500">
          فقط آدرس پروژه و کلید <span dir="ltr">anon</span> لازم است. کلید{' '}
          <span dir="ltr">service_role</span> هرگز نباید در سایت قرار بگیرد.
        </p>
      </div>
    </div>
  )
}
