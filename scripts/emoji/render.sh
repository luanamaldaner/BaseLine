#!/usr/bin/env bash
# Renders scripts/emoji/art.html to the transparent dot-*.png emoji in public/emoji/.
# (The pfp-*.png and test-*.png pictures are hand-made art; this leaves
# them alone.)
# Needs Chrome and Python with Pillow. Run from the project root:
#   bash scripts/emoji/render.sh
set -e
CHROME="${CHROME:-/c/Program Files/Google/Chrome/Application/chrome.exe}"
OUT=public/emoji
ABS="$(pwd -W 2>/dev/null || pwd)/$OUT"
mkdir -p "$OUT"
npx vite --port 5291 --strictPort > /dev/null 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null' EXIT
for i in $(seq 1 60); do curl -s -o /dev/null http://localhost:5291/scripts/emoji/art.html && break; timeout 0.5 tail -f /dev/null 2>/dev/null || true; done
shot() { # name, query
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --default-background-color=00000000 \
    --force-device-scale-factor=1 --window-size=512,512 --virtual-time-budget=2000 \
    --screenshot="$ABS/$1.png" "http://localhost:5291/scripts/emoji/art.html?$2" > /dev/null 2>&1
}
for f in happy talk sound; do shot "dot-$f" "face=$f"; done
# Trim to 256x256, keep transparency.
python - <<'PY'
from PIL import Image
import glob
for f in glob.glob("public/emoji/dot-*.png"):
    im = Image.open(f).convert('RGBA').resize((256, 256), Image.LANCZOS)
    im.save(f, optimize=True)
    print(f, im.getpixel((2, 2)))
PY
