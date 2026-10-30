/* Browser glue. The renderer, documents and exports stay independent of the UI. */
(async () => {
  'use strict';
  const $ = id => document.getElementById(id);
  const STORAGE_KEY = 'audioonline:document';
  const editor = ace.edit('editor');
  globalThis.editor = editor;
  editor.setTheme('ace/theme/chrome'); editor.session.setMode('ace/mode/python');
  editor.setOptions({ showPrintMargin: false, tabSize: 4, useSoftTabs: true, useWorker: false });
  let settings = AudioCore.options(), files = {}, revision = 0, applying = false, result = null, saved = null, persistTimer;
  const snapshot = () => ({ src: editor.getValue(), type: 'python', settings: { ...settings }, files: { ...files } });
  const fingerprint = () => JSON.stringify(snapshot());
  const links = () => ShareLinks.build({ url: location.href, ...snapshot(), compress: LZString.compressToEncodedURIComponent });
  const currentLink = () => saved?.fingerprint === fingerprint() ? saved.link : links().fallback;
  const safeStorage = name => { try { return window[name]; } catch (_) { return undefined; } };
  const local = safeStorage('localStorage');
  const setError = message => { $('error').textContent = message; $('error').hidden = !message; $('preview').classList.toggle('stale', !!message); };
  const client = new AudioClient({ onStatus: text => { $('status').textContent = text; },
    onSlow: () => { $('status').textContent = 'Still rendering…'; $('cancel').hidden = false; } });
  const scheduler = new RenderScheduler({ detect: () => {}, render, renderDelay: 600 });
  const player = new AudioPlayer({ canvas: $('waveform'), lanes: $('lanes'), button: $('play'), time: $('time'),
    onClip: line => { editor.gotoLine(line, 0, true); if (document.body.dataset.tab === 'preview' && matchMedia('(max-width: 760px)').matches) return; editor.focus(); } });
  globalThis.audioPlayer = player;
  let marked = null;
  function annotate(line, message) {
    if (marked !== null) editor.session.removeGutterDecoration(marked, 'scene-error');
    marked = null; editor.session.clearAnnotations();
    if (!line) return;
    marked = line - 1;
    editor.session.setAnnotations([{ row: marked, column: 0, text: message, type: 'error' }]);
    editor.session.addGutterDecoration(marked, 'scene-error');
  }
  function showScenes(names, current) {
    const select = $('scene');
    select.replaceChildren(...names.map(name => Object.assign(document.createElement('option'), { value: name, textContent: name })));
    if (current) select.value = current;
    $('scene-label').hidden = names.length < 2;
  }
  function showOutput(text) { $('output').textContent = text || ''; $('output-panel').hidden = !text; }
  async function render() {
    const ownRevision = revision;
    $('status').textContent = result ? 'Rendering…' : 'Loading the audio engine…'; $('cancel').hidden = false;
    try {
      AudioFiles.validate(files, editor.getValue());
      const next = await client.run(editor.getValue(), settings);
      if (ownRevision !== revision) return;
      $('cancel').hidden = true;
      annotate(null); setError(''); result = next;
      showScenes(next.scenes, next.scene); showOutput(next.output);
      $('empty').hidden = true; player.load(next);
      const seconds = next.length / next.sampleRate;
      $('note').textContent = next.length ? '' : 'The scene is silent: add clips with self.add() or self.play().'; $('note').hidden = !!next.length;
      $('status').textContent = `Rendered ${seconds.toFixed(2)} s in ${Math.round(next.ms)} ms`;
      window.dispatchEvent(new Event('audio-rendered'));
    } catch (error) {
      if (ownRevision !== revision || error.message === 'Cancelled') return;
      $('cancel').hidden = true;
      if (error.scene) {
        showScenes(error.scenes || [], settings.scene); showOutput([error.output, error.traceback].filter(Boolean).join('\n'));
        annotate(error.line, error.message);
        setError(error.line ? `Line ${error.line}: ${error.message}` : error.message);
        $('status').textContent = 'Check your scene';
      } else { setError(error.message); $('status').textContent = 'Rendering stopped'; }
      if (!result) $('empty').textContent = 'Fix the scene to hear it.';
    }
  }
  function persist() {
    try { local?.setItem(STORAGE_KEY, HashBinDocuments.serialize(snapshot())); } catch (_) { /* Storage can be unavailable or full; editing continues. */ }
  }
  function refreshShare({ address = false } = {}) {
    try {
      const url = currentLink(); $('share-url').value = url;
      if (address) history.replaceState(null, '', url);
      refreshQr();
    } catch (error) { $('share-status').textContent = error.message; }
  }
  function changed() {
    if (applying) return;
    revision++; client.cancel(); hashbin.cancelLoad(); shareClient.cancel(); saved = null;
    $('share-status').textContent = ''; $('cancel').hidden = true; $('status').textContent = 'Waiting for edits…';
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => { persist(); refreshShare({ address: true }); }, 180);
    scheduler.schedule({ detect: false });
  }
  function syncOptions() { $('sample-rate').value = settings.sampleRate; $('channels').value = settings.channels; }
  function apply(doc) {
    const nextFiles = doc.files || {}; AudioFiles.validate(nextFiles, doc.src);
    applying = true;
    try { files = { ...nextFiles }; settings = AudioCore.options(doc.settings); editor.setValue(doc.src, -1); editor.session.setUndoManager(new ace.UndoManager()); syncOptions(); }
    finally { applying = false; }
    revision++; scheduler.cancel(); client.cancel(); saved = null; persist(); render();
  }
  const shareClient = new ShareClient();
  const redirect = new URL('./', location.href); redirect.search = ''; redirect.hash = '';
  const store = new HashBinStore({ clientId: document.querySelector('meta[name="hashbin-client-id"]').content.trim(),
    redirectUri: redirect.href, storage: local, transactionStorage: safeStorage('sessionStorage') });
  // Links can come from anyone; never let one silently replace work kept in this browser.
  let linkLoad = false;
  function acceptLink(doc) {
    const same = (a, b) => a.src === b.src && JSON.stringify(a.files || {}) === JSON.stringify(b.files || {}), current = snapshot();
    if (same(current, doc) || current.src === AudioExamples.defaultSource || AudioExamples.catalog.some(sample => same(current, { src: sample.source }))) return true;
    if (confirm('This link opens a different scene. Replace the scene saved in this browser?\n\nChoose Cancel to keep your current work.')) return true;
    refreshShare({ address: true });
    return false;
  }
  const hashbin = new HashBinPanel({ store, getSnapshot: snapshot, getFingerprint: fingerprint,
    onLoad: (doc, cid) => { if (linkLoad && !acceptLink(doc)) return false; apply(doc); const link = HashBinDocuments.link(location.href, cid); saved = { fingerprint: fingerprint(), link }; history.replaceState(null, '', link); refreshShare(); },
    onSaved: (_cid, value, link) => { saved = { fingerprint: value, link }; history.replaceState(null, '', link); refreshShare(); } });
  editor.session.on('change', changed);
  $('render').onclick = () => { scheduler.cancel(); revision++; client.cancel(); render(); };
  $('cancel').onclick = () => { revision++; scheduler.cancel(); client.cancel(); $('cancel').hidden = true; $('status').textContent = 'Cancelled'; };
  $('sample-rate').onchange = $('channels').onchange = () => { settings = AudioCore.options({ ...settings, sampleRate: $('sample-rate').value, channels: $('channels').value }); changed(); };
  $('scene').onchange = () => { settings = AudioCore.options({ ...settings, scene: $('scene').value }); changed(); };
  $('hide-editor').onclick = () => { document.body.classList.add('editor-hidden'); $('show-editor').hidden = false; resize(); };
  $('show-editor').onclick = () => { document.body.classList.remove('editor-hidden'); $('show-editor').hidden = true; resize(); };
  const resize = () => { editor.resize(); player.draw(); };
  let drag = false;
  $('splitter').onpointerdown = event => { drag = true; $('splitter').setPointerCapture(event.pointerId); };
  $('splitter').onpointermove = event => { if (!drag) return; const rect = document.querySelector('.workspace').getBoundingClientRect(); setSplit((event.clientX - rect.left) / rect.width * 100); };
  $('splitter').onpointerup = () => { drag = false; };
  $('splitter').onpointercancel = () => { drag = false; };
  function setSplit(value) { const width = Math.max(20, Math.min(75, value)); $('editor-pane').style.width = width + '%'; $('splitter').setAttribute('aria-valuenow', Math.round(width)); resize(); }
  $('splitter').onkeydown = event => { if (['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); setSplit(parseFloat($('splitter').getAttribute('aria-valuenow')) + (event.key === 'ArrowLeft' ? -2 : 2)); } };
  window.addEventListener('resize', resize);
  for (const tab of ['preview', 'code']) $('tab-' + tab).onclick = () => { document.body.dataset.tab = tab; for (const name of ['preview', 'code']) $('tab-' + name).setAttribute('aria-selected', name === tab); resize(); if (tab === 'code') editor.focus(); };
  $('more').onclick = () => { const open = document.body.classList.toggle('more-open'); $('more').setAttribute('aria-expanded', open); resize(); };
  async function download() {
    try {
      const format = $('export-format').value, name = (result?.scene || 'scene').toLowerCase();
      if (format === 'source') return AudioExport.download(editor.getValue(), 'scene.py', 'text/x-python;charset=utf-8');
      if (!result) throw new Error('Render the scene first.');
      if (format === 'svg' || format === 'png') {
        const svg = AudioWaveform.svg(result.channels);
        return AudioExport.download(format === 'png' ? await AudioExport.png(svg, 1) : svg, `${name}-waveform.${format}`, 'image/svg+xml');
      }
      AudioExport.download(new Blob([Wav.encode(result.channels, result.sampleRate, format)], { type: 'audio/wav' }), `${name}.wav`);
    } catch (error) { setError(error.message); }
  }
  $('download').onclick = download;
  $('share').onclick = async () => { refreshShare({ address: true }); $('share-url').select(); try { await navigator.clipboard.writeText($('share-url').value); $('share-status').textContent = 'Link copied.'; } catch (_) { $('share-status').textContent = 'Select and copy the link above.'; } };
  $('share-url').onclick = () => $('share-url').select();
  $('shorten').onclick = async () => {
    const ownRevision = revision; $('share-status').textContent = 'Shortening…'; refreshShare();
    const response = await shareClient.shorten(saved ? { long: currentLink(), fallback: currentLink() } : links());
    if (ownRevision !== revision || !response) return;
    $('share-url').value = response.url; $('share-status').textContent = response.error?.message || 'Short link ready to copy.';
  };
  let qrMarkup = '';
  function refreshQr() {
    if (!$('qr-dialog').open) return;
    const url = currentLink(), qr = encodeQr(url); qrMarkup = qr ? qrSvg(qr) : '';
    $('qr-code').innerHTML = qrMarkup; $('qr-message').textContent = qrNotes(url, qr); $('qr-url').textContent = url;
    $('qr-svg').disabled = $('qr-png').disabled = !qr;
  }
  $('qr-open').onclick = () => { $('qr-dialog').showModal(); refreshQr(); };
  $('qr-svg').onclick = () => AudioExport.download(qrMarkup, 'scene-qr.svg', 'image/svg+xml');
  $('qr-png').onclick = async () => { try { AudioExport.download(await AudioExport.png(qrMarkup, 1), 'scene-qr.png'); } catch (error) { $('qr-message').textContent = error.message; } };
  document.querySelectorAll('[data-close]').forEach(button => button.onclick = () => $(button.dataset.close).close());
  window.addEventListener('pagehide', persist);
  window.addEventListener('offline-before-reload', persist);
  async function loadUrl({ initial = false } = {}) {
    hashbin.cancelLoad();
    try {
      if (initial) {
        store.retireLegacyTokens().catch(() => { /* Retried on the next load. */ });
        let restored = null; try { const text = local?.getItem(STORAGE_KEY); if (text) restored = HashBinDocuments.parse(text); } catch (_) { /* Ignore invalid or unavailable storage. */ }
        apply(restored || { src: AudioExamples.defaultSource });
      }
      const loadRevision = revision;
      const parsed = ShareLinks.parse(location.href, LZString.decompressFromEncodedURIComponent);
      if (parsed?.kind === 'publish') {
        const published = await store.published(location.hash);
        // Edits made while the return was verified win over it.
        const current = loadRevision === revision;
        if (published.snapshot && current) apply(published.snapshot);
        if (published.cid && current) saved = { fingerprint: fingerprint(), link: HashBinDocuments.link(location.href, published.cid) };
        if (saved) history.replaceState(null, '', saved.link); else refreshShare({ address: true });
        $('hashbin-status').textContent = published.error || 'Saved to HashBin.';
      } else if (parsed?.kind === 'source') { if (acceptLink(parsed)) apply(parsed); }
      else if (parsed?.kind === 'example') {
        const sample = AudioExamples.catalog.find(item => item.id === parsed.id);
        if (!sample) throw new Error('Unknown example. Choose a sample from the gallery.');
        const doc = { src: sample.source, files: {} };
        if (acceptLink(doc)) apply(doc);
      } else if (parsed?.kind === 'cid') {
        linkLoad = true;
        try { await hashbin.load(parsed.cid); } finally { linkLoad = false; }
        return;
      }
      refreshShare();
    } catch (error) { if (initial && !editor.getValue()) apply({ src: AudioExamples.defaultSource }); setError(error.message); }
  }
  window.addEventListener('hashchange', () => loadUrl());
  await loadUrl({ initial: true });
})();
