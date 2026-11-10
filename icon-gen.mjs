import sharp from 'sharp'
import { writeFileSync, readFileSync } from 'node:fs'

/**
 * Generates the notification artwork.
 *
 * The important one is `notification-96.png`. Android renders a notification's
 * small icon from its ALPHA CHANNEL ONLY — colour is discarded and every opaque
 * pixel becomes the system tint (white on most builds). Shipping the normal
 * app icon there therefore produced a solid white blob: the icon's pink square
 * is fully opaque, so the whole thing turned to one white shape and the heart
 * disappeared into it.
 *
 * So: white artwork, fully transparent background, centred inside the safe
 * area. No rounded corners, no plate, no gradient.
 *
 * The heart is the same path as `public/favicon.svg`, so it still reads as the
 * brand mark.
 */

const HEART_PATH =
  'M32 49C20.5 40.5 13 33.5 13 26c0-6 4.6-10.5 10.5-10.5 3.6 0 6.5 1.7 8.5 4.6 2-2.9 4.9-4.6 8.5-4.6C46.4 15.5 51 20 51 26c0 7.5-7.5 14.5-19 23z'

/** Bounding box of that path in its 64-unit viewBox. */
const BX = 13
const BY = 15.5
const BW = 38
const BH = 33.5

/**
 * @param size   canvas size in px (square)
 * @param fill   fraction of the canvas the heart occupies
 */
function heartSvg(size, fill) {
  const unit = Math.min((size * fill) / BW, (size * fill) / BH)
  const tx = (size - BW * unit) / 2 - BX * unit
  const ty = (size - BH * unit) / 2 - BY * unit
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <g transform="translate(${tx.toFixed(3)} ${ty.toFixed(3)}) scale(${unit.toFixed(4)})">
    <path d="${HEART_PATH}" fill="#ffffff"/>
  </g>
</svg>`
}

const targets = [
  // 24dp small icon. Android scales it down, so render generously
  // (96px = 24dp @4x). This one asset serves both `icon` and `badge`, because
  // the platform tints both and shows them at different sizes.
  { file: 'public/icons/notification-96.png', size: 96, fill: 0.8 },
]

for (const target of targets) {
  const png = await sharp(Buffer.from(heartSvg(target.size, target.fill)))
    .png({ compressionLevel: 9 })
    .toBuffer()
  writeFileSync(target.file, png)

  // Sanity: the alpha channel is the only thing that matters downstream.
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let opaque = 0
  let transparent = 0
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] > 200) opaque += 1
    else if (data[i] < 8) transparent += 1
  }
  const total = info.width * info.height
  console.log(
    `${target.file}  ${info.width}x${info.height}  ` +
      `opaque ${((opaque / total) * 100).toFixed(1)}%  ` +
      `transparent ${((transparent / total) * 100).toFixed(1)}%`,
  )
}
