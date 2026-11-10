/**
 * Translates Supabase / Postgres errors into Persian messages the user can act on.
 *
 * The RPCs raise stable machine codes (e.g. `SELF_CODE`) which we map here, so
 * the database never has to ship user-facing copy.
 */

const RPC_MESSAGES: Record<string, string> = {
  EMPTY_CODE: 'اول کد شریکت را وارد کن.',
  CODE_FORMAT: 'کد باید دقیقاً ۸ کاراکتر باشد: حروف انگلیسی بزرگ و رقم (بدون 0، O، 1 و I).',
  CODE_NOT_FOUND: 'کدی با این مشخصات پیدا نشد. کد را دوباره بررسی کن.',
  SELF_CODE: 'این کد خودت است! کد شریکت را وارد کن.',
  TARGET_INCOMPLETE: 'این کاربر هنوز پروفایلش را کامل نکرده و آماده‌ی وصل شدن نیست.',
  SELF_HAS_PARTNER: 'تو در حال حاضر به یک نفر وصل هستی. اول ارتباط فعلی را قطع کن.',
  TARGET_HAS_PARTNER: 'این کاربر در حال حاضر به یک نفر دیگر وصل است.',
  ALREADY_REQUESTED: 'قبلاً برای این کاربر درخواست فرستاده‌ای. منتظر پاسخش باش.',
  NOT_FOUND: 'این درخواست پیدا نشد. ممکن است لغو شده باشد.',
  NOT_YOURS: 'این درخواست برای تو نبوده.',
  NOT_PENDING: 'این درخواست دیگر در انتظار پاسخ نیست.',
  NOT_CANCELLABLE: 'این درخواست قابل لغو نیست.',
  SOMEONE_HAS_PARTNER: 'یکی از شما در حال حاضر شریک فعال دارد.',
  'auth required': 'برای این کار باید وارد حساب شوی.',
  NO_ACTIVE_COUPLE: 'برای این کار باید به یک نفر وصل باشی.',
  DATE_REQUIRED: 'اول تاریخ دیدار را انتخاب کن.',
  DATE_IN_PAST: 'این تاریخ گذشته؛ برای دیدار بعدی یک روز پیشِ رو انتخاب کن.',
  UNKNOWN_KIND: 'این نوع پیام شناخته نشد. صفحه را تازه کن.',
  TOO_MANY: 'چند لحظه صبر کن — بیشتر از این در یک ساعت نمی‌شود فرستاد.',
  EMPTY_MESSAGE: 'پیام خالی است. یک چیزی بنویس.',
  MESSAGE_TOO_LONG: 'پیام بیش از حد بلند است؛ کوتاه‌ترش کن.',
  DELETED: 'این پیام حذف شده و دیگر ویرایش نمی‌شود.',
  NOT_EDITABLE: 'فقط پیام‌های متنی ویرایش می‌شوند.',
  BAD_PATH: 'عکس درست آپلود نشد. یک بار دیگر امتحان کن.',
  ALREADY_TODAY: 'برای امروز عکس گذاشته‌ای. اگر پشیمانی، همان را عوض کن.',
  NOTHING_TODAY: 'برای امروز عکسی نداری که عوض شود.',
  OWN_PHOTO: 'قلب مال عکس شریکت است، نه عکس خودت.',
  ALREADY_SETUP: 'این اتاق قبلاً ساخته شده. با همان رمز بازش کن.',
  BAD_KEY_MATERIAL: 'ساخت قفل ناقص شد. یک بار دیگر امتحان کن.',
  VAULT_LOCKED: 'این اتاق هنوز قفل ندارد. اول برایش رمز بگذار.',
  EMPTY_NOTE: 'نوشته خالی است. یک چیزی بنویس.',
}

const AUTH_MESSAGES: Record<string, string> = {
  invalid_credentials: 'ایمیل یا رمز عبور درست نیست.',
  email_not_confirmed: 'ایمیلت هنوز تأیید نشده. ایمیل صندوق ورودی (و اسپم) را چک کن.',
  user_already_exists: 'با این ایمیل قبلاً حساب ساخته شده. وارد شو.',
  email_exists: 'با این ایمیل قبلاً حساب ساخته شده. وارد شو.',
  weak_password: 'رمز عبور خیلی ضعیف است. حداقل ۶ کاراکتر استفاده کن.',
  signup_disabled: 'ثبت‌نام فعلاً غیرفعال است.',
  over_email_send_rate_limit:
    'سایت این لحظه شلوغه و سرویس ایمیل مهلت می‌خواهد. حسابت ساخته شده — چند دقیقه بعد دوباره امتحان کن.',
  over_request_rate_limit: 'درخواست‌های زیادی ثبت شده. کمی بعد دوباره تلاش کن.',
  same_password: 'رمز جدید نباید با رمز فعلی یکی باشد.',
  session_not_found: 'نشستت منقضی شده. دوباره وارد شو.',
  validation_failed: 'ایمیل وارد شده معتبر نیست.',
  otp_expired: 'لینک تأیید منقضی شده. دوباره درخواست بده.',
}

interface SupabaseLikeError {
  message?: string
  code?: string
  error_description?: string
  details?: string
}

const RAW_MESSAGE_MAP: Record<string, string> = {
  'Invalid login credentials': AUTH_MESSAGES.invalid_credentials,
  'Email not confirmed': AUTH_MESSAGES.email_not_confirmed,
  'User already registered': AUTH_MESSAGES.user_already_exists,
  'Email link is invalid or has expired': AUTH_MESSAGES.otp_expired,
  'Auth session missing!': 'نشستت منقضی شده. دوباره وارد شو.',
  'Failed to fetch': 'اتصال به سرور برقرار نشد. اینترنتت را چک کن.',
  'Network request failed': 'اتصال به سرور برقرار نشد. اینترنتت را چک کن.',
}

/** Extracts the machine code out of a Postgres RAISE payload. */
export function errorCodeOf(error: unknown): string | null {
  const e = error as SupabaseLikeError | null
  if (!e) return null
  const raw = e.message ?? e.error_description ?? ''
  // Postgres prefixes a custom code with the migration class, e.g. "P0001:SELF_CODE".
  const match = /:([A-Z0-9_]{3,40})$/.exec(raw)
  if (match) return match[1]
  if (raw in RPC_MESSAGES) return raw
  return null
}

export function toPersianError(error: unknown, fallback = 'یه مشکلی پیش آمد. دوباره تلاش کن.'): string {
  const e = (error ?? {}) as SupabaseLikeError
  const raw = (e.message ?? e.error_description ?? '').trim()

  // 1) Machine codes raised by our own SQL functions.
  const code = errorCodeOf(error)
  if (code && RPC_MESSAGES[code]) return RPC_MESSAGES[code]

  // 2) Known Supabase auth messages.
  if (e.code && AUTH_MESSAGES[e.code]) return AUTH_MESSAGES[e.code]
  if (raw && AUTH_MESSAGES[raw]) return AUTH_MESSAGES[raw]
  if (raw && RAW_MESSAGE_MAP[raw]) return RAW_MESSAGE_MAP[raw]

  // 3) Anything already written in Persian passes straight through.
  if (/[\u0600-\u06FF]/.test(raw)) return raw

  // 4) Postgres constraint hits we can explain.
  if (e.code === '23505') return 'این اطلاعات قبلاً ثبت شده است.'
  if (e.code === '23503') return 'اطلاعات مرتبط پیدا نشد. صفحه را تازه کن.'
  if (e.code === '42501' || e.code === 'PGRST301') return 'اجازه‌ی این کار را نداری.'
  if (e.code === 'PGRST116') return 'موردی پیدا نشد.'

  return fallback
}
