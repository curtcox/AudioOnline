# Step 1 spike

Evidence for [docs/step1-report.md](../../docs/step1-report.md). It is not app code.

The spike loads the real HashBin SDK v0.4.0 under a sibling-style CSP. It then runs the same checks
in three contexts:

- the editor origin;
- a raw `sandbox="allow-scripts"` iframe window;
- the SDK's opaque worker.

Each check records:

- whether Web Audio, WebCodecs and storage APIs are available;
- per-stage determinism hashes for native nodes, JS libm, pure-arithmetic DSP, numpy, Pico, abcjs,
  ZzFX and jsfxr;
- timings.

```sh
./fetch-assets.sh          # pinned third-party bytes into ./assets (git-ignored)
PW=../../../GnuPlotOnline/node_modules/playwright node run.cjs chromium webkit firefox-bidi
node compare.cjs           # side-by-side table of results/*.json
```

`firefox-bidi` drives a desktop Firefox through WebDriver BiDi (`FIREFOX_PATH`, default
`/Applications/Firefox.app`). Playwright's bundled Firefox does not launch on macOS 27. `results/`
holds the 2026-10-30 runs cited in the report.
