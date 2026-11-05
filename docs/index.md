# Audio Online guide

Write code, render exact audio in your browser, then listen or download it. Python scenes, ABC tunes, ZzFX, sfxr and patterns use the same deterministic renderer. Start with the [sample gallery](../gallery.html).

## Edit and listen

Use Render to hear changes, then Play to start playback. On a phone, switch between Preview and Code. More holds downloads, sharing, HashBin and saved-work recovery.

The waveform supports seeking and loop selection. Track mute and solo affect preview playback. Downloads keep the full rendered mix; Stems downloads the individual tracks. Source, waveform images, WAV and supported compressed formats are available in More.

## Share and recover

Share creates a link containing source, settings and attached WAV files. Run on open can be turned off. QR code shows the link and loads another code through the camera or an image upload, paste or drop. Oversized codes offer a HashBin save instead.

Explicit source, example and CID links always open their document. Saved work stays separate: More → Resume saved work restores an earlier edit. Invalid links show an error. Opening a link never silently falls back to a draft.

HashBin loads verify their content ID before opening a document. Publish is disabled until the owner supplies a registered public client ID. Approval and payment happen on hashbin.org; this editor keeps no HashBin credentials.

## Audio files and voices

Attach WAV files through Audio files and use Sample("name.wav") in Python. Files have a 2 MiB individual limit and travel with the 5 MiB document. Sample(cid=…) accepts verified audio up to 16 MiB. Missing or invalid samples report an error.

The bundled voice works with the offline app. Neural voices ask before downloading and use a separate verified cache. They are never included in Available offline. Gallery AAC previews stream only when played.

## Offline and hosting

Wait for Available offline before disconnecting. More → Repair offline copy restores damaged files. Update and reload keeps the current document and installs a waiting update.

The recovery site is [GitHub Pages](https://curtcox.github.io/AudioOnline/). The prospective audio.hashbin.page origin and HashBin client registration remain owner setup. No new canonical deployment is claimed by this migration.

See the [migration notes](fragment-kit-migration.md) and original [implementation report](step1-report.md).
