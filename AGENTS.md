# Audio Online

This is a buildless, static GitHub Pages application. It turns code into audio: Python scenes now;
notations, voices and effects follow the plan in [docs/step1-report.md](docs/step1-report.md)
(decisions D1–D7 signed off in §10). Use plain JavaScript with browser globals and CommonJS exports for
shared modules. Do not add a production bundler or server. Serve the repository root over HTTP,
never `file://`.

## Important contracts

- Public URL and HashBin redirect: `https://audio.hashbin.page/` (case matters). The recovery copy is
  `https://curtcox.github.io/AudioOnline/`. The `hashbin-client-id` meta tag holds a **placeholder**
  (`app_00000000-…`) until Curt supplies the registered ID; never invent one.
- User code never runs on the editor origin. `src/audio-sandbox.js` starts `src/audio-worker.js` with
  the pinned SDK's `createSandbox()`: a classic worker in an opaque-origin iframe
  (`sandbox="allow-scripts"`, never `allow-same-origin`). The worker removes storage APIs, nested
  workers and `importScripts` (`harden()`, as in PythonOnline) after Pyodide loads and before user code.
  Results cross back as bounded messages; `AudioClient.validate` checks them before the editor uses them.
- **Rendering is deterministic across engines.** Python only *describes* a timeline
  (`src/py/audio.py`, format `audio-timeline` v1); `src/audio-renderer.js` realizes it in the worker
  using only basic float operations and `src/dmath.js` — never `Math.sin/exp/log/pow/tanh`, Web Audio
  or wall-clock time. Time is sample indices (`Math.round(seconds × rate)` in the renderer only);
  randomness is seeded (mulberry32; unseeded noise derives from the Scene seed and evaluation order).
  The same source and settings give **identical bytes in Chromium, Firefox and WebKit**. Any change
  to the renderer, `dmath.js`, `audio.py` or an example must be deliberate: run
  `node scripts/golden.mjs` and commit `tests/golden.json`; browser tests compare every engine to it.
- Notation engines (`vendor/abcjs`, `vendor/zzfx`, `vendor/jsfxr`) stay byte-identical to their npm
  releases (`tests/notation.test.js`). `src/notation.js` loads them as modules with a prelude: a
  deterministic, seedable `Math` and, for ZzFX, an `AudioContext` stub and four pinned `**` → `Math.pow`
  rewrites (engines evaluate `**` differently). abcjs is only a parser; notes play on the original
  instruments in `src/instruments.js`. Python measures notation clips synchronously through the
  `_audio_js` bridge so `self.time` matches the render. Notation documents must not load Pyodide.
- The bundled voice is SVOX Pico (`src/voice.js`, `vendor/svoxpico/`, files pinned in
  `tests/voice.test.js`). Pico keeps state in C globals that `pico_resetEngine` misses, so the whole WASM
  heap is restored to its just-loaded snapshot before every utterance; without that, an utterance depends
  on what was said before it. The module gets a module-scope `importScripts` stub because the sandbox
  removes the real one before voices load. Voices named literally in the source load before Python
  runs; a voice chosen at run time makes the bridge fail with `VOICE_NOT_LOADED:…`, and the worker loads
  it and runs the scene again.
- Effects live in `src/effects.js` under the same determinism rules; tails are whole frames per effect
  (`Renderer.tailFrames`). Write smoothing as `g + (1 − c)(target − g)` so idle processors stay exactly
  transparent. Tracks are processed in ducking order (cycles are errors); a duck keys on the other track
  after its effects and gain but before its pan. The renderer keeps per-track stems (pre-master) for
  mute/solo and stem export; `AudioRenderer.mix` applies the master.
- Web Audio, WebCodecs and other engine-specific code run only on the editor origin, for playback and
  export of bytes that were already rendered. Playback starts from a user gesture (iOS).
- Scene errors map to the user's real lines: user code is compiled as `scene.py` with nothing
  prepended; renderer errors fall back to the placement's line. Errors keep the last good render.
- Pyodide is pinned to **314.0.7** (same as PythonOnline): `AudioCore.PYODIDE_URL`,
  `scripts/remote-hashes.json` and the `pyodide` devDependency must agree (`tests/offline.test.js`).
  numpy loads by name so Pyodide checks it against the lockfile. Runtime bytes reach the sandbox through
  the SDK proxy, i.e. the editor's verified offline cache.
- Documents are `{ format: 'hashbin-audio', version: 1, src, type, settings, files }` within 5 MiB, and
  plain source also loads. `files` are base64 WAV (D5) with Gnuplot's name rules and limits
  (`src/audio-files.js`). Source, files and settings must survive every save/share/restore path.
- Saves use the pinned SDK's `publish()` from the click; this origin never holds HashBin credentials.
  Keep scripts out of HTML: the Content-Security-Policy allows only the pinned SDK sandbox bootstrap
  hash as inline script. Vendored SDK files stay byte-identical to the release (`tests/hashbin.test.js`
  checks their SRI hashes).
- The service worker serves only hash-verified bytes (`vendor/hashbin-cache-v0.4.0.js`); installation
  is atomic. Run `node scripts/update-offline.mjs` after any shipped-file change. Neural voices (later)
  are never part of "Available offline" and use their own on-demand verified cache.
- A source/example/CID URL replaces the localStorage scene only after the user confirms, unless the
  stored scene is a sample or the default. Guard asynchronous loads and renders against newer edits.
  Storage failure must not prevent editing.
- `src/domain-migration.js` is generated by hashbin.org's `scripts/install-owned-app-notices.mjs`;
  do not hand-edit it. It gains an `audio` entry when hashbin.org's registry does (Step 5).
- Keep the QR encoder's MIT notice and all vendored notices.

## Validation and generated files

Use `npm ci`, `npm test`, `npm run check` and `node scripts/golden.mjs --check`. Browser tests need a
local HTTP server: `node tests/browser/all.cjs http://127.0.0.1:8000/ chromium` (also `firefox`,
`webkit`). On macOS 27, Playwright's Firefox does not launch; set
`FIREFOX_PATH=/Applications/Firefox.app/Contents/MacOS/firefox` to drive desktop Firefox over
WebDriver BiDi. CI covers all three engines on Linux. Test the actual Pyodide and renderer, never a mock
engine. Do not label an unrun browser as passing.

The user's current workflow is direct commits on `main` with frequent pushes. Deployment is
independent of tests. Remote deployments, DNS and HashBin registrations are Curt's; stage them only.
