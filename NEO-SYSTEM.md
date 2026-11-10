# Neo-morphism system (round 21, dashboard)

Converted so far: **dashboard only**. Everything else still uses `.card`.

## Tokens — `tailwind.config.js`

`clay` ramp (the surface everything is extruded from):
`50 #fffdfb · 100 #fdf6f2 · 200 #f8ece7 · 300 #f1ded9 · 400 #e8ccc9`

Shadows, all lit from the **upper left**, never mixed direction:

| token | value |
|---|---|
| `neo` | `10px 10px 24px rgba(214,186,181,.55), -10px -10px 24px rgba(255,255,255,.95)` |
| `neo-sm` | `5px 5px 12px rgba(214,186,181,.5), -5px -5px 12px rgba(255,255,255,.9)` |
| `neo-lg` | `16px 16px 38px rgba(211,180,175,.6), -14px -14px 34px rgba(255,255,255,.98)` |
| `neo-in` | `inset 5px 5px 11px rgba(214,186,181,.62), inset -5px -5px 11px rgba(255,255,255,.95)` |
| `neo-in-sm` | `inset 3px 3px 7px rgba(214,186,181,.55), inset -3px -3px 7px rgba(255,255,255,.9)` |
| `neo-pink` | `8px 8px 18px rgba(232,72,116,.28), -8px -8px 18px rgba(255,255,255,.85)` |

Animations: `blob-a` (22 s), `blob-b` (28 s).

## Two rules that make it read as soft UI

1. **Same material.** A raised element goes on `bg-clay-100`, not white. White on
   cream is a sticker; clay on clay is extrusion.
2. **Raised = pressable, recessed = readout.** `NeoStat` is inset on purpose.
   A raised tile looks tappable, and numbers are not.

## Contrast is the failure mode — measured, not eyeballed

On `clay-200 #f8ece7`:

| colour | ratio | verdict |
|---|---|---|
| `ink-900` #3a3038 | 10.93 | ✔ body |
| `ink-700` #5c5058 | 6.61 | ✔ **use for small text** |
| `blush-800` #a52c50 | 5.90 | ✔ **use for pink text** |
| `blush-700` #c93560 | 4.36 | ✔ large only (≥18.7px or 14px bold) |
| `ink-500` #8b7f86 | 3.31 | ✘ never |
| `blush-600` #e84874 | 3.23 | ✘ never as text |
| `blush-500` #f9628b | 2.54 | ✘ never as text |

Added text-safe steps: `mint-700 #1c6b55` (5.80 on mint-100), `lilac-700 #67439f`
(6.30), `lilac-900 #452a68` (10.17).

**Gradients** must clear 3:1 at *both* ends, since every pixel between is
sampled. Stat digits run `blush-700→900` and `lilac-700→900`.

## The silent-drop trap (hit twice now)

Tailwind emits **nothing** and warns **nowhere** for:
- `bg-[#f9628b]/14` — arbitrary colour + opacity (round 20)
- `text-[#f4e7e2]/62` — opacity not on the 0–100 scale of 5 (round 21)

Always grep the built CSS for new colour utilities after a build.

## Verifying without a browser

No Chromium in this sandbox. Two checks that actually catch things:

1. `node /home/user/probe/dashprobe.mjs` — jsdom render of the real component
   tree with stubs; asserts surfaces, recessed/raised roles, no `.card`, copy.
2. `node /tmp/contrast.mjs` — walks the rendered DOM, resolves each text
   colour against its nearest opaque background, reports anything under its
   WCAG AA threshold. Both live in the workspace, not in git.
