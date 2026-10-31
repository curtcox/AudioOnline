# Neural voices: implementation notes

Implemented on 2026-10-30 for the last part of Step 3. Decisions D3 (an original CMUdict G2P,
no GPL phonemizer) and D4 (Kitten nano plus Kokoro, both on demand) apply.

Use `self.say("Hello, world!", voice="kitten:Bella")` or `voice="kokoro:af_heart"`.
Python’s `VOICES` lists all eight Kitten aliases and the 21 American English Kokoro styles.
Neural voices support speed 0.5–2; pitch must remain 1 (Pico supports pitch changes).

- `src/neural-manifest.js`: exact URLs, sizes and SHA-256 pins.
- `src/voice-assets.js`: editor-only confirmation and the separate verified on-demand cache.
- `src/g2p.js`: original English normalization, CMUdict mapping and contextual fallback rules.
- `src/neural-voice.js`: original NPZ/NPY reader, ONNX adapters, seeded inference and utterance cache.
- `src/audio-worker.js`: retries Python after each missing utterance is prepared, so `self.time`
  uses actual speech duration. Failed downloads or synthesis keep the last good render and its lines.

First downloads total **45,582,453 bytes** for Kitten and **104,492,214 bytes** for Kokoro af_heart,
including the shared runtime and dictionary. Switching models downloads only the remaining model
assets (86.6 MB for Kokoro after Kitten). No neural assets enter “Available offline”.

## Pins

- **onnxruntime-web 1.30.0** (2026-09-14). It is the newest release older than two weeks; 1.31.1 is
  four days old. Run it single-threaded with `env.wasm.proxy = false`, because the opaque sandbox has
  no SharedArrayBuffer.
  - Load `ort.wasm.min.mjs` through `hashbinSandbox.import`.
  - Pass the wasm bytes as `env.wasm.wasmBinary`.
  - Load the glue `.mjs` as a blob module. The CSP does not allow jsDelivr in `script-src`.
  - The verified glue works after sandbox hardening without an `importScripts` stub.
  - Actual runtime sizes: JS 50,126 bytes, glue 24,381 bytes, WASM 14,239,897 bytes.
- **Kitten TTS nano 0.8 int8:** `KittenML/kitten-tts-nano-0.8-int8` at commit
  `84781d74e29ee25217551556398b42f80593a813`.
  - Files: `kitten_tts_nano_v0_8.onnx` (24,369,971 bytes) and `voices.npz` (3,278,902 bytes; HF
    x-linked-etag `8aa7cee2…`).
  - Voices: Bella, Jasper, Luna, Bruno, Rosie, Hugo, Kiki and Leo map to `expr-voice-{2..5}-{f,m}`.
  - `config.json` has `speed_priors`: 0.8 for most voices and 0.9 for `expr-voice-4-m`. Multiply the
    requested speed by the prior.
- **Kokoro-82M v1.0:** `onnx-community/Kokoro-82M-v1.0-ONNX` at commit
  `1939ad2a8e416c0acfeecc08a694d14ef25f2231`.
  - Files: `onnx/model_q8f16.onnx` (86,033,585 bytes) and `voices/<name>.bin` (522,240 bytes =
    Float32 [510, 256]).
  - The vocabulary is in `tokenizer.json`.
- **Hosting and CORS:** `huggingface.co/<repo>/resolve/<commit>/<file>` redirects with a 302 to
  `us.aws.cdn.hf.co`. Both send CORS headers (`access-control-allow-origin` echoes the origin, then
  `*`). The CSP `connect-src` and the SDK proxy prefixes include `https://huggingface.co/` and
  `https://us.aws.cdn.hf.co/`; the redirect host was rechecked during implementation. Verify every file's SHA-256
  before caching it in `audioonline-voices-v1`.

## Model I/O

Both models output 24 kHz audio. They take `input_ids` int64 [1, n], `style` float32 [1, 256] and
`speed` float32 [1].

- **Kitten:**
  - Symbols are StyleTTS2's: pad `$`, punctuation `;:,.!?¡¿—…"«»"" ` (with a space), A–Z a–z, then 109
    IPA symbols (see kitten-tts-js `text-cleaner.js`). Ids follow the code-point order; the last
    duplicate wins.
  - Ids are `[0, …phoneme ids, 10, 0]`. The phonemes are tokenized with `\w+|[^\w\s]` and joined by
    spaces.
  - The style row is `min(len(ids), rows − 1)` of the voice's npz array.
  - Trim the last 5000 output samples.
  - Text is split into sentences on `[.!?]+`; a chunk that doesn't end in punctuation gets a trailing
    comma.
  - It expects eSpeak-style en-US IPA with stress marks `ˈ ˌ`.
- **Kokoro:**
  - Ids come from `tokenizer.json` with 0 padding at both ends.
  - The style is the voice row `min(max(n − 2, 0), 509)`, 256 floats.
  - The output is `waveform`.
  - Expected phonemes are misaki/eSpeak-like en-US IPA. kokoro-js post-processes eSpeak output: `r→ɹ`,
    `x→k`, `ɬ→l`, `ʲ→j`, and `nˈaɪnti→nˈaɪndi`.

## G2P plan (D3)

The original module uses CMUdict (cmusphinx/cmudict, BSD-style), commit
`74790861f652b15e4ac49015a90074ad62a27690`, downloaded with the voice and hash-pinned.
It maps ARPAbet to IPA:

- **Vowels:** AA ɑ, AE æ, AH0 ə, AH1/2 ʌ, AO ɔ, AW aʊ, AY aɪ, EH ɛ, ER ɜɹ (stressed) or ɚ, EY eɪ,
  IH ɪ, IY i, OW oʊ, OY ɔɪ, UH ʊ, UW u.
- **Consonants:** CH ʧ, DH ð, G ɡ, HH h, JH ʤ, NG ŋ, R ɹ, SH ʃ, TH θ, Y j, ZH ʒ; the rest map to
  themselves.
- **Stress:** put 1 → ˈ and 2 → ˌ before the stressed vowel.

Words missing from the dictionary use compact original context rules inspired by the public-domain
NRL method, rather than a reproduction of its complete rule table. Numbers (including decimals,
negative values and digit sequences) and common abbreviations are normalized before sentence splitting.
The front end is English-only; unknown-word pronunciation is approximate. No eSpeak or wrapper code is
bundled. License declarations and notices are recorded in `vendor/PROVENANCE.md` and `vendor/neural/`.

## Determinism and flow

- Kitten has two random operators (`RandomUniformLike` and `RandomNormalLike`). An original protobuf
  patch adds explicit float seeds 1 and 2 **after** the original model hash is verified. Cached model
  bytes stay unmodified. Each utterance uses a fresh session, so its RNG cannot depend on prior speech.
- Kokoro’s pinned export has no random operators. It also gets a fresh session per utterance.
- The worker caches bounded prepared PCM by text, voice, speed and pitch, with model/runtime/G2P pins
  fixed by the worker source. Sessions are released after synthesis. No render-cache equality fallback
  is needed for these pins: fresh-session repeat inference is byte-identical in the tested engines.
- The synchronous Python bridge reports `VOICE_NOT_LOADED:kitten:…` or `VOICE_NOT_LOADED:kokoro:…`
  initially, and `NEURAL_UTTERANCE_NOT_READY` for another utterance of an already loaded voice.
  The worker requests approval from the editor, which validates the voice name, shows the remaining
  download size and explains that it is not part of “Available offline”. Only then can files download.
- Every downloaded or persistently cached file is checked against the pinned size and SHA-256 before
  use. Corrupted cache entries need a newly confirmed download. Storage failure falls back to memory.
  `createSandbox({ fetch })` exposes only approved, verified files, including ORT module imports.
- Cancelling or editing aborts pending downloads and discards the worker; stale approval cannot resume
  an older run. Loading and inference use the startup deadline, separate from synchronous scene render.
  The service worker preserves `audioonline-voices-v1` across app updates.

## Validation

`npm ci`, `npm test`, `npm run check`, and `node scripts/golden.mjs --check` cover the existing app and
new unit checks. The existing golden outputs are unchanged. The full browser suite exercises the
actual Pyodide and renderer in Chromium, Firefox (desktop BiDi on macOS 27) and WebKit.

Fetch real hash-verified test fixtures with `node scripts/fetch-neural.mjs`, then run
`node tests/browser/neural.cjs http://127.0.0.1:8000/ chromium` (also `firefox`, `webkit`).
The test checks declined downloads, last-good-render preservation, actual cursor timing, a runtime
voice choice, fresh-session equality, and persistent-cache reload without network or prompts. The
Kitten test utterance produced the same float32 WAV SHA-256 in all three engines:
`100c709cd00c310bb2751397daab8789cd81d333153489bff6552b6e937f72d2`.
This is diagnostic evidence; cross-engine neural equality is not part of the non-neural golden contract.

Kitten runs in CI for every engine. Kokoro remains opt-in: fetch with
`node scripts/fetch-neural.mjs --kokoro` and run the same test with `KOKORO=1`, or enable the Kokoro
input on the Test Audio Online manual workflow. The fixtures are served over HTTP so Kokoro’s large
model does not exceed Chromium’s protocol message limit when running through Playwright.
