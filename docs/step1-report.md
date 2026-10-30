# Audio Online — Step 1: engine and dependency report

Status: **awaiting Curt's sign-off. Nothing has been vendored and no app code exists yet.**
Date: 2026-10-30. Spike harness and raw results: [`spikes/step1/`](../spikes/step1/).

---

## 0. Requirements no candidate can meet (read first)

1. **The sandbox cannot run Web Audio.** HashBin SDK v0.4.0's `createSandbox()` runs code only in a
   classic worker inside the opaque iframe. The iframe window runs only the SDK's fixed bootstrap.
   `OfflineAudioContext`, `AudioContext` and `AudioWorklet` are `undefined` in that worker in all
   three engines (spike, §2.1). "Mix in the sandbox iframe's window" would need a new SDK mode or an
   app-owned frame bootstrap (Livelier does this). **Proposed resolution:** do all rendering in the
   worker with our own deterministic DSP. Native Web Audio is then used only for playback on the
   editor origin. This also gives better determinism (item 3).
2. **WebCodecs is not available in the sandbox worker on Chromium.** Chromium reports
   `isSecureContext: false` for the SDK's blob worker in an opaque frame, so `AudioEncoder` and
   `crypto.subtle` are absent. Firefox and WebKit expose them. **Proposed resolution:** the sandbox
   returns PCM, and compressed encoding runs on the editor origin. That code is ours and only
   processes bounded `Float32Array` data, never user code.
3. **Native Web Audio is not bit-exact across engines.** Every node except a plain buffer copy gives
   different bytes in Chromium, Firefox and WebKit. Firefox's resampler is materially different:
   the peak of resampled white noise is 1.31 there versus 1.94 elsewhere (§2.2). Within one engine it
   is repeatable. Rendering with native nodes would therefore meet the brief's per-engine rule, but
   never a cross-engine one.
4. **No permissive neural voice stack exists off the shelf.** Every maintained browser wrapper for
   Kokoro (`kokoro-js`), Kitten TTS (`kitten-tts-js`) and Piper (`piper-tts-web` and its forks)
   converts text to phonemes with eSpeak NG, which is **GPL-3.0**. `phonemizer@1.2.1` is labelled
   Apache-2.0 on npm, but its 1.3 MB bundle is a compiled eSpeak NG. Upstream Piper's successor
   (`OHF-Voice/piper1-gpl`) is GPL-3.0 as well. The model weights themselves are permissive. Curt
   must choose one of three options: accept a GPL phonemizer that is downloaded on demand, have us
   write an original CMUdict-based G2P, or skip neural voices in v1 (§4.3, decision D3).
5. **eSpeak NG cannot be the bundled voice under MIT-only terms.** It is GPL-3.0. The only small,
   permissive bundled engine with acceptable quality is **SVOX Pico** (Apache-2.0). It supports
   6 languages instead of 100+. Debian classes Pico's language files as non-free (§4.1).
6. **Neural-voice determinism is unverified.** VITS (Piper) and Kokoro's vocoder contain random-noise
   ops. Bit-exact output needs either seeded or zeroed noise inputs (to verify in Step 3) or a
   verified render cache keyed by (text, voice, model hash). I can't promise it yet.
7. **Not verified on real Safari.** WebKit results come from Playwright WebKit 27.2. Driving Safari
   would need *Allow Remote Automation*, a system setting I must not change. Historically Safari's
   `AudioEncoder` support lagged, so WAV export is the guaranteed fallback.
8. **Strudel compatibility is not on offer.** Strudel is AGPL-3.0, so the pattern language must be an
   original implementation of a Tidal-style mini-notation subset. It won't be Strudel-compatible.

---

## 1. Recommendation in brief

- **One sandbox worker renders everything.** Python (Pyodide, only when needed) or a notation parser
  produces a **timeline JSON** graph. An original JS renderer in the same worker realizes it with
  deterministic DSP. The worker returns bounded PCM (`Float32Array` per channel, with declared length
  and sample rate).
- **Deterministic DSP:** only IEEE-exact operations (`+ − × ÷ sqrt floor`, `Math.fround`, `Math.pow`
  and `Math.sqrt` matched too) plus our own `dmath` sin/cos/exp/log/tanh. Third-party JS synths (ZzFX,
  jsfxr) load unmodified, with a module-scope `Math` shadow prepended at load time, so the vendored
  files stay byte-identical. WASM engines (Pyodide/numpy, Pico) are already bit-exact across engines.
  **Result: identical bytes on Chromium, Firefox and WebKit**, which is stronger than the brief asks.
  The spike proved this for every engine-side piece we would ship (§2.2).
- **Editor origin:** playback (`AudioContext`, started from a gesture), waveform/spectrogram, WebCodecs
  encoding, and muxing with original code extended from ManimOnline's `manim-video.js`.
- **Pure-notation documents never load Pyodide.** Parsers are about 50 KB to 0.5 MB and the first
  render takes milliseconds. Python documents add about 16.4 MB of downloads and about 1.2 s of warm
  startup.
- **Bundled voice: SVOX Pico** (Apache-2.0, 2.5 MB for en-US, bit-exact, ~30× real time). **Neural
  voices on demand:** Kokoro-82M (86 MB, Apache-2.0) and/or Kitten TTS nano (24 MB, Apache-2.0) on
  onnxruntime-web (MIT, 14.8 MB WASM). The phonemizer depends on decision D3.

---

## 2. Spikes (run 2026-10-30 on macOS 27.0.1, Apple silicon)

Engines: **Chromium 156.0.8078.4** (Playwright 1.64.1), **Firefox 159.0** (desktop build through
WebDriver BiDi, because Playwright's Firefox Nightly 157 fails at launch on this Mac with "Could not
find profile folder"; hashbin.org's owned-app doc reports the same failure), and **WebKit 27.2**
(Playwright). The page used the real vendored SDK v0.4.0, a sibling-style CSP (SDK bootstrap hash,
`blob:`, `'wasm-unsafe-eval'`) and real engines throughout, with no mocks. Reproduce with:

```sh
spikes/step1/fetch-assets.sh
PW=../GnuPlotOnline/node_modules/playwright node spikes/step1/run.cjs chromium webkit firefox-bidi
node spikes/step1/compare.cjs
```

It ran three contexts on each engine: (A) the editor origin, (B) a raw `sandbox="allow-scripts"`
srcdoc iframe window with its own hashed bootstrap (Livelier-style; not SDK), and (C) the SDK's
opaque worker.

### 2.1 Web Audio and platform APIs per context

| | Chromium | Firefox | WebKit |
|---|---|---|---|
| (C) SDK worker: `OfflineAudioContext` / `AudioContext` / `AudioWorkletNode` / `AudioBuffer` | undefined | undefined | undefined |
| (C) SDK worker: `isSecureContext` | **false** | true | true |
| (C) SDK worker: `AudioEncoder` | **undefined** | Opus, Vorbis | Opus, AAC, pcm-s16 |
| (C) SDK worker: `crypto.subtle` | undefined | present | present |
| (C) SDK worker: `indexedDB` | SecurityError | SecurityError | SecurityError |
| (C) SDK worker: `caches` | ReferenceError | NS_ERROR_FAILURE | **usable** (opaque partition) |
| (C) SDK worker: `SharedArrayBuffer` (no COOP/COEP) | undefined | undefined | undefined |
| (B) opaque window: `OfflineAudioContext` renders | yes | yes | yes |
| (B) opaque window: `audioWorklet.addModule(blob:)` | works | works | **fails** ("Cross-origin script load denied") |
| (A)/(B) `addModule(data:)` | blocked by CSP (expected; sibling CSPs omit `data:` from script-src) | blocked | blocked |
| (A) editor: `addModule(blob:)` | works | works | works |
| (B) output equals (A) output, per engine | yes | yes | yes |

Conclusions: no Web Audio is available in the sandbox. A window-mode sandbox would get
`OfflineAudioContext`, but not worklets on WebKit. WebKit's opaque worker can reach a `caches`
object. That is its own opaque partition, not the editor's, but the app should still delete storage
APIs before running user code, as PythonOnline's `harden()` does. The browser isolation test will
check this.

### 2.2 Determinism

Each case rendered twice per engine. **Every case repeated byte-for-byte within each engine.**
The question is whether bytes match *across* engines:

| Stage | Cross-engine bytes | Notes |
|---|---|---|
| Native `OfflineAudioContext`: buffer copy | **identical** | |
| Native: sine osc, gain automation, biquad, delay feedback, convolver, stereo panner | differ | peak/RMS agree to ~1e-5 |
| Native: sawtooth (band-limited tables) | differ | FF peak 0.988 vs 0.980 |
| Native: DynamicsCompressor | differ | FF RMS 0.767 vs 0.768 |
| Native: resampling (16 kHz buffer → 48 kHz) and `playbackRate` 1.5 | differ **materially** | FF peak 1.31 vs 1.94 on white noise |
| JS `Math.sin/cos/tan/exp/log/atan2/cbrt/sinh/expm1/log1p/log10/hypot` (Float64) | differ | each engine has its own libm |
| JS `Math.pow`, `Math.sqrt`, `Math.fround` | identical | `Math.tanh`: Chromium = WebKit ≠ Firefox |
| **Pure-arithmetic JS DSP** (own sin/exp; oscillators, seeded noise, RBJ biquad, feedback delay, Freeverb-style reverb, compressor) | **identical** | 2 s at 48 kHz in 16–36 ms |
| **numpy 2.4.6 in Pyodide 314.0.7** (sin/exp/tanh synthesis, `default_rng` noise, `rfft`, libm vector) | **identical** | WASM libm is the same everywhere |
| **SVOX Pico WASM** (5.77 s utterance) | **identical** | |
| **abcjs 6.7.2** parse + `setUpAudio()` note events | **identical** | works in the worker; no DOM |
| **jsfxr 1.4.1** (`pickupCoin`, seeded `Math.random`) | **identical** | |
| **ZzFX 1.4.0** coin, laser | **identical** | boom (shape 4 uses `Math.tan`) differs on Chromium. A `Math` shadow fixes it. |
| WebCodecs Opus/AAC encode | repeatable per engine | different encoders per engine |

Interpretation: anything that uses only basic float operations or WASM gives identical bytes on all
three engines. Anything that touches an engine's libm or native DSP does not.

### 2.3 Encoders (`AudioEncoder.isConfigSupported`, editor origin)

| Codec | Chromium 156 | Firefox 159 | WebKit 27.2 |
|---|---|---|---|
| Opus 48 kHz stereo | yes | yes | yes |
| AAC-LC `mp4a.40.2` 44.1/48 kHz | yes | **no** | yes |
| Vorbis | no | yes | no |
| FLAC / MP3 | no | no | no |
| pcm-s16 | no | no | yes |

All encoders gave identical bytes on repeat. Opus in WebM is the only lossy format every engine can
write. AAC/M4A is available on Chromium and WebKit.

### 2.4 Speed and startup (warm local server, inside the SDK worker)

| | Chromium | Firefox | WebKit |
|---|---|---|---|
| Pure-JS DSP chain, 2 s mono 48 kHz | 16 ms | 25 ms | 36 ms |
| Pico TTS, 5.77 s of speech | 163 ms | 213 ms | 165 ms |
| abcjs load + parse | 34 ms | 23 ms | 29 ms |
| Pyodide boot / numpy load / first run | 1166 / 197 / 320 ms | 1240 / 237 / 350 ms | 1157 / 193 / 319 ms |
| (reference) native `OfflineAudioContext`, 60 s 8-voice mix | 187× real time | 192× | 149× |

Everything in the worker renders far faster than real time. Pyodide's cost is its downloads:
`pyodide.asm.wasm` 9,598,218 + `python_stdlib.zip` 2,545,637 + `pyodide.asm.mjs` 1,250,344 + numpy
wheel 2,960,568 bytes ≈ **16.4 MB**, plus about 1.2 s of startup. Notation-only documents avoid both.

---

## 3. Candidate matrix

Sizes are raw bytes (gzip where measured). "Worker" means it runs in the SDK's opaque classic
worker. Release dates are for the named version.

### 3.1 Timeline / mixer

| Candidate | Renders | License | Size | Worker | > real time | Deterministic | Verdict |
|---|---|---|---|---|---|---|---|
| Native `OfflineAudioContext` | DSP/mix | platform | 0 | **no** (window only) | yes, ~150–190× | per engine only; cross-engine no | playback only |
| `tone@15.1.22` `Offline` (2025-04-27) | music/DSP | MIT | 345,500 (79,291 gz) | **no**, needs (Offline)AudioContext | yes | as native | reject |
| numpy mixing in Pyodide 314.0.7 | DSP/mix | BSD-3 / MPL-2.0 | ~16.4 MB with runtime | yes | yes | **cross-engine identical** | available as `Samples(array)`, not the core mixer |
| **Original JS renderer** (proposed) | mix, filters, delay, reverb, compressor, automation, resampler | MIT (ours) | est. 30–60 KB | yes | yes, ~50–100× | **cross-engine identical** (spike) | **recommend** |

### 3.2 Music

| Candidate | Renders | License | Size | Worker | Deterministic | Maintenance | Verdict |
|---|---|---|---|---|---|---|---|
| **`abcjs@6.7.2`** (2026-10-16) | ABC parse → note events; synth needs Web Audio + remote soundfonts | MIT | 511,968 (147,981 gz) | **parser yes** (spike); synth no | events identical | active, official | **recommend, parser only**; we synthesize notes |
| `@strudel/core@1.2.6`, `@strudel/mini@1.2.6`, `superdough@1.3.0` (2026-01) | patterns + Web Audio synth | **AGPL-3.0-or-later** | 574 KB + 252 KB + 393 KB unpacked | superdough no | — | active (Codeberg) | reject; original mini-notation instead |
| `@csound/browser@7.0.0` (2026-10-22) + `@csound/wasm-bin@7.0.0` | full DSP language | Apache-2.0 wrapper + **LGPL-2.1** WASM | 4.9 MB JS; wasm-bin package 183 MB unpacked (all variants) | unproven (uses standardized-audio-context) | likely (WASM) | active, official | defer (possible on-demand later) |
| `@grame/faustwasm@0.19.6` (2026-10-30) | DSP compiler | **LGPL-2.1** | 29.9 MB unpacked | compiler probably yes | likely | active, official | defer |
| `webchuck@1.2.11` (2026-02-20) | ChucK | MIT wrapper; ChucK core MIT/GPL dual | ~47 KB JS + wasm from CCRMA | **no**, needs AudioWorklet | — | official | reject |
| music21 10.5.2 (PyPI) | music logic | BSD-3 | 20,120,956 wheel; not in Pyodide lock | yes (pure Python) | yes | active | defer; optional on-demand micropip later |

### 3.3 SFX

| Candidate | License | Size | Worker | Deterministic | Maintenance | Verdict |
|---|---|---|---|---|---|---|
| **`zzfx@1.4.0`** (2026-10-01) | MIT | 10,301 (3,569 gz) | yes; needs an `AudioContext` stub at import (it creates one at module load) | identical with seeded `Math.random` + `Math` shadow | official, active | **recommend** |
| **`jsfxr@1.4.1`** (2026-05-05) | Unlicense (public domain) | 35,898 (8,659 gz) | yes (classic script) | identical (seeded) | active | **recommend** |
| `sfxr@0.0.2` (npm, 2022) | ISC | — | — | — | stale | reject (use jsfxr) |
| numpy / own synthesis | — | — | yes | identical | — | via `audio-lite` sources |
| Faust / Csound | LGPL | large | — | — | — | defer |

### 3.4 Voice

| Candidate | License | Size | Worker | Deterministic | Maintenance | Verdict |
|---|---|---|---|---|---|---|
| **`@echogarden/svoxpico-wasm@0.2.0`** (2024-10-26) + Pico lingware (`naggety/picotts`, from AOSP `external/svox`) | Apache-2.0 (lingware: see §4.1) | wasm 950,029 + js 165,036 + en-US 650,668 + 777,396 = **2,543,129** | yes (ESM via `hashbinSandbox.import`, `locateFile` override needed) | **identical** (spike) | engine frozen since 2009; wrapper 2024 | **recommend as bundled voice** |
| `@echogarden/espeak-ng-emscripten@0.3.5` (2025-08-19) | **GPL-3.0** | js 841,996 + data 24,014,553 (all languages; ~12.4 MB gz). English-only repack est. 1–2 MB (needs an Emscripten file_packager step). | likely | likely (WASM) | active fork | only if Curt accepts GPL |
| `espeak-ng@1.0.2` (2023-11-24) | GPL-3.0-or-later | 18.7 MB unpacked | — | — | stale | reject |
| `mespeak@2.0.2` | GPL (eSpeak 1.x) | — | — | — | stale | reject |
| `klatt-syn@1.0.9` (2026-06-26) | MIT | 22,118 (+ `dsp-collection`) | yes | yes (pure JS; check libm use) | active | optional robot voice. Has no text front end; that would need original letter-to-sound rules (public-domain NRL rules). |
| `sam-js@0.3.1` | **no license** (reverse-engineered SoftVoice SAM) | 21,626 | — | — | — | reject |
| `@echogarden/flite-wasi@0.1.1` (2023) | **BSD-4-Clause** (advertising clause) | 21,530,456 | WASI shim needed | — | stale | reject |
| **Kokoro-82M v1.0** ONNX (`onnx-community/Kokoro-82M-v1.0-ONNX`) via `kokoro-js@1.2.1` (2025-05-03) or own loader | weights Apache-2.0; kokoro-js Apache-2.0; **phonemizer = eSpeak NG (GPL)** | `model_q8f16.onnx` 86,033,585; fp32 325,532,232; voice 522,240 each; `kokoro.web.js` 2,135,146 (bundles transformers.js + ORT JS + eSpeak) | expected (WASM EP, single thread: no SharedArrayBuffer) | **unverified** (noise source in vocoder) | weights active; kokoro-js quiet since 2025-05 | **recommend on demand** (quality) |
| **Kitten TTS nano 0.8 int8** (`KittenML/kitten-tts-nano-0.8-int8`) | Apache-2.0; **eSpeak phonemes** | 24,369,971 + voices.npz 3,278,902 | expected | unverified | model updated 2026-10; JS wrapper `kitten-tts-js@0.1.2` unofficial | **recommend on demand** (size) |
| Piper (`@mintplex-labs/piper-tts-web@1.0.5`, fork of `@diffusionstudio/vits-web@1.0.3`) | MIT wrapper; **piper-phonemize = eSpeak NG (GPL)**; per-voice dataset licenses | e.g. `en_US-ljspeech-medium` 63,531,379 (dataset public domain), `en_US-libritts_r-medium` 78,580,914 (CC BY 4.0). Avoid lessac (Blizzard licence), ryan and hfc (NC). | expected | unverified (VITS `noise_scale`) | upstream archived; successor GPL | not recommended |
| `onnxruntime-web@1.31.1` (2026-10-26) | MIT | `ort-wasm-simd-threaded.wasm` 14,848,852; `ort.wasm.min.mjs` 53,725 | expected; threads unavailable | WASM, likely per seed | official | runtime for neural voices (pin a ≥2-week-old patch at Step 3) |
| `sherpa-onnx@2.0.1` (2026-10-26) | Apache-2.0 | 15.4 MB unpacked | — | — | official, active | alternative runtime; still uses eSpeak data for Piper/Kokoro |
| Web Speech API | — | — | — | — | — | excluded by brief |

### 3.5 Encoding / containers

| Candidate | License | Size | Verdict |
|---|---|---|---|
| **WAV writer** (16-bit, 24-bit, 32-bit float), original | MIT | ~2 KB | **recommend**; always available, deterministic |
| **WebCodecs `AudioEncoder`** on the editor origin | platform | 0 | **recommend**: Opus everywhere, AAC on Chromium/WebKit (§2.3) |
| **Muxers extended from ManimOnline's `manim-video.js`** (MP4/WebM written by hand in ~150 lines) + new Ogg page writer | MIT (ours) | ~5 KB | **recommend**: `.webm` (Opus), `.m4a` (AAC), `.opus` (Ogg) |
| `mp4-muxer@5.2.2`, `webm-muxer@5.1.4` | MIT | 34 KB / 29 KB tgz | deprecated ("superseded by Mediabunny"), so reject |
| `mediabunny@1.65.0` (2026-10-30) | MPL-2.0 | 11.3 MB unpacked | reject (more than needed) |
| `libflacjs@5.6.0` (2026-07-21) | MIT wrapper, libFLAC BSD-3 | — | optional later (lossless compressed fallback) |
| `@breezystack/lamejs@1.2.7`, `lamejs@1.2.1` | LGPL-3.0 | — | reject |

Fallback when `AudioEncoder` is missing: WAV export stays available, and compressed export is
disabled with an explanation. Gallery previews use `<audio>` with two `<source>` elements, WebM/Opus
first and M4A/AAC second, both generated by `render-gallery.mjs` on macOS Chromium.

---

## 4. Voice size and licensing detail

### 4.1 Bundled: SVOX Pico

- Engine source is Apache-2.0 (SVOX AG / AOSP). The **language files** (`pico/lang/*.bin`) are
  distributed by AOSP as Apache-2.0, but Debian packages them as *non-free*: "Claims to be
  Apache-2.0 but the source code is not included. At least, it is redistributable." There is no
  restriction on redistribution or commercial use, only a missing "preferred form for modification".
  **Curt should accept this explicitly (D2).**
- en-US totals 2,543,129 bytes (about 1.5 MB gzip est.). en-GB, de-DE, es-ES, fr-FR and it-IT each
  add 0.86–1.2 MB. Output is 16 kHz mono 16-bit. The spike utterance hit full scale (peak 32768), so
  the renderer applies headroom and a deterministic 16→48 kHz resampler.
- Quality is better than eSpeak and clearly synthetic.

### 4.2 Neural (on demand; not part of "Available offline")

| Model | Bytes to download (model + voices + ORT wasm + JS) | Weights license | Phonemizer |
|---|---|---|---|
| Kitten TTS nano 0.8 int8 | 24.4 + 3.3 + 14.8 + ~1.3 ≈ **43.8 MB** | Apache-2.0 | eSpeak NG |
| Kokoro-82M v1.0 q8f16 | 86.0 + 0.5/voice + 14.8 + ~2.1 ≈ **103.5 MB** | Apache-2.0 | eSpeak NG |
| Piper ljspeech-medium | 63.5 + 14.8 + phonemize wasm (not measured) ≈ 80–90 MB | MIT model, PD dataset | eSpeak NG |

The editor origin downloads these after confirmation, verifies them against pinned SHA-256 hashes,
and stores them in a separate cache (`audio-voices-v1`). They reach the sandbox through the SDK
proxy, as Pyodide does. `kokoro.web.js` loads ORT WASM from jsDelivr by default, so `wasmPaths`
must point at our verified copy.

### 4.3 The G2P decision (D3)

- **(a) GPL phonemizer on demand.** Load `phonemizer@1.2.1` (compiled eSpeak NG, effectively
  GPL-3.0) as a separate, unmodified, downloaded module with its own notice. Whether this is "mere
  aggregation" under GPL is a legal judgment for Curt. Fastest path.
- **(b) Original permissive G2P.** CMUdict (BSD-style, ~3.6 MB raw / ~0.8 MB gzip) mapped
  ARPAbet→IPA, plus original letter-to-sound fallback rules. Fits the house license and adds about
  2–3 days of work. Pronunciation may differ slightly from what Kokoro/Kitten were trained on.
- **(c)** No neural voices in v1.

My recommendation is **(b)**, using (a) temporarily only if Curt is comfortable with it.

---

## 5. Test tolerances (follow from §2.2)

- **Rendered PCM from the worker:** exact. SHA-256 of the rendered float32 PCM (and WAV export) must
  match a committed golden hash **on all three engines**, not only within one. This applies to every
  gallery example except neural voices. The diagnostic checks below still run, so a mismatch is easy
  to read:
  - duration: exact sample count;
  - channels: exact;
  - silence boundaries: within ±10 ms at −60 dBFS;
  - peak/RMS per 100 ms window: ±0.1 dB.
- **Determinism test:** render twice in one session and require byte equality.
- **Compressed exports:** within-engine repeat equality only. Cross-engine checks decode the file and
  compare duration to within one codec frame plus priming (Opus pre-skip 312; AAC 1024/2112) and RMS
  to within 1 dB.
- **Neural voices:** per-engine byte equality if Step 3 shows seeded or zeroed noise works.
  Otherwise, cache equality keyed by (text, voice, model hash), and tests assert duration ±5% and
  non-silence only.
- **Native Web Audio:** not used for rendering, so there are no tolerances to set.

---

## 6. (a) Recommended dependency list

**Bundled and offline-cached.** Pinned and hash-verified. Where siblings do so, it is fetched from
the CDN rather than committed (see §8).

| # | Dependency | License | Size | Role |
|---|---|---|---|---|
| 1 | HashBin SDK v0.4.0 (`hashbin-sdk-v0.4.0.mjs`, `hashbin-cache-v0.4.0.js`) | HashBin | 37,633 + cache | sandbox, publish, verified cache |
| 2 | Pyodide **314.0.7** (same pin as PythonOnline, the newest sibling) | MPL-2.0 (+ CPython PSF) | ~13.4 MB | Python scenes only |
| 3 | numpy 2.4.6 (Pyodide wheel) | BSD-3 | 2,960,568 | `Samples`, numpy synthesis |
| 4 | abcjs 6.7.2 (`abcjs-basic-min.js`) | MIT | 511,968 | ABC parser |
| 5 | ZzFX 1.4.0 (`ZzFX.js`) | MIT | 10,301 | ZzFX notation |
| 6 | jsfxr 1.4.1 (`sfxr.js`) | Unlicense | 35,898 | sfxr notation |
| 7 | @echogarden/svoxpico-wasm 0.2.0 + Pico en-US lingware | Apache-2.0 (lingware caveat §4.1) | 2,543,129 | bundled voice |
| 8 | Ace 1.4.1, lz-string 1.5.0, Nayuki QR (as in siblings) | BSD / MIT / MIT | as siblings | editor, sharing |

**Original code (MIT):** `audio-lite.py`, the timeline schema, the renderer/DSP, `dmath`, the
resampler, the WAV reader/writer, the muxers (extending ManimOnline), the pattern mini-notation and
built-in drum kit, ABC instruments, the detector and the gallery.

**On demand, after confirmation (not offline):**

| # | Dependency | License | Size |
|---|---|---|---|
| 9 | onnxruntime-web 1.31.x (single-threaded WASM) | MIT | 14.8 MB wasm |
| 10 | Kitten TTS nano 0.8 int8 | Apache-2.0 | 27.6 MB |
| 11 | Kokoro-82M v1.0 q8f16 + chosen voices | Apache-2.0 | 86.0 MB + 0.5 MB each |
| 12 | G2P per D3: CMUdict (BSD-style) **or** phonemizer 1.2.1 (eSpeak NG, GPL-3.0) | see §4.3 | 0.8 MB gz / 1.3 MB |

**Rejected:** Tone.js, Strudel, WebChucK, native-Web-Audio rendering, eSpeak NG as the bundled voice
(unless D2 says otherwise), SAM, Flite WASI, mp4-muxer/webm-muxer, mediabunny and lamejs. Csound,
Faust and music21 are deferred.

### Decisions for Curt

- **D1.** Architecture: render everything in the sandbox worker with original deterministic DSP, and
  encode on the editor origin.
- **D2.** Bundled voice: Pico (recommended; accept the lingware caveat), or eSpeak NG (GPL), or both
  (Pico default, eSpeak as an opt-in GPL download).
- **D3.** Neural G2P: (b) original CMUdict (recommended), (a) GPL phonemizer, or (c) none in v1.
- **D4.** Neural models: Kitten nano (smaller) and Kokoro (better), or only one of them.
- **D5.** Uploaded compressed audio (MP3/OGG/M4A). Decoding it needs the editor origin's
  `decodeAudioData`, which differs per engine. Recommendation: accept WAV only (deterministic) in
  v1, decoded in the sandbox. Larger audio goes through CID samples.
- **D6.** Pyodide served like PythonOnline (pinned jsDelivr URL plus verified offline cache) rather
  than committed to the repo, as the brief literally says.
- **D7.** The HashBin app ID: placeholder `app_00000000-0000-0000-0000-000000000000` until supplied.

---

## 7. (c) `audio-lite` API proposal

**Split:** Python *describes* and JS *renders*. `construct()` builds a plain-JSON timeline. Raw numpy
arrays travel as transferred `Float32Array` buffers referenced by id. The JS renderer realizes the
timeline in the same worker. Notation-only documents build the same timeline directly in JS.

```python
from audio import *

class Intro(Scene):
    sample_rate = 48000            # 44100 | 48000
    channels = 2
    seed = 1                       # all randomness derives from this
    # length = 12                  # optional; otherwise the last clip end plus effect tails

    def construct(self):
        self.say("Welcome to Audio Online.", voice="pico:en-US", track="voice")   # advances self.time
        theme = abc("X:1\nT:Theme\nK:C\nCEG c2|", instrument="pluck")
        self.add(theme, at=0.5, track="music", gain=-12).fade_in(1)
        boom = Sine(55).env(adsr(0.01, 0.2, 0, 0.3)).dur(0.6) + Noise(seed=1).lowpass(800).dur(0.3)
        self.add(boom, at=self.time, track="sfx", pan=-0.3)
        self.wait(1)
        self.track("music").fx(Reverb(room=0.4), Compressor(-18, 4)).duck(under="voice", amount=-9)
        self.master.fx(Limiter(-1))
```

- **Sources (nouns):**
  - oscillators: `Sine/Square/Saw/Triangle(freq)`;
  - noise: `Noise(color="white|pink|brown", seed=)`;
  - envelopes: `adsr(a, d, s, r)`, `Envelope([(t, v), …], curve=)`;
  - samples: `Samples(array, rate)`, `Sample(cid="…")`, `Sample("kick.wav")` (uploaded file);
  - notation: `abc(text, instrument=)`, `zzfx([...])`, `sfxr(params | preset, seed=)`,
    `pattern("bd*2 [~ sn] hh*4", bpm=, kit=)`;
  - speech: `Speech(text, voice=)`;
  - `Silence(seconds)`.
- **Clip operations** return new clips, immutable as in Pydub:
  - `.dur(s)`, `[a:b]` (seconds, unlike Pydub's ms), `.loop(n | until=)`, `.gain(db)`, `.pan(p)`;
  - `.fade_in(s)`, `.fade_out(s)`, `.reverse()`, `.speed(r)`, `.env(e)`;
  - `.lowpass/.highpass/.bandpass(f, q)`, `.fx(*effects)`;
  - `a + b` mixes (as in the brief's sketch, **not** Pydub's concatenation), `a >> b` sequences,
    `a * n` repeats.
- **Placement and time (Manim verbs):**
  - `self.add(clip, at=self.time, track="main", gain=0, pan=0)` returns a placement handle;
  - `self.play(clip)` adds the clip and advances `self.time` by its length;
  - `self.wait(s)`, `self.say(text, voice=, …)` (equivalent to `play(Speech(...))`), `self.time`.
- **Tracks and master:**
  - `self.track(name)` supports `.fx(...)`, `.gain(db)`, `.pan(p)`, `.duck(under=, amount=,
    attack=, release=)` and automation, e.g. `.automate("gain", [(0, -60), (2, 0)])`;
  - `self.master` takes the same effects.
- **Effects:** `LowPass/HighPass/BandPass/Peak/Shelf`, `Delay(time, feedback, mix)`,
  `Reverb(room, damp, mix)` (Freeverb-style, our implementation), `Compressor(threshold, ratio,
  attack, release, makeup)`, `Limiter(ceiling)`, `Gain`, `Drive`. All of them are deterministic JS.
- **Speech length inside `construct()`:** `say()` must know the utterance length synchronously.
  Pico is synchronous WASM in the same worker, so a bridge synthesizes and caches during
  `construct()`. Neural voices are async, so `construct()` runs in a collect pass that records
  speech requests with estimated lengths. The app then synthesizes them and re-runs `construct()`
  (it is deterministic because seeded) until the lengths are stable, at most 3 passes. Users write
  ordinary synchronous code either way.
- **Source lines:** every clip records its caller's line (`sys._getframe`) so lane clicks jump to
  source. Tracebacks use the user file name with no prepended lines, as Gnuplot's diagnostics do.
- **Several Scenes in one file** show a scene selector, as in ManimOnline.

Timeline JSON (abbreviated):

```json
{"format":"audio-timeline","version":1,"sampleRate":48000,"channels":2,"seed":1,"length":null,
 "sources":{"s1":{"kind":"osc","wave":"sine","freq":55,"dur":0.6,"env":{"adsr":[0.01,0.2,0,0.3]},"line":9},
            "s2":{"kind":"speech","text":"Welcome to Audio Online.","voice":"pico:en-US","line":6},
            "s3":{"kind":"buffer","ref":0,"rate":22050}},
 "clips":[{"id":"c1","source":"s1","track":"sfx","at":1.82,"gain":0,"pan":-0.3,"fade":[0,0],"slice":[0,null],"loop":1,"fx":[],"line":10}],
 "tracks":{"music":{"fx":[{"type":"reverb","room":0.4},{"type":"compressor","threshold":-18,"ratio":4}],"duck":{"under":"voice","amount":-9}}},
 "master":{"fx":[{"type":"limiter","ceiling":-1}]}}
```

Saved documents follow the brief:
`{ format: 'hashbin-audio', version: 1, src, type: 'python'|'abc'|'zzfx'|'sfxr'|'pattern', settings: { sampleRate, channels, scene, renderer }, files }`.

---

## 8. Sibling conventions and conflicts (flagged, not silently resolved)

- **Newest sibling:** Livelier (2026-10-29) is newest by feature work. It still lives at
  `curtcox.github.io/livelier`, is not in `OWNED_APPS`, and uses its own window bootstrap with
  `'unsafe-eval'`. The B13 migration commits on Gnuplot, Manim, Python, Pages, sheets and modl
  (2026-10-30) are newer for hosting and domain conventions. I'll follow B13 for hosting, migration
  and legacy notices, and Gnuplot's layout as the brief directs. Audio Online does not need
  `'unsafe-eval'`.
- **Document format:** Gnuplot saves `{format:'hashbin-diagram', type:'gnuplot', gnuplot:{…}}`, but
  the brief specifies `hashbin-audio` with a `settings` key. I'll follow the brief.
- **Offline:** Gnuplot's service worker does its own hash checks and does **not** use
  `hashbin-cache-v0.4.0.js`. ManimOnline, PythonOnline and Livelier do. The brief asks for the
  vendored cache helper, so I'll follow Manim/Python. The script name stays Gnuplot's
  `scripts/update-offline.mjs` (Manim's is `update-offline-hashes.mjs`; Livelier uses
  `npm run offline`).
- **Pyodide pins differ:** Manim 0.27.0, sheets 0.27.7, Python 314.0.7. I'll use 314.0.7. Siblings
  serve Pyodide from a pinned jsDelivr URL plus a verified cache rather than committing it, which
  conflicts with the brief's "vendored WASM is committed" (D6).
- **Stale sibling doc:** Gnuplot's README still gives the old GitHub Pages return URL in one section
  and `gnuplot.hashbin.page` in another.
- **Firefox locally:** Playwright's Firefox fails to launch on macOS 27, matching hashbin.org's note.
  Desktop Firefox through WebDriver BiDi works and would be the local recipe. CI on Linux keeps the
  bundled Firefox.
- **Sandbox hardening:** the SDK prelude doesn't remove storage APIs, and WebKit exposes `caches`
  (opaque partition) to the worker. I'll copy PythonOnline's `harden()` step.

---

## 9. What happens after sign-off (unchanged from the brief, adjusted for the above)

1. Skeleton from Gnuplot conventions, plus the deterministic renderer, WAV export and the three-engine
   CI, with one path end to end: Python → timeline → WAV.
2. Notations (ABC, ZzFX, sfxr, pattern), then Pico, then effects/tracks/stems, then neural voices on
   demand (D3/D4).
3. Gallery and covers.
4. hashbin.org registry entry and staging.

**Stopping here for sign-off on D1–D7.**

---

## 10. Sign-off (2026-10-30)

Curt approved every recommendation:

- **D1:** render only in the sandbox worker, using original deterministic DSP. Encode on the editor origin.
- **D2:** SVOX Pico is the bundled voice. The lingware caveat is accepted.
- **D3:** write an original CMUdict-based G2P, with no GPL phonemizer.
- **D4:** Kitten TTS nano and Kokoro-82M are available on demand.
- **D5:** v1 accepts WAV uploads only.
- **D6:** serve Pyodide like PythonOnline, from a pinned CDN with a verified offline cache.
- **D7:** use a placeholder app ID until Curt supplies the real one.
