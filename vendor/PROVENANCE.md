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
