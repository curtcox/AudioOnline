/* The gallery plays pre-rendered previews only; scenes run in the editor. Previews load when played. */
(() => {
  const gallery = document.getElementById('gallery'), search = document.getElementById('search'), tag = document.getElementById('tag');
  document.querySelector('form.filters').addEventListener('submit', event => event.preventDefault());
  for (const name of [...new Set(AudioExamples.catalog.flatMap(sample => sample.tags))].sort()) {
    const option = document.createElement('option'); option.value = option.textContent = name; tag.append(option);
  }
  const KINDS = { python: 'PYTHON SCENE', abc: 'ABC TUNE', zzfx: 'ZZFX SOUNDS', sfxr: 'SFXR SOUNDS', pattern: 'PATTERN' };
  const players = [];
  // Playing one preview pauses the others.
  const solo = current => { for (const audio of players) if (audio !== current) audio.pause(); };
  const cards = AudioExamples.catalog.map(sample => {
    const card = document.createElement('article'); card.className = 'card'; card.id = sample.id;
    const cover = document.createElement('img'); cover.src = `gallery/previews/${sample.id}.png`; cover.alt = `Waveform and spectrogram of ${sample.title}`;
    cover.loading = 'lazy'; cover.width = 480; cover.height = 270;
    const body = document.createElement('div'); body.className = 'card-body';
    const kind = document.createElement('p'); kind.className = 'kind'; kind.textContent = KINDS[sample.type || 'python'];
    const title = document.createElement('h2'); title.textContent = sample.title;
    const description = document.createElement('p'); description.textContent = sample.description;
    const tags = document.createElement('div'); tags.className = 'tags';
    for (const name of sample.tags) { const chip = document.createElement('span'); chip.textContent = name; tags.append(chip); }
    body.append(kind, title, description, tags);
    if (sample.neural) {
      const note = document.createElement('p'); note.className = 'neural';
      note.textContent = `Needs the ${sample.neural} neural voice, which downloads after you confirm in the editor and is not part of “Available offline”. The cover uses the bundled voice.`;
      body.append(note);
    } else {
      const audio = document.createElement('audio'); audio.controls = true; audio.preload = 'none'; audio.src = `gallery/previews/${sample.id}.m4a`;
      audio.setAttribute('aria-label', `Preview of ${sample.title}`);
      audio.addEventListener('play', () => solo(audio));
      players.push(audio); body.append(audio);
    }
    const load = document.createElement('a'); load.className = 'load'; load.href = './?example=' + encodeURIComponent(sample.id);
    load.textContent = 'Load in editor →'; load.setAttribute('aria-label', `Load ${sample.title} in editor`);
    body.append(load); card.append(cover, body);
    return { sample, card };
  });
  function refresh() {
    const query = search.value.toLowerCase().trim();
    const shown = cards.filter(({ sample }) => (!tag.value || sample.tags.includes(tag.value)) &&
      [sample.title, sample.description, ...sample.tags].join(' ').toLowerCase().includes(query));
    for (const { card } of cards) if (!shown.some(item => item.card === card)) card.querySelector('audio')?.pause();
    gallery.replaceChildren(...shown.map(item => item.card));
    document.getElementById('count').textContent = shown.length + ' samples'; document.getElementById('empty').hidden = !!shown.length;
  }
  search.oninput = tag.onchange = refresh; refresh();
})();
