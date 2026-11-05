import {LocalDrafts,RenderScheduler,HashBinPanel,createShell,mountMobileTabs,createShareDialog,createQrDialog} from '../vendor/fragment-kit-v0.3.3/src/index.js';
import {config,type,urlState,HashBinDocuments,HashBinStore,LZString,fromDocument} from './fragment-config.mjs';
Object.assign(globalThis,{HashBinDocuments,LZString});
/* Browser glue. The renderer, documents and exports stay independent of the UI. */
(async () => {
  'use strict';
  const $ = id => document.getElementById(id);
  const oldHeader=document.querySelector('header'),brand=oldHeader.querySelector('.brand');oldHeader.remove();
  const shell=createShell({config});shell.header.querySelector('.fk-brand').replaceChildren(...brand.childNodes);shell.header.querySelector('.fk-brand').href=new URL('./',location.href).href;shell.toolbar.remove();shell.status.remove();
  shell.header.querySelector('.fk-more').id='more-toggle';$('more').remove();shell.drawer.body.prepend($('extra-tools'));
  for(const id of ['hashbin-save','hashbin-load','hashbin-cid','hashbin-status','hashbin-dialog','qr-dialog','share-url','shorten','share-status'])$(id).remove();
  $('extra-tools').querySelector('a').remove();document.querySelector('.toolbar').append($('share'),$('qr-open'));
  let navigationRevision=0,qrSave=false,runSuppressed=false;
  const STORAGE_KEY = 'audioonline:document';
  const editor = ace.edit('editor');
  globalThis.editor = editor;
  editor.setTheme('ace/theme/chrome'); editor.session.setMode('ace/mode/python');
  editor.setOptions({ showPrintMargin: false, tabSize: 4, useSoftTabs: true, useWorker: false });
  let settings = AudioCore.options(), files = {}, revision = 0, applying = false, result = null, saved = null;
  const FILES = { python: ['scene.py', 'Python'], abc: ['tune.abc', 'ABC notation'], zzfx: ['sounds.zzfx', 'ZzFX'], sfxr: ['sounds.sfxr', 'sfxr'], pattern: ['beat.pattern', 'pattern mini-notation'] };
  const currentType = () => settings.renderer === 'auto' ? AudioDetector.detect(editor.getValue()).type : settings.renderer;
  const snapshot = () => ({ src: editor.getValue(), type: currentType(), settings: { ...settings }, files: { ...files } });
  const fingerprint = () => JSON.stringify(snapshot());
  const links = () => urlState.build(snapshot(),{run:!runSuppressed});
  const currentLink = () => saved?.fingerprint === fingerprint() ? saved.link : links().fallback;
  const safeStorage = name => { try { return window[name]; } catch (_) { return undefined; } };
  const local = safeStorage('localStorage');
  const drafts = new LocalDrafts({ storage: local, key: STORAGE_KEY, serialize: value => HashBinDocuments.serialize(value), parse: value => HashBinDocuments.parse(value) });
  const setError = message => { $('error').textContent = message; $('error').hidden = !message; $('preview').classList.toggle('stale', !!message); };
  const voiceAssets = new AudioVoiceAssets();
  // Verified CID samples stay in memory for this page, so re-renders and new workers do not download them again.
  const cidSamples = new Map();
  const loadSample = (cid, options) => {
    if (!cidSamples.has(cid)) cidSamples.set(cid, store.sample(cid, options).catch(error => { cidSamples.delete(cid); throw error; }));
    return cidSamples.get(cid);
  };
  const client = new AudioClient({ workerFactory: AudioSandbox.factory({ voiceAssets }),
    onVoice: (name, options) => voiceAssets.ensure(name, options), onSample: loadSample, onStatus: text => { $('status').textContent = text; },
    onSlow: () => { $('status').textContent = 'Still rendering…'; $('cancel').hidden = false; } });
  const scheduler = new RenderScheduler({ detect: showType, render, renderDelay: 600, detectionDelay: 250 });
  let shownType = null;
  /** Reflects the detected or chosen type in the selector, editor mode and file name. */
  function showType() {
    const type = currentType(), detected = AudioDetector.detect(editor.getValue()).type;
    $('renderer').options[0].textContent = `Auto (${AudioDetector.LABELS[detected]})`;
    $('renderer').value = settings.renderer;
    if (type === shownType) return;
    shownType = type;
    editor.session.setMode(type === 'python' ? 'ace/mode/python' : 'ace/mode/text');
    $('filename').textContent = FILES[type][0]; $('filetype').textContent = '/ ' + FILES[type][1];
  }
  const player = new AudioPlayer({ canvas: $('waveform'), spectrogram: $('spectrogram'), lanes: $('lanes'), button: $('play'), loopButton: $('loop'), time: $('time'), onMix: remix,
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
      showType();
      const next = await client.run(editor.getValue(), settings, currentType(), files);
      if (ownRevision !== revision) return;
      $('cancel').hidden = true;
      annotate(null); setError(''); result = next;
      showScenes(next.scenes, next.scene); showOutput(next.output);
      $('empty').hidden = true; player.load(next);
      if (player.remixed) remix();
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
  /** Mute/solo re-mixes the last render's stems in the sandbox (master effects included); the full mix is restored when nothing is muted or soloed. */
  let mixRevision = 0;
  async function remix() {
    if (!result) return;
    const own = ++mixRevision;
    if (!player.remixed) { player.replaceAudio(result.channels); $('note').hidden = !!result.length; return; }
    try {
      const mixed = await client.mix(player.enabled());
      if (own !== mixRevision || mixed.length !== result.length) return;
      player.replaceAudio(mixed.channels);
      $('note').textContent = 'Preview mix: muted or soloed tracks are left out. Downloads use the full mix.'; $('note').hidden = false;
    } catch (_) { /* A render is in progress; the mix is applied when it finishes. */ }
  }
  function persist(edit = false) { drafts.attempt(snapshot(), edit === true); }
  function changed() {
    if (applying) return;
    revision++; client.cancel(); navigationRevision++;urlState.cancel();hashbin.cancelLoad(); saved = null; persist(true);
    setError(''); $('cancel').hidden = true; $('status').textContent = 'Waiting for edits…';
    urlState.write(snapshot(),{run:!runSuppressed});
    scheduler.schedule({ detect: true });
  }
  function syncOptions() { $('sample-rate').value = settings.sampleRate; $('channels').value = settings.channels; $('renderer').value = settings.renderer; }
  function apply(doc, { run = true } = {}) {
    urlState.cancel();drafts.opened();doc=fromDocument(doc);
    const nextFiles = doc.files || {}; AudioFiles.validate(nextFiles, doc.src);
    player.stop();player.result=null;result=null;$('play').disabled=true;$('loop').disabled=true;$('empty').hidden=false;showOutput('');
    applying = true;
    // A saved type the detector would not choose is kept as an explicit renderer choice.
    const options = AudioCore.options(doc.settings);
    if (options.renderer === 'auto' && doc.type && AudioCore.TYPES.includes(doc.type) && AudioDetector.detect(doc.src).type !== doc.type) options.renderer = doc.type;
    try { files = { ...nextFiles }; settings = options; editor.setValue(doc.src, -1); editor.session.setUndoManager(new ace.UndoManager()); syncOptions(); }
    finally { applying = false; }
    listFiles();
    revision++; scheduler.cancel(); client.cancel(); saved = null; showType(); if (run) render();
  }
  const store=new HashBinStore({legacyStorage:local});
  const hashbin=new HashBinPanel({store,urlState,container:$('extra-tools'),getSnapshot:()=>type.normalize(snapshot()),getFingerprint:fingerprint,
    onLoad(doc,cid){navigationRevision++;apply(doc,{run:!runSuppressed});const link=cid?urlState.link(location.href,cid):links().href;saved=cid?{fingerprint:fingerprint(),link}:null;history.replaceState(null,'',link);},
    onSaved(cid,value,link){urlState.cancel();saved={fingerprint:value,link};history.replaceState(null,'',link);if(qrSave){qrSave=false;hashbin.dialog.close();qr.open(link);}}
  });
  hashbin.dialog.addEventListener('close',()=>{qrSave=false;});
  const openSave=()=>hashbin.openSave();
  const share=createShareDialog({urlState,getSnapshot:()=>type.normalize(snapshot()),onSave:openSave});
  const qr=createQrDialog({config,urlState,onLoad:async outcome=>{
    if(outcome.kind==='cid'){await hashbin.load(outcome.cid);return;}
    const url=new URL(outcome.href);history.pushState(null,'',location.pathname+url.search+url.hash);await loadUrl();
  },onSave:()=>{qrSave=true;qr.dialog.close();return openSave();}});
  $('share').onclick=()=>{shell.drawer.dialog.close();share.open();};
  $('qr-open').onclick=()=>{shell.drawer.dialog.close();qr.open(currentLink());};
  editor.session.on('change', changed);
  $('render').onclick = () => { scheduler.cancel(); revision++; client.cancel(); render(); };
  $('cancel').onclick = () => { revision++; scheduler.cancel(); client.cancel(); $('cancel').hidden = true; $('status').textContent = 'Cancelled'; };
  $('sample-rate').onchange = $('channels').onchange = () => { settings = AudioCore.options({ ...settings, sampleRate: $('sample-rate').value, channels: $('channels').value }); changed(); };
  $('renderer').onchange = () => { settings = AudioCore.options({ ...settings, renderer: $('renderer').value }); showType(); changed(); };
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
  document.querySelector('.mobile-tabs').remove();
  const tabs=mountMobileTabs({container:document.querySelector('.phone-bar'),panels:[{label:'Preview',panel:$('preview-pane')},{label:'Code',panel:$('editor-pane')}],onChange:index=>{document.body.dataset.tab=index?'code':'preview';resize();}});
  for(const[index,button]of [...document.querySelectorAll('.fk-tabs button')].entries()){button.id=index?'tab-code':'tab-preview';$(index?'editor-pane':'preview-pane').setAttribute('aria-labelledby',button.id);}
  async function download() {
    try {
      const format = $('export-format').value, name = (result?.scene || 'scene').toLowerCase();
      if (format === 'source') return AudioExport.download(editor.getValue(), FILES[currentType()][0], 'text/plain;charset=utf-8');
      if (!result) throw new Error('Render the scene first.');
      if (format === 'svg' || format === 'png') {
        const svg = AudioWaveform.svg(result.channels);
        return AudioExport.download(format === 'png' ? await AudioExport.png(svg, 1) : svg, `${name}-waveform.${format}`, 'image/svg+xml');
      }
      if (AudioEncode.FORMATS[format]) {
        $('status').textContent = `Encoding ${AudioEncode.FORMATS[format].label}…`;
        const blob = await AudioEncode.encode(format, result.channels, result.sampleRate);
        $('status').textContent = 'Encoded.';
        return AudioExport.download(blob, `${name}.${AudioEncode.FORMATS[format].extension}`);
      }
      if (format === 'stems') {
        const { stems, sampleRate } = await client.stems(), used = new Set();
        const files = stems.map(stem => {
          let file = stem.name.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^\.+/, '') || 'track';
          while (used.has(file)) file += '_';
          used.add(file);
          return { name: `${file}.wav`, bytes: Wav.encode(stem.channels, sampleRate, 'pcm24') };
        });
        return AudioExport.download(new Blob([Zip.build(files)], { type: 'application/zip' }), `${name}-stems.zip`);
      }
      AudioExport.download(new Blob([Wav.encode(result.channels, result.sampleRate, format)], { type: 'audio/wav' }), `${name}.wav`);
    } catch (error) { setError(error.message); }
  }
  $('download').onclick = download;
  // Compressed formats appear only where this browser's WebCodecs can encode them (WAV always works).
  AudioEncode.supported().then(names => {
    const after = $('export-format').querySelector('option[value="float32"]');
    for (const name of names.reverse()) after.after(Object.assign(document.createElement('option'), { value: name, textContent: AudioEncode.FORMATS[name].label }));
  });
  // Audio files: WAV only, checked with the same decoder the sandbox uses before they join the document.
  function listFiles() {
    $('file-count').textContent = Object.keys(files).length;
    $('file-list').replaceChildren(...Object.entries(files).map(([name, data]) => {
      const row = document.createElement('div'); row.className = 'file-row';
      const title = document.createElement('span'); title.textContent = `Sample("${name}")`;
      const size = document.createElement('small'), bytes = AudioFiles.decodedSize(data);
      try { const wav = Wav.decode(Uint8Array.from(atob(data), c => c.charCodeAt(0))); size.textContent = `${(wav.channels[0].length / wav.sampleRate).toFixed(2)} s · ${wav.channels.length === 1 ? 'mono' : 'stereo'} · ${Math.ceil(bytes / 1024)} KiB`; }
      catch (_) { size.textContent = `${Math.ceil(bytes / 1024)} KiB`; }
      const remove = document.createElement('button'); remove.textContent = 'Remove'; remove.setAttribute('aria-label', 'Remove ' + name);
      remove.onclick = () => { const next = { ...files }; delete next[name]; files = next; changed(); listFiles(); };
      row.append(title, size, remove); return row;
    }));
  }
  async function upload(list) {
    // A failed batch does not partly replace existing files.
    try {
      const next = { ...files };
      for (const file of list) {
        if (!AudioFiles.validName(file.name)) throw new Error(`${file.name}: rename it to 1–64 letters, digits, dots, underscores or hyphens, ending in .wav.`);
        if (file.size > AudioFiles.MAX_FILE) throw new Error(`${file.name} exceeds the 2 MiB file limit.`);
        const bytes = new Uint8Array(await file.arrayBuffer());
        try { Wav.decode(bytes); } catch (error) { throw new Error(`${file.name}: ${error.message}`); }
        next[file.name] = AudioFiles.encode64(bytes);
      }
      AudioFiles.validate(next, editor.getValue()); files = next; changed(); listFiles(); $('files-message').textContent = '';
    } catch (error) { $('files-message').textContent = error.message; if (!$('files-dialog').open) $('files-dialog').showModal(); }
  }
  $('files-open').onclick = () => { listFiles(); $('files-message').textContent = ''; $('files-dialog').showModal(); };
  $('file-add').onclick = () => $('file-upload').click();
  $('file-upload').onchange = async event => { await upload(event.target.files); event.target.value = ''; };
  $('editor-pane').addEventListener('dragover', event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); }, true);
  $('editor-pane').addEventListener('drop', event => { if (event.dataTransfer.files.length) { event.preventDefault(); event.stopPropagation(); upload(event.dataTransfer.files); } }, true);
  document.querySelectorAll('[data-close]').forEach(button => button.onclick = () => $(button.dataset.close).close());
  drafts.mount($('extra-tools'), doc => { navigationRevision++;hashbin.cancelLoad(); apply(doc, { run: false }); history.replaceState(null,'',links().href); $('status').textContent = 'Saved work restored — press Render.'; });
  window.addEventListener('pagehide', persist);
  window.addEventListener('offline-before-reload',()=>{persist();urlState.cancel();history.replaceState(null,'',currentLink());});
  async function loadUrl({initial=false}={}) {
    const own=++navigationRevision;urlState.cancel();hashbin.cancelLoad();scheduler.cancel();client.cancel();revision++;saved=null;
    try{
      if(initial)store.retireLegacyTokens().catch(()=>{});
      const parsed=urlState.parse(location.href);runSuppressed=parsed.run===false;setError('');
      if(parsed.kind==='publish'){
        const published=await store.published(location.hash);if(own!==navigationRevision)return;
        if(published.snapshot)apply(published.snapshot,{run:!runSuppressed});
        if(published.cid)saved={fingerprint:fingerprint(),link:urlState.link(location.href,published.cid)};
        history.replaceState(null,'',saved?.link??links().href);hashbin.status.textContent=published.error||'Saved to HashBin.';
      }else if(parsed.kind==='source')apply(parsed.doc,{run:!runSuppressed});
      else if(parsed.kind==='cid'){
        await hashbin.load(parsed.cid);
        if(hashbin.status.textContent!=='Loaded from HashBin.')setError(hashbin.status.textContent);
      }else{
        const sample=parsed.kind==='example'?AudioExamples.catalog.find(item=>item.id===parsed.id):null;
        if(parsed.kind==='example'&&!sample)throw Error('Unknown example. Choose a sample from the gallery.');
        apply(sample?{src:sample.source,type:sample.type||'python',files:sample.files||{}}:{src:AudioExamples.defaultSource},{run:!runSuppressed});
        if(sample)history.replaceState(null,'',links().href);
      }
      if(runSuppressed)$('status').textContent='Ready — press Render.';
    }catch(error){if(own===navigationRevision){setError(error.message);$('status').textContent=error.message;}}
    finally{document.body.dataset.ready='true';}
  }
  let lastNavigation=location.href;const navigate=event=>{if(event.type==='hashchange'&&event.newURL!==location.href)return;if(location.href===lastNavigation)return;lastNavigation=location.href;void loadUrl();};
  window.addEventListener('hashchange',navigate);window.addEventListener('popstate',navigate);
  globalThis.AudioOnline={editor,client,snapshot,render,selectTab:tab=>tabs.select(tab==='code'?1:0)};
  await loadUrl({initial:true});
})();
