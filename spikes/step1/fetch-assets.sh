#!/bin/sh
# Downloads the pinned third-party bytes the spike loads into ./assets (git-ignored).
# Nothing here is vendored into the app; Step 1 vendors nothing before sign-off.
set -eu
cd "$(dirname "$0")"
mkdir -p assets/pico assets/pyodide .pkgs
cd .pkgs
for p in abcjs@6.7.2 zzfx@1.4.0 jsfxr@1.4.1 @echogarden/svoxpico-wasm@0.2.0 pyodide@314.0.7; do npm pack --silent "$p" >/dev/null; done
for t in *.tgz; do mkdir -p "${t%.tgz}"; tar xzf "$t" -C "${t%.tgz}"; done
cd ..
cp .pkgs/abcjs-6.7.2/package/dist/abcjs-basic-min.js .pkgs/zzfx-1.4.0/package/ZzFX.js .pkgs/jsfxr-1.4.1/package/sfxr.js assets/
cp .pkgs/echogarden-svoxpico-wasm-0.2.0/package/svoxpico.js .pkgs/echogarden-svoxpico-wasm-0.2.0/package/svoxpico.wasm assets/pico/
for f in pyodide.mjs pyodide.asm.mjs pyodide.asm.wasm python_stdlib.zip pyodide-lock.json; do cp ".pkgs/pyodide-314.0.7/package/$f" assets/pyodide/; done
PICO=https://raw.githubusercontent.com/naggety/picotts/master/pico/lang
curl -fsSL -o assets/pico/en-US_ta.bin "$PICO/en-US_ta.bin"
curl -fsSL -o assets/pico/en-US_lh0_sg.bin "$PICO/en-US_lh0_sg.bin"
curl -fsSL -o assets/pyodide/numpy-2.4.6-cp314-cp314-pyemscripten_2026_0_wasm32.whl \
  https://cdn.jsdelivr.net/pyodide/v314.0.7/full/numpy-2.4.6-cp314-cp314-pyemscripten_2026_0_wasm32.whl
curl -fsSL -o assets/hashbin-sdk-v0.4.0.mjs https://hashbin.org/sdk/v0.4.0/hashbin.js
shasum -a 256 -c <<'SUMS'
a292c1f5d7d8a2208cd5e94fc467604c131cabcd2fc14fed6eefde121e7fabdf  assets/pyodide/numpy-2.4.6-cp314-cp314-pyemscripten_2026_0_wasm32.whl
SUMS
rm -rf .pkgs
