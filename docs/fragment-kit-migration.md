# Fragment Kit migration

Audio Online vendors the immutable Fragment Kit v0.3.3 release. Native ES modules supply URL parsing, verified CID loads, HashBin Publish, QR creation and scanning, drafts, scheduling, offline delivery, the shell and gallery filters. No production build is required.

Audio owns its document adapter in src/fragment-config.mjs. Existing hashbin-audio version 1 envelopes, compressed/raw/source links, notation type, render settings and attached WAV files keep loading. Writers retain the existing envelope until every consumer can read the shared version. The new shared audio envelope is readable now.

The worker still runs in the original opaque SDK sandbox. Its sample adapter binds the kit CID module to the kit byte helpers using local Blob module URLs because the SDK imports single modules. Render requests queue until those imports finish. Pinned vendor files are not rewritten on disk. Audio's 16 MiB sample policy remains separate from its 5 MiB document limit.

Rendering, deterministic math, Python scene API, notation engines, Pico heap reset, effects, track mixing, playback gestures and compressed exports remain app-owned. Golden audio hashes must stay unchanged across Chromium, Firefox and WebKit. Neural assets keep their original consent flow and audioonline-voices-v1 verified cache; gallery AAC media stays outside offline readiness.

Public client registration and canonical hosting are staged owner work. Empty client configuration disables Publish visibly. The generated migration notice remains inactive until the canonical site is live.
