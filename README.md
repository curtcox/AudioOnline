# Audio Online

[Open the editor](https://audio.hashbin.page/) (recovery copy:
[curtcox.github.io/AudioOnline](https://curtcox.github.io/AudioOnline/)) ·
[Sample gallery](https://audio.hashbin.page/gallery.html) ·
[Design and dependency report](docs/step1-report.md)

Write a few lines of Python and hear them. Audio Online is "Manim for audio": a `Scene` places
clips on tracks over time, and the browser renders the result to a WAV. Everything is static: no
server, API key or build step. Python scenes, four compact notations, uploaded and CID-addressed
WAV samples, the bundled offline voice, neural voices on demand, effects, stems, compressed export
and a 16-example gallery work now. The canonical `audio.hashbin.page` deployment is staged and
waits for its HashBin app registration.

```python
from audio import *

class Hello(Scene):
    def construct(self):
        bed = Noise(color="pink").lowpass(900).gain(-24).dur(2.5).fade_in(0.5)
        self.add(bed, at=0, track="ambience")
        for i, freq in enumerate([523.25, 659.25, 783.99, 1046.5]):
            self.add(Sine(freq).env(adsr(0.005, 0.3, 0.2, 0.6)).dur(1.2), at=0.25 * i, track="chime")
        self.wait(1.5)
        self.play(Sine(55).env(adsr(0.002, 0.15, 0, 0.2)).dur(0.4), track="sfx")
```

## Use it

- Edit the scene; it renders after a short pause, or press **Render**. Errors mark the scene line and
  keep the last good render playable. Long renders can be cancelled and stop after 20 seconds
  (downloading Python the first time does not count).
- **Preview** shows the waveform, a spectrogram and one lane per track. Click to seek, drag to choose a
  loop region (**Loop** toggles it), press **Play** (or Space), and click a clip to jump to it and to
  its line in the code. **M** and **S** mute or solo a track in the preview; the sandbox re-mixes the
  stems through the master effects. Downloads always use the full mix. `print` output appears in
  **Output**. A file with several Scenes shows a **Scene** selector.
- **Sources:** `Sine`, `Square`, `Saw`, `Triangle`, `Noise(color=, seed=)`, `Silence`,
  `Samples(array, rate)` for numpy arrays or lists, and WAV files: `Sample("kick.wav")` from
  **Audio files**, or `Sample(cid="…")` from HashBin. **Clip operations** return new clips: `.dur()`,
  `.gain(db)`, `.env(adsr(...))` or `.env(Envelope([...], curve="linear"|"smooth"|"exp"))`,
  `.fade_in()`, `.fade_out()`, `.lowpass/.highpass/.bandpass(freq, q)`, `.reverse()`,
  `.speed(rate)` (tape-style: pitch and length change together), `.pan(position)`, `.loop(n)` or
  `.loop(until=seconds)`, and `clip[start:end]` in seconds. `a + b` mixes, `a >> b` plays b after
  a, and `a * n` repeats.
- **Audio files** attaches WAV files (mono or stereo, 8–32-bit PCM or 32-bit float; 2 MiB each,
  5 MiB with the source) that travel with saves and share links; you can also drop them on the
  editor. `Sample(cid=...)` loads a WAV saved on HashBin: the editor downloads it from 256t.us and
  checks it against the CID before the scene sees it (up to 16 MiB; CIDs of 64 bytes or less carry
  their content and need no network). Compressed uploads are not accepted, because their decoders
  differ between browsers.
- **Placement:** `self.add(clip, at=, track=, gain=, pan=)` places a clip; `self.play()` places it at
  `self.time` and advances the cursor; `self.wait(seconds)` moves the cursor. `self.track(name).gain()`
  or `.mute()` and `self.master.gain()` adjust whole tracks. Scene attributes `sample_rate`,
  `channels`, `seed` and `length` override the toolbar. Scenes are limited to 300 seconds.
- **Notations** work as whole documents (the **Renderer** selector shows what Auto detected) and as
  clips inside a scene. Notation documents never download Python.
  - **ABC** tunes (`X:` and `K:` headers), played on built-in instruments: `sine`, `square`, `piano`,
    `organ`, `pad`, `bell`, `pluck`. `%%MIDI program` picks one; `abc(text, instrument=)` in Python.
  - **ZzFX** parameter arrays, one per line, optionally named: `coin = [1,.05,1675,,.06,.24]`;
    `zzfx([...])` in Python (`None` for blanks).
  - **sfxr** presets with seeds (`laserShoot 7`), jsfxr sound codes, or parameter JSON; `sfxr(...)`.
  - **Patterns**: a Tidal-style mini-notation subset (original implementation, not Strudel):
    `bd [~ bd] sn ~, hh*8`, `<a b>`, `x*n`, `x/n`, `x!n`, `x@w`, `x(k,n,rot)`. Lines are tracks
    (`bass(pluck): c2 ~ g1 ~`), with `bpm` and `cycles` lines; one cycle is four beats. Drums:
    `bd sn hh oh cp lt mt ht rim cb cy`. `pattern(text, bpm=, cycles=, instrument=)` in Python.
  - `Note("C4", seconds, instrument)` and `Drum("cp")` place single sounds.
- **Effects:** `Gain(db)`, `LowPass/HighPass/BandPass(freq, q)`, `Peak(freq, gain, q)`,
  `LowShelf/HighShelf(freq, gain)`, `Drive(amount)`,
  `Delay(time, feedback, mix)`, `Reverb(room, damp, mix, width)`, `Compressor(threshold, ratio, attack,
  release, makeup)` and `Limiter(ceiling, release)` go on clips with `clip.fx(...)`, on tracks with
  `self.track("music").fx(...)` (or `self.tracks["music"]`) and on `self.master.fx(...)`. Reverb and
  delay tails lengthen clips and the scene. Tracks also take `.pan()`, `.automate("gain", [(t, dB), …])`
  and `.duck(under="voice", amount=-12)`, which lowers the track while another one sounds. Notation
  documents get a −1 dBFS master limiter (inaudible below the ceiling).
- **Voice:** `self.say("text", voice="pico:en-US", speed=1, pitch=1)` speaks at the cursor on the
  `voice` track and moves the cursor to the end; `Speech(...)` is the same as a clip. The bundled
  SVOX Pico voices (`pico:en-US`, `en-GB`, `de-DE`, `es-ES`, `fr-FR`, `it-IT`) work offline and render
  identical bytes in every browser. English neural voices download only after confirmation:
  `kitten:Bella`, `Jasper`, `Luna`, `Bruno`, `Rosie`, `Hugo`, `Kiki`, `Leo` (use the `kitten:` prefix
  for each), or `kokoro:af_heart` and the other American English voices in `VOICES`. First downloads
  are about **45.6 MB** for Kitten or **104.5 MB** for Kokoro, including runtime and dictionary;
  switching models reuses the common files. They use a separate verified cache and are not part of
  "Available offline". Text stays in your browser. Neural voices support `speed=0.5…2`, `pitch=1`;
  Pico supports pitch changes. The original CMUdict front end handles English numbers and common
  abbreviations; unfamiliar words use approximate letter-to-sound rules.
- **Download** WAV (16-bit, 24-bit or 32-bit float), **Opus (.webm)** and **AAC (.m4a)** where the
  browser's WebCodecs can encode them (Opus: Chromium, Firefox, Safari/WebKit; AAC: Chromium,
  Safari/WebKit; WAV always works), **stems** (a ZIP of one 24-bit WAV per track,
  after track effects and before the master), the waveform as SVG or PNG, or the `.py` source.
- Share the compressed URL, optionally shorten it through is.gd/AllOrigins, or make a QR code with
  SVG/PNG downloads. Source, files and settings travel together. Local drafts are recovered explicitly with **Resume saved work**; links always open their document.
- The [sample gallery](gallery.html) has 16 original examples (voice, music, sound effects and
  mixes), each with a cover and a short compressed preview that loads when you play it. **Load in
  editor** (or `?example=<id>`) opens one. The neural-voice example has a cover only.
- After the status says **Available offline**, the editor, Python and numpy work offline (about
  27 MB with the voices). Install the app through your browser's Add to Home Screen/Install action. New versions offer
  **Update and reload**; the current source is saved first.

Rendering is deterministic: the same non-neural scene produces byte-identical audio in Chromium, Firefox and
Safari/WebKit. Python only describes the timeline; a JavaScript renderer that uses exact arithmetic
(no platform math library or Web Audio) produces the samples. Neural inference uses single-threaded ONNX WASM; Kitten’s random operators
are seeded and sessions restart per utterance. Tests require fresh-session byte equality in each
engine; cross-engine neural equality is diagnostic rather than a permanent renderer contract.

## Run and test locally

Use Node 22+ for development tools and any static HTTP server:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
# Open http://127.0.0.1:8000/ in your browser.
```

In another terminal:

```sh
npm ci
npm test
npm run check
node scripts/golden.mjs --check
npx playwright install chromium firefox webkit
npm run test:browser -- http://127.0.0.1:8000/ chromium
npm run test:browser -- http://127.0.0.1:8000/ firefox
npm run test:browser -- http://127.0.0.1:8000/ webkit
# Actual Kitten model tests (also run for each engine in CI):
node scripts/fetch-neural.mjs
node tests/browser/neural.cjs http://127.0.0.1:8000/ chromium
# Optional larger Kokoro test:
node scripts/fetch-neural.mjs --kokoro
KOKORO=1 node tests/browser/neural.cjs http://127.0.0.1:8000/ chromium
```

The unit suite runs the real `audio.py` under the pinned Pyodide in Node and checks that every
example renders to the bytes recorded in `tests/golden.json`. The browser suite renders every example
in each engine and requires those same bytes, then exercises sandbox isolation, diagnostics, cancel,
playback, downloads, sharing, HashBin, the phone layout and offline reloads with the origin stopped.
On macOS 27 Playwright's Firefox does not start; add
`FIREFOX_PATH=/Applications/Firefox.app/Contents/MacOS/firefox` to use desktop Firefox instead.

After changing shipped files:

```sh
node scripts/golden.mjs        # only after an intentional renderer/audio.py/example change
node scripts/render-gallery.mjs  # covers and AAC previews; needs Playwright Chromium with AAC (macOS/Windows)
node scripts/update-offline.mjs
npm test
npm run check
```

## How it is built

Scenes run in the pinned HashBin v0.4.0 SDK's opaque-origin sandbox worker, isolated from the
editor's storage. Pyodide 314.0.7 and numpy come from jsDelivr through the editor's hash-verified
cache. Saves use HashBin Publish; this app never holds a HashBin credential. The HashBin app ID is a
placeholder until the app is registered with the return URL `https://audio.hashbin.page/`.

## Credits and licensing

MIT licensed; see [LICENSE](LICENSE).

- Pyodide 314.0.7 (MPL-2.0) and numpy (BSD-3-Clause), loaded from jsDelivr.
- Ace 1.4.1: Ajax.org, BSD; [ace/LICENSE](ace/LICENSE).
- abcjs 6.7.2 (MIT), ZzFX 1.4.0 (MIT, Frank Force) and jsfxr 1.4.1 (Unlicense), vendored unmodified;
  see [vendor/PROVENANCE.md](vendor/PROVENANCE.md).
- SVOX Pico (Apache-2.0; SVOX AG and the Android Open Source Project) via `@echogarden/svoxpico-wasm`
  0.2.0, with AOSP language files; see [vendor/PROVENANCE.md](vendor/PROVENANCE.md).
- On-demand ONNX Runtime Web 1.30.0 (MIT), Kitten nano 0.8 int8 and Kokoro-82M v1.0
  (Apache-2.0), CMUdict (BSD-style); pins and license notices in [vendor/PROVENANCE.md](vendor/PROVENANCE.md).
- lz-string 1.5.0: [vendor/LICENSE-lz-string](vendor/LICENSE-lz-string).
- QR encoder: Project Nayuki, MIT; full notice retained in `src/qr.js`, ported from modl via Gnuplot Online.
- HashBin SDK v0.4.0, vendored byte for byte.
- The editor shell, sharing and HashBin controls are adapted from Gnuplot Online and ManimOnline.

### URLs and saved work

Program URLs always open the linked document, regardless of browser history or local drafts. The homepage opens the default example. Use **Resume saved work** in the editor controls to recover local drafts. Viewing or running a link keeps saved work; editing it retains the previous draft for recovery.

## Shared tools migration

The shell, URL/CID tools, Publish dialogs, QR image/camera loading, draft recovery, offline core and gallery filters use the published Fragment Kit v0.3.3 pin. See [the guide](docs/index.md) and [migration notes](docs/fragment-kit-migration.md). The audio engine and golden hashes remain unchanged. New document writers keep the existing hashbin-audio envelope while the fleet's shared readers roll out.

Publish is visibly disabled until a registered public client ID is supplied. Canonical hosting and remote deployment remain explicit owner actions; this migration stages a gated manual Pages workflow. Neural voices retain their separate verified cache and consent flow.

Run `npm test`, `npm run check`, `npm run golden -- --check`, `npm run test:contracts` and the actual engine browser suite. `npm run gallery:audio` regenerates the original PNG/AAC previews with real Chromium AAC support; `npm run gallery` renders the shared covers from those PNGs. Run `npm run docs` and `npm run offline` after shipped-file changes. Node 22.12+ is required.

Canonical registration (2026-11-05): `app_da72a010-439f-4772-b664-791ed9333c29`, with the sole return URL `https://audio.hashbin.page/`. The GitHub Pages recovery copy preserves old links and drafts; Publish approval is available from the canonical site.
