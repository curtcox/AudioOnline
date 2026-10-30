# Neural voices: research notes (in progress)

These are working notes for the last part of Step 3, gathered on 2026-10-30. No neural-voice code
exists yet. Decisions D3 (an original CMUdict G2P, no GPL phonemizer) and D4 (Kitten nano plus
Kokoro, both on demand) apply.

## Pins

- **onnxruntime-web 1.30.0** (2026-09-14). It is the newest release older than two weeks; 1.31.1 is
  four days old. Run it single-threaded with `env.wasm.proxy = false`, because the opaque sandbox has
  no SharedArrayBuffer.
  - Load `ort.wasm.min.mjs` through `hashbinSandbox.import`.
  - Pass the wasm bytes as `env.wasm.wasmBinary`.
  - Load the glue `.mjs` as a blob module. The CSP does not allow jsDelivr in `script-src`.
  - It may need the same `importScripts` stub as the Pico module.
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
  `*`). The CSP `connect-src` and the SDK proxy prefixes need `https://huggingface.co/` and
  `https://us.aws.cdn.hf.co/`; check the redirect host again at build time. Verify every file's SHA-256
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

Build an original module from CMUdict (cmusphinx/cmudict, BSD-style), downloaded with the voice and
hash-pinned. It maps ARPAbet to IPA:

- **Vowels:** AA ɑ, AE æ, AH0 ə, AH1/2 ʌ, AO ɔ, AW aʊ, AY aɪ, EH ɛ, ER ɜɹ (stressed) or ɚ, EY eɪ,
  IH ɪ, IY i, OW oʊ, OY ɔɪ, UH ʊ, UW u.
- **Consonants:** CH ʧ, DH ð, G ɡ, HH h, JH ʤ, NG ŋ, R ɹ, SH ʃ, TH θ, Y j, ZH ʒ; the rest map to
  themselves.
- **Stress:** put 1 → ˈ and 2 → ˌ before the stressed vowel.

Words missing from the dictionary use original letter-to-sound rules (the public-domain NRL rules).
Numbers and abbreviations get a small normalizer.

## Open risks

- **Determinism:** run the same utterance twice per engine and compare bytes. If the models contain
  RandomNormalLike ops, seed or zero them, or fall back to cache equality as §5 of the Step 1 report
  says.
- **Flow:** a neural voice must never download without confirmation. The worker reports
  `VOICE_NOT_LOADED:kitten:…`, and the editor asks before downloading (showing sizes and that the voice
  is not part of "Available offline"). The page's verified cache then serves the files to the sandbox
  through `createSandbox({ fetch })`.
- **CI:** Kitten fits in CI (about 44 MB per engine). Make Kokoro (about 104 MB) opt-in.
