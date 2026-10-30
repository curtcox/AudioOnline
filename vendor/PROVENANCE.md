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
