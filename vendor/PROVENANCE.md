# Vendored engines

Each file is byte-identical to the named npm release tarball. Do not edit them; the loaders in
`src/notation.js` add a module-scope prelude at load time instead (a deterministic `Math`, and an
`AudioContext` stub for ZzFX, which creates one when its module loads).

| Files | Package | License |
|---|---|---|
| `abcjs/abcjs-basic-min.js` | `abcjs@6.7.2` `dist/abcjs-basic-min.js` | MIT ([abcjs/LICENSE.md](abcjs/LICENSE.md)) |
| `zzfx/ZzFX.js` | `zzfx@1.4.0` `ZzFX.js` | MIT ([zzfx/LICENSE](zzfx/LICENSE)) |
| `jsfxr/sfxr.js` | `jsfxr@1.4.1` `sfxr.js` | Unlicense ([jsfxr/UNLICENSE](jsfxr/UNLICENSE)) |
| `hashbin-sdk-v0.4.0.mjs`, `hashbin-cache-v0.4.0.js` | HashBin SDK v0.4.0 release | HashBin |
| `lz-string.min.js` | lz-string 1.5.0 | MIT ([LICENSE-lz-string](LICENSE-lz-string)) |

`tests/notation.test.js` checks the SHA-256 of each engine file.

## SVOX Pico (bundled voice)

| Files | Source | License |
|---|---|---|
| `svoxpico/svoxpico.js`, `svoxpico/svoxpico.wasm` | `@echogarden/svoxpico-wasm@0.2.0` | Apache-2.0 ([svoxpico/LICENSE](svoxpico/LICENSE)) |
| `svoxpico/lang/*.bin` (en-US, en-GB, de-DE, es-ES, fr-FR, it-IT) | `naggety/picotts` commit `21089d223e177ba3cb7e385db8613a093dff74b5`, `pico/lang/`, from AOSP `platform/external/svox` | Apache-2.0 as distributed by AOSP |

The language files are redistributable under Apache-2.0 (copyright SVOX AG and the Android Open Source
Project). Debian classes them as non-free because their source data is not published; Curt accepted this
in the Step 1 sign-off (D2). `src/voice.js` loads the engine module unmodified (`locateFile` and
`wasmBinary` are passed in). `tests/voice.test.js` checks the SHA-256 of every file.

## Neural voices (on demand)

`src/neural-manifest.js` pins exact URLs, byte sizes and SHA-256s. These large files are **not**
vendored or included in the offline manifest. The editor downloads them only after confirmation.

| Asset | Pin | License |
|---|---|---|
| ONNX Runtime Web WASM runtime, glue and binary | `onnxruntime-web@1.30.0` | MIT, Microsoft; [license](neural/ONNXRuntime-LICENSE.txt), [third party notices](neural/ONNXRuntime-ThirdPartyNotices.txt) |
| Kitten nano 0.8 int8 model, NPZ styles and configuration | `KittenML/kitten-tts-nano-0.8-int8` commit `84781d74e29ee25217551556398b42f80593a813` | Apache-2.0, KittenML; [model card](https://huggingface.co/KittenML/kitten-tts-nano-0.8-int8/blob/84781d74e29ee25217551556398b42f80593a813/README.md) |
| Kokoro-82M v1.0 q8f16 model, tokenizer and American English styles | `onnx-community/Kokoro-82M-v1.0-ONNX` commit `1939ad2a8e416c0acfeecc08a694d14ef25f2231` | Apache-2.0, hexgrad / ONNX Community; [model card](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/blob/1939ad2a8e416c0acfeecc08a694d14ef25f2231/README.md) |
| CMU pronunciation dictionary | `cmusphinx/cmudict` commit `74790861f652b15e4ac49015a90074ad62a27690` | BSD-style, Carnegie Mellon; [license](neural/CMUdict-LICENSE.txt) |

[Apache-2.0 license text](neural/Apache-2.0.txt). The original G2P, NPZ reader, ONNX seed patch and
model adapters live in `src/g2p.js` and `src/neural-voice.js`. No wrapper or GPL phonemizer is used.
Kitten's two random operators receive explicit seed attributes in memory, after integrity checking;
the original downloaded file is cached unchanged. Inference sessions restart per utterance.

## Fragment Kit v0.3.3

Shared SDK, compression, QR encoder/decoder and their licenses now live in the independently verified published `fragment-kit-v0.3.3` pin. Duplicate top-level SDK/cache/lz-string files have been removed. Original notation, Pico and neural vendor bytes and notices remain unchanged. See `fragment-kit-v0.3.3/vendor/PROVENANCE.md` and its integrity manifest.
