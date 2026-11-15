/**
 * The house, drawn.
 *
 * This is the whole game as a picture. It is intentionally *not* an image:
 * every line is a rectangle or a path so the building can grow one element at
 * a time as bricks are added, and so a ruined house can be drawn broken rather
 * than swapped for a different picture.
 *
 * Design notes
 *   · The plan is ordered exactly like `house_stages()` in migration 0020, and
 *     a stage is drawn only if it is in `built`. The server decides what is
 *     built; this file only knows how to draw it.
 *   · Everything sits on a 240×200 grid and scales with `width: 100%`, so the
 *     same component works on a phone and in the desktop shell.
 *   · Bricks that have not been laid yet are still *shown*, as a faint dashed
 *     outline of the next thing. Seeing the ghost of the next stage is what
 *     makes the counter feel like progress.
 */

const INK = '#1a1424'
const PAPER = '#ffe9d6'

/** A stage slug, as it appears in `house_stages()`. */
export type HouseStageSlug =
  | 'foundation'
  | 'walls'
  | 'roof'
  | 'windows'
  | 'room'
  | 'lamp'
  | 'garden'
  | 'storey'
  | 'door'
  | 'kitchen'
  | 'fiveyears'
  | 'library'
  | 'home'

interface HouseArtProps {
  /** Slugs already built, from the server. */
  built: HouseStageSlug[]
  /** Draws the next stage as a dashed ghost. */
  ghost?: HouseStageSlug | null
  /** Cracks, leaning walls, a fallen roof. */
  ruined?: boolean
  /** Married: the house is lit and lived in. */
  livedIn?: boolean
  className?: string
}

/** Stroke widths in grid units; a hand-drawn wall is never one line. */
const W = 3

function has(built: HouseStageSlug[], slug: HouseStageSlug) {
  return built.includes(slug)
}

export default function HouseArt({
  built,
  ghost = null,
  ruined = false,
  livedIn = false,
  className = '',
}: HouseArtProps) {
  const walls = has(built, 'walls')
  const roof = has(built, 'roof')
  const windows = has(built, 'windows')
  const room = has(built, 'room')
  const lamp = has(built, 'lamp')
  const garden = has(built, 'garden')
  const storey = has(built, 'storey')
  const door = has(built, 'door')
  const kitchen = has(built, 'kitchen')
  const library = has(built, 'library')

  const ghostWalls = ghost === 'walls'
  const ghostRoof = ghost === 'roof'

  /*
    A ruined house is drawn on a tilt. Each group gets its own small rotation
    and a gap where a wall used to meet the roof, so the shape reads as
    "collapsed" before any crack is even visible.
  */
  const tilt = ruined ? 'rotate(-3.5 120 130)' : undefined
  const bodyStroke = ruined ? '#4a3f5c' : INK

  return (
    <svg
      viewBox="0 0 240 200"
      role="img"
      aria-label={ruined ? 'خانه‌ی خراب‌شده' : `خانه — ${built.length} بخش ساخته شده`}
      className={className}
      style={{ width: '100%', height: 'auto', display: 'block' }}
    >
      {/* ---------------- ground ---------------- */}
      <path
        d="M8 178 H232"
        stroke={bodyStroke}
        strokeWidth={W}
        strokeLinecap="round"
        opacity={ruined ? 0.4 : 1}
      />

      {/* the garden sits *under* the house so the ground line stays visible */}
      {garden && !ruined && (
        <g aria-hidden="true">
          {[22, 46, 194, 218].map((x, i) => (
            <g key={x}>
              <path
                d={`M${x} 176 v-${i % 2 === 0 ? 16 : 12}`}
                stroke={INK}
                strokeWidth={2}
                strokeLinecap="round"
              />
              <circle cx={x} cy={i % 2 === 0 ? 156 : 160} r={5} fill="#5eead4" stroke={INK} strokeWidth={2} />
            </g>
          ))}
        </g>
      )}

      {/* ---------------- foundation ---------------- */}
      {/* One stone. Always there, even on day one. */}
      <g aria-hidden="true">
        <rect
          x={86}
          y={168}
          width={68}
          height={12}
          fill={ruined ? '#b9b3c1' : '#ffd23f'}
          stroke={bodyStroke}
          strokeWidth={W}
        />
        {ruined && (
          <path d="M104 168 l6 12 M132 168 l-5 12" stroke="#c4194a" strokeWidth={2} />
        )}
      </g>

      <g transform={tilt}>
        {/* ---------------- walls ---------------- */}
        {(walls || ghostWalls) && (
          <g>
            <rect
              x={82}
              y={104}
              width={76}
              height={64}
              fill={walls ? (ruined ? '#e7e0ee' : '#fff') : 'none'}
              stroke={walls ? bodyStroke : INK}
              strokeWidth={W}
              strokeDasharray={walls ? undefined : '6 6'}
              opacity={walls ? 1 : 0.28}
            />
            {/* the second room, bolted onto the right-hand wall */}
            {room && !ruined && (
              <>
                <rect x={158} y={124} width={44} height={44} fill="#fff" stroke={INK} strokeWidth={W} />
                <path d="M158 124 h44" stroke={INK} strokeWidth={W} />
              </>
            )}
            {room && ruined && (
              <path d="M158 150 l20 -20 h24" stroke={bodyStroke} strokeWidth={W} strokeLinecap="round" opacity={0.35} />
            )}
          </g>
        )}

        {/* ---------------- roof ---------------- */}
        {(roof || ghostRoof) && (
          <path
            d={
              ruined
                ? // a roof that slid off its walls
                  'M78 106 L120 74 L150 100'
                : 'M76 106 L120 68 L164 106'
            }
            fill={roof ? (ruined ? 'none' : '#ff4d6d') : 'none'}
            stroke={roof ? bodyStroke : INK}
            strokeWidth={W}
            strokeLinejoin="round"
            strokeDasharray={roof ? undefined : '6 6'}
            opacity={roof ? 1 : 0.28}
          />
        )}

        {/* the fallen half of the roof, on the ground, if ruined */}
        {ruined && roof && (
          <path
            d="M60 176 L96 150 L118 168"
            fill="none"
            stroke="#4a3f5c"
            strokeWidth={W}
            strokeLinejoin="round"
            opacity={0.5}
          />
        )}

        {/* ---------------- second storey ---------------- */}
        {storey && !ruined && (
          <>
            <rect x={92} y={60} width={56} height={44} fill="#fff" stroke={INK} strokeWidth={W} />
            <path d="M84 60 L120 34 L156 60" fill="#3dd9eb" stroke={INK} strokeWidth={W} strokeLinejoin="round" />
            {windows && (
              <rect x={112} y={74} width={16} height={16} fill="#d3f7fd" stroke={INK} strokeWidth={2} />
            )}
          </>
        )}

        {/* ---------------- windows ---------------- */}
        {windows && !ruined && (
          <>
            <rect x={94} y={118} width={20} height={20} fill="#3dd9eb" stroke={INK} strokeWidth={2.5} />
            <path d="M104 118 v20 M94 128 h20" stroke={INK} strokeWidth={1.8} />
            {!room && (
              <>
                <rect x={126} y={118} width={20} height={20} fill="#3dd9eb" stroke={INK} strokeWidth={2.5} />
                <path d="M136 118 v20 M126 128 h20" stroke={INK} strokeWidth={1.8} />
              </>
            )}
          </>
        )}
        {windows && ruined && (
          <>
            <rect x={94} y={118} width={20} height={20} fill="none" stroke="#4a3f5c" strokeWidth={2} strokeDasharray="3 4" />
            <path d="M98 120 l12 16" stroke="#c4194a" strokeWidth={2} strokeLinecap="round" />
          </>
        )}

        {/* ---------------- door ---------------- */}
        {door && !ruined && (
          <g>
            <rect x={112} y={138} width={18} height={30} fill="#b79cff" stroke={INK} strokeWidth={2.5} />
            <circle cx={126} cy={154} r={1.8} fill={INK} />
          </g>
        )}
        {door && ruined && (
          // the door, off its hinges, leaning where it fell
          <rect
            x={130}
            y={158}
            width={16}
            height={22}
            fill="#b79cff"
            fillOpacity={0.35}
            stroke="#4a3f5c"
            strokeWidth={2}
            transform="rotate(24 138 169)"
          />
        )}

        {/* ---------------- lamp ---------------- */}
        {lamp && !ruined && (
          <g>
            {/* the glow, drawn first so the lamp sits on top of it */}
            <circle cx={136} cy={128} r={26} fill="#ffd23f" opacity={0.22} />
            {/* a lamp hung from the ceiling, one line and a bulb */}
            <path d="M136 104 v10" stroke={INK} strokeWidth={2} />
            <circle cx={136} cy={118} r={5.5} fill="#ffd23f" stroke={INK} strokeWidth={2.5} />
          </g>
        )}

        {/* ---------------- kitchen ---------------- */}
        {kitchen && !ruined && (
          <g>
            {/* a pot on a stove, seen through the window: a curl of steam */}
            <path
              d="M100 112 c3 -5 -3 -9 0 -14 M110 112 c3 -5 -3 -9 0 -14"
              fill="none"
              stroke="#4a3f5c"
              strokeWidth={1.8}
              strokeLinecap="round"
              opacity={0.75}
            />
          </g>
        )}

        {/* ---------------- library ---------------- */}
        {library && !ruined && (
          <g>
            {/* two shelves of books, drawn in the second storey */}
            <path d="M100 74 h40 M100 86 h40" stroke={INK} strokeWidth={1.6} opacity={0.5} />
            {[104, 110, 116].map((x) => (
              <rect key={x} x={x} y={64} width={5} height={10} fill="#ff4d6d" stroke={INK} strokeWidth={1} />
            ))}
            {[122, 128, 134].map((x) => (
              <rect key={`b${x}`} x={x} y={76} width={5} height={10} fill="#3dd9eb" stroke={INK} strokeWidth={1} />
            ))}
          </g>
        )}
      </g>

      {/* ---------------- lived-in smoke ---------------- */}
      {livedIn && !ruined && (
        <g aria-hidden="true">
          <path
            d="M150 40 c6 -8 -6 -14 0 -22 M162 42 c6 -8 -6 -14 0 -22"
            fill="none"
            stroke="#4a3f5c"
            strokeWidth={2.2}
            strokeLinecap="round"
            opacity={0.3}
          />
        </g>
      )}

      {/* ---------------- cracks ---------------- */}
      {ruined && (
        <g aria-hidden="true" stroke="#c4194a" strokeWidth={2.4} strokeLinecap="round" fill="none">
          <path d="M96 108 l10 14 l-7 10 l9 12" />
          <path d="M140 104 l-8 16 l7 9" opacity={0.7} />
        </g>
      )}

      {/* the two of them, standing where the door is — married only */}
      {livedIn && !ruined && (
        <g aria-hidden="true" transform="translate(0,0)">
          <circle cx={104} cy={166} r={4} fill={INK} />
          <circle cx={118} cy={166} r={4} fill={INK} />
        </g>
      )}

      {/* not used, but keeps PAPER honest if a fill is ever swapped in */}
      <rect x={0} y={0} width={0} height={0} fill={PAPER} />
    </svg>
  )
}
