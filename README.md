# Audio Online

[Open the editor](https://audio.hashbin.page/) (recovery copy:
[curtcox.github.io/AudioOnline](https://curtcox.github.io/AudioOnline/)) ·
[Design and dependency report](docs/step1-report.md)

Write a few lines of Python and hear them. Audio Online is "Manim for audio": a `Scene` places
clips on tracks over time, and the browser renders the result to a WAV. Everything is static: no
server, API key or build step. It is under construction: Python scenes and four compact notations
work now; speech, effects and the gallery come next.

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
- **Preview** shows the waveform and one lane per track. Click the waveform to seek, press **Play**
  (or Space), and click a clip to jump to it and to its line in the code. `print` output appears in
  **Output**. A file with several Scenes shows a **Scene** selector.
- **Sources:** `Sine`, `Square`, `Saw`, `Triangle`, `Noise(color=, seed=)`, `Silence`, and
  `Samples(array, rate)` for numpy arrays or lists. **Clip operations** return new clips: `.dur()`,
  `.gain(db)`, `.env(adsr(...))` or `.env(Envelope([...]))`, `.fade_in()`, `.fade_out()`,
  `.lowpass/.highpass/.bandpass(freq, q)`, `.reverse()`, `.loop(n)`, and `clip[start:end]` in
  seconds. `a + b` mixes, `a >> b` plays b after a, and `a * n` repeats.
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
- **Download** WAV (16-bit, 24-bit or 32-bit float), the waveform as SVG or PNG, or the `.py` source.
- Share the compressed URL, optionally shorten it through is.gd/AllOrigins, or make a QR code with
  SVG/PNG downloads. Source, files and settings travel together. Local work is restored from
  localStorage; links ask before replacing it.
- After the status says **Available offline**, the editor, Python and numpy work offline (about
  17 MB). Install the app through your browser's Add to Home Screen/Install action. New versions offer
  **Update and reload**; the current source is saved first.

Rendering is deterministic: the same scene produces byte-identical audio in Chromium, Firefox and
Safari/WebKit. Python only describes the timeline; a JavaScript renderer that uses exact arithmetic
(no platform math library or Web Audio) produces the samples.

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
- lz-string 1.5.0: [vendor/LICENSE-lz-string](vendor/LICENSE-lz-string).
- QR encoder: Project Nayuki, MIT; full notice retained in `src/qr.js`, ported from modl via Gnuplot Online.
- HashBin SDK v0.4.0, vendored byte for byte.
- The editor shell, sharing and HashBin controls are adapted from Gnuplot Online and ManimOnline.
