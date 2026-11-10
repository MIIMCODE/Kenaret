#!/usr/bin/env bash
# Regenerates the shipped avatar WebP files from the PNG masters here.
#
#   ./design/avatars/prepare-avatars.sh
#
# The masters are 1024×1024 "soft 3D" illustrations. They are kept out of the
# Pages build (only public/ is published) and only the 256×256 WebP versions in
# public/avatars/ are downloaded by visitors — 3–6 KB each.
#
# Requires ImageMagick (`convert`). Run from the repository root.
set -euo pipefail

cd "$(dirname "$0")/../.."

declare -A MAP=(
  [base]=ava-01      [moon]=ava-02      [cat]=ava-03
  [bear]=ava-04      [rose]=ava-05      [butterfly]=ava-06
  [cloud]=ava-07     [sun]=ava-08       [dove]=ava-09
  [coffee]=ava-10    [shell]=ava-11
)

for name in "${!MAP[@]}"; do
  out="public/avatars/${MAP[$name]}.webp"
  convert "design/avatars/$name.png" \
    -resize 256x256^ -gravity center -extent 256x256 \
    -strip -quality 82 "$out"
  printf '%-28s %s\n' "$out" "$(du -h "$out" | cut -f1)"
done

echo "done — $(ls public/avatars/*.webp | wc -l) avatars"
