import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import AppHeader from '../components/AppHeader'
import Alert from '../components/Alert'
import Spinner from '../components/Spinner'
import HouseArt from '../components/HouseArt'
import { fetchHouseState, fetchPairingState, foundHouse, marryHouse } from '../lib/api'
import { toPersianError } from '../lib/errors'
import { formatJalaliLong, toPersianDigits, todayIso } from '../lib/jalali'
import type { HouseStateResult } from '../types/database'

/**
 * خانه — the house that gets built.
 *
 * One brick per day together, drawn a stage at a time. It is a slow game on
 * purpose: the only action either of them can take is to start it, and after
 * that the house does the work by them simply still being together.
 *
 * Three states, and the page is careful to keep them visually distinct:
 *   building  the pale, pastel, half-finished house
 *   home      married — the house is lit, has smoke, and stops growing
 *   ruined    cracked, tilted, grey; frozen forever
 */
export default function HousePage() {
  const [state, setState] = useState<HouseStateResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  /** Two taps before a marriage, because there is no undo. */
  const [marryArmed, setMarryArmed] = useState(false)
  const [hasPartner, setHasPartner] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [house, pairing] = await Promise.all([
        fetchHouseState(),
        fetchPairingState().catch(() => null),
      ])
      setState(house)
      setHasPartner(Boolean(pairing?.partner))
    } catch (err) {
      setError(toPersianError(err, 'خانه باز نشد. یک‌بار دیگر تلاش کن.'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const found = useCallback(async () => {
    setBusy('found')
    setError(null)
    setNotice(null)
    try {
      await foundHouse()
      await load()
      setNotice('پی گذاشته شد 🤍 از همین امروز، هر روز با هم یک آجر.')
    } catch (err) {
      setError(toPersianError(err, 'خانه ساخته نشد. یک‌بار دیگر تلاش کن.'))
    } finally {
      setBusy(null)
    }
  }, [load])

  const marry = useCallback(async () => {
    if (!marryArmed) {
      setMarryArmed(true)
      setNotice('مطمئنی؟ خانه دیگر بزرگ نمی‌شود — فقط روشن می‌ماند. یک‌بار دیگر بزن.')
      return
    }
    setBusy('marry')
    setError(null)
    try {
      await marryHouse()
      await load()
      setNotice('خانه‌تان شد 🤍 از این به بعد در همین زندگی می‌کنید.')
    } catch (err) {
      setError(toPersianError(err, 'ثبت نشد. یک‌بار دیگر تلاش کن.'))
    } finally {
      setBusy(null)
      setMarryArmed(false)
    }
  }, [marryArmed, load])

  const house = state?.house ?? null

  /**
   * The slugs already built, for the artwork. The server sends `stages` as the
   * subset of the plan that is standing, so this is a straight map — the page
   * never decides what is built.
   */
  const built = useMemo(
    () => (house?.stages ?? []).map((s) => s.slug as never),
    [house],
  )

  const progress = useMemo(() => {
    if (!house) return null
    if (!house.next) return { pct: 100, toNext: 0 }
    const from = house.stage?.at_bricks ?? 0
    const to = house.next.at_bricks
    const pct = Math.max(0, Math.min(100, ((house.bricks - from) / (to - from)) * 100))
    return { pct, toNext: to - house.bricks }
  }, [house])

  const today = todayIso()

  if (loading) {
    return (
      <div className="min-h-dvh">
        <AppHeader />
        <div className="page">
          <Spinner className="mx-auto mt-20 h-8 w-8 text-[#c4194a]" />
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-dvh">
      <AppHeader />

      <main className="page space-y-4">
        <section className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-black uppercase tracking-[0.16em] text-[#4a3f5c]">یک بازی آرام</p>
            <h1 className="poster-type mt-1 text-[26px] text-[#1a1424]">خانه</h1>
            <p className="mt-1.5 text-[11.5px] leading-6 font-semibold text-[#4a3f5c]">
              هر روزی که با هم هستید، یک آجر. خانه آن‌قدر ساخته می‌شود تا یک روز در آن زندگی کنید.
            </p>
          </div>
        </section>

        {error && <Alert tone="error">{error}</Alert>}
        {notice && <Alert tone="success">{notice}</Alert>}

        {/* ================= the house ================= */}
        {house && (
          <>
            <section className="card overflow-hidden rounded-[1.75rem] p-5">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[11px] font-black uppercase tracking-[0.14em] text-[#4a3f5c]">
                  {house.state === 'home' ? 'خانه‌ی شما' : 'در حال ساخت'}
                </p>
                <span className="border-2 border-[#1a1424] bg-[#ffd23f] px-2 py-1 text-[11px] font-black text-[#1a1424]">
                  {toPersianDigits(house.bricks)} آجر
                </span>
              </div>

              <div className="mt-2">
                <HouseArt
                  built={built}
                  ghost={(house.next?.slug as never) ?? null}
                  ruined={house.state === 'ruined'}
                  livedIn={house.state === 'home'}
                />
              </div>

              {house.state === 'building' && progress && (
                <div className="mt-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-[12px] font-extrabold text-[#1a1424]">
                      {house.next ? `بعدی: ${house.next.title}` : 'همه‌چیز ساخته شد'}
                    </p>
                    {house.next && (
                      <p className="text-[11px] font-bold text-[#4a3f5c]">
                        {toPersianDigits(progress.toNext)} روز مانده
                      </p>
                    )}
                  </div>
                  {/* A brick meter, not a progress bar: it fills in steps. */}
                  <div className="mt-2 h-3 w-full border-2 border-[#1a1424] bg-[#ffefda]">
                    {/*
                      #f0355a, not the theme pink. The brand pink measures
                      2.85:1 against the #ffefda track — under the 3:1 floor
                      for a non-text indicator, which is exactly the kind of
                      thing that looks fine on a bright screen and invisible
                      on a dim one. This is 3.47:1 and still reads as pink.
                    */}
                    <div
                      className="h-full bg-[#f0355a]"
                      style={{ width: `${Math.max(2, progress.pct)}%` }}
                    />
                  </div>
                </div>
              )}

              {house.state === 'home' && (
                <p className="mt-2 border-2 border-[#1a1424] bg-[#ddfaf3] px-3 py-2.5 text-[12px] leading-6 font-bold text-[#1a1424]">
                  از {formatJalaliLong(house.became_home_on ?? today)} این خانه خانه‌ی شماست.
                  {house.bricks > 0 && ` با ${toPersianDigits(house.bricks)} آجر ساخته شد.`}
                </p>
              )}
            </section>

            {/* ================= what is standing ================= */}
            <section className="card rounded-[1.75rem] p-5">
              <h2 className="text-[14px] font-extrabold text-[#1a1424]">چه چیزی ساخته شده</h2>
              <p className="mt-1 text-[11.5px] leading-6 font-semibold text-[#4a3f5c]">
                هر بخش با روزهای بیشتری که با هم می‌مانید اضافه می‌شود.
              </p>

              <ul className="mt-3 space-y-2">
                {(house.stages ?? []).map((s) => (
                  <li
                    key={s.slug}
                    className="flex items-center gap-3 border-2 border-[#1a1424] bg-[#ddfaf3] px-3 py-2.5"
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center border-2 border-[#1a1424] bg-[#5eead4] text-[11px] font-black text-[#1a1424]">
                      ✓
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[12.5px] font-extrabold text-[#1a1424]">{s.title}</p>
                      <p className="truncate text-[11px] font-semibold text-[#4a3f5c]">{s.note}</p>
                    </div>
                    <span className="shrink-0 text-[10.5px] font-bold text-[#4a3f5c]">
                      روز {toPersianDigits(s.at_bricks)}
                    </span>
                  </li>
                ))}

                {house.next && (
                  <li className="flex items-center gap-3 border-2 border-dashed border-[#1a1424]/35 px-3 py-2.5">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center border-2 border-dashed border-[#1a1424]/35 text-[11px] font-black text-[#4a3f5c]">
                      {toPersianDigits(house.next.at_bricks)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[12.5px] font-extrabold text-[#4a3f5c]">{house.next.title}</p>
                      <p className="truncate text-[11px] font-semibold text-[#4a3f5c]/80">{house.next.note}</p>
                    </div>
                  </li>
                )}
              </ul>
            </section>

            {/* ================= marry ================= */}
            {house.state === 'building' && (
              <section className="card rounded-[1.75rem] p-5">
                <h2 className="text-[14px] font-extrabold text-[#1a1424]">ازدواج کردید؟</h2>
                <p className="mt-1 text-[11.5px] leading-6 font-semibold text-[#4a3f5c]">
                  اگر ازدواج کردید، اینجا بزنید. خانه دیگر بزرگ نمی‌شود و از آن روز در آن زندگی می‌کنید.
                  این کار برگشت‌پذیر نیست.
                </p>
                <button
                  type="button"
                  onClick={() => void marry()}
                  disabled={busy !== null}
                  className={`mt-3 !px-4 !py-2.5 text-[12px] ${marryArmed ? 'btn-primary' : 'btn-ghost'}`}
                >
                  {busy === 'marry' ? 'ثبت…' : marryArmed ? 'بله، مطمئنم — خانه‌ی خودمان' : 'ازدواج کردیم'}
                </button>
                {marryArmed && (
                  <button
                    type="button"
                    onClick={() => {
                      setMarryArmed(false)
                      setNotice(null)
                    }}
                    className="mt-2 block text-[11px] font-bold text-[#4a3f5c] underline"
                  >
                    نه، اشتباه شد
                  </button>
                )}
              </section>
            )}
          </>
        )}

        {/* ================= no house yet ================= */}
        {!house && (
          <section className="card rounded-[1.75rem] p-5">
            {!hasPartner ? (
              <>
                <h2 className="text-[14px] font-extrabold text-[#1a1424]">هنوز کسی اینجا نیست</h2>
                <p className="mt-1.5 text-[11.5px] leading-6 font-semibold text-[#4a3f5c]">
                  خانه وقتی ساخته می‌شود که با شریکت وصل باشی.
                </p>
                <Link to="/app" className="btn-ghost mt-3 inline-block !px-4 !py-2 text-[12px]">
                  برگشت
                </Link>
              </>
            ) : !state?.has_anniversary ? (
              <>
                <h2 className="text-[14px] font-extrabold text-[#1a1424]">تاریخ آشنایی را بگویید</h2>
                <p className="mt-1.5 text-[11.5px] leading-6 font-semibold text-[#4a3f5c]">
                  آجرها از روزی شمرده می‌شوند که با هم شروع کردید. اول آن تاریخ را در داشبورد ثبت کنید.
                </p>
                <Link to="/app" className="btn-ghost mt-3 inline-block !px-4 !py-2 text-[12px]">
                  ثبت تاریخ آشنایی
                </Link>
              </>
            ) : (
              <>
                <h2 className="text-[14px] font-extrabold text-[#1a1424]">خانه‌تان را بسازید</h2>
                <p className="mt-1.5 text-[11.5px] leading-6 font-semibold text-[#4a3f5c]">
                  از روزی که با هم شروع کردید تا امروز، هر روز یک آجر. با هر آجر خانه کامل‌تر می‌شود.
                  فقط یکی از شما لازم است این را شروع کند.
                </p>
                <button
                  type="button"
                  onClick={() => void found()}
                  disabled={busy !== null}
                  className="btn-primary mt-3 !px-4 !py-2.5 text-[12px]"
                >
                  {busy === 'found' ? 'در حال ساختن…' : 'اولین آجر را بگذار'}
                </button>
              </>
            )}
          </section>
        )}

        {/* ================= ruins ================= */}
        {(state?.ruins ?? []).length > 0 && (
          <section className="card rounded-[1.75rem] p-5">
            <h2 className="text-[14px] font-extrabold text-[#1a1424]">خانه‌های قبلی</h2>
            <p className="mt-1 text-[11.5px] leading-6 font-semibold text-[#4a3f5c]">
              این‌ها دیگر ساخته نمی‌شوند. همین‌طور می‌مانند.
            </p>

            <ul className="mt-3 space-y-3">
              {state!.ruins.map((r) => (
                <li key={r.id} className="border-2 border-[#1a1424] bg-[#f0eaff] p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[12px] font-extrabold text-[#1a1424]">
                      {toPersianDigits(r.bricks)} آجر
                    </p>
                    <span className="border-2 border-[#1a1424] bg-[#b79cff] px-2 py-0.5 text-[10px] font-black text-[#1a1424]">
                      خراب
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] font-semibold text-[#4a3f5c]">
                    {formatJalaliLong(r.began_on)} تا {formatJalaliLong(r.ruined_on.slice(0, 10))}
                  </p>
                  <div className="mt-2 max-w-[180px] opacity-70">
                    <HouseArt built={[]} ruined />
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* ================= how it works ================= */}
        <section className="card rounded-[1.75rem] p-5">
          <h2 className="text-[14px] font-extrabold text-[#1a1424]">قانون‌ها</h2>
          <ul className="mt-2 space-y-2 text-[11.5px] leading-6 font-semibold text-[#4a3f5c]">
            <li className="flex gap-2">
              <span className="font-black text-[#c4194a]">۱.</span>
              <span>
                آجرها از تاریخ آشنایی شمرده می‌شوند — نه از روزی که صفحه را باز می‌کنید. روز اول یک آجر است.
              </span>
            </li>
            <li className="flex gap-2">
              <span className="font-black text-[#c4194a]">۲.</span>
              <span>هیچ کاری لازم نیست بکنید. خانه با همین که با هم می‌مانید ساخته می‌شود.</span>
            </li>
            <li className="flex gap-2">
              <span className="font-black text-[#c4194a]">۳.</span>
              <span>اگر ازدواج کنید، خانه کامل می‌شود و دیگر بزرگ نمی‌شود.</span>
            </li>
            <li className="flex gap-2">
              <span className="font-black text-[#c4194a]">۴.</span>
              <span>اگر جدا شوید، خانه خراب می‌شود و همان‌طور می‌ماند.</span>
            </li>
          </ul>
        </section>
      </main>
    </div>
  )
}
