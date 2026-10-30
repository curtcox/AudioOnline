/* Preview: waveform, spectrogram, playhead, loop region, play/pause/seek and track lanes with mute/solo.
   Playback uses Web Audio on the editor origin; it never affects the rendered bytes. */
(() => {
const AudioWaveform = {
  /** Min/max per column for each channel. */
  peaks(channels, columns) {
    const length = channels[0]?.length || 0;
    return channels.map(channel => {
      const out = new Float32Array(columns * 2);
      for (let x = 0; x < columns; x++) {
        const from = Math.floor(x * length / columns), to = Math.max(from + 1, Math.floor((x + 1) * length / columns));
        let min = 0, max = 0;
        for (let i = from; i < to && i < length; i++) { const v = channel[i]; if (v < min) min = v; if (v > max) max = v; }
        out[2 * x] = min; out[2 * x + 1] = max;
      }
      return out;
    });
  },
  svg(channels, { width = 1200, height = 240, color = '#5b3fd1' } = {}) {
    const peaks = this.peaks(channels, width), lane = height / peaks.length, parts = [];
    peaks.forEach((p, c) => {
      const mid = lane * c + lane / 2, scale = lane / 2 - 2;
      let d = '';
      for (let x = 0; x < width; x++) d += `M${x + 0.5} ${(mid - p[2 * x + 1] * scale).toFixed(2)}V${(mid - p[2 * x] * scale + 0.5).toFixed(2)}`;
      parts.push(`<path d="${d}" stroke="${color}" stroke-width="1" fill="none"/>`);
    });
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#fff"/>${parts.join('')}</svg>`;
  }
};

class AudioPlayer {
  constructor({ canvas, spectrogram, lanes, button, loopButton, time, onClip = () => {}, onMix = () => {} }) {
    Object.assign(this, { canvas, spectrogram, lanes, button, loopButton, time, onClip, onMix });
    this.result = null; this.offset = 0; this.playing = false; this.region = null; this.looping = false;
    this.muted = new Set(); this.solo = new Set();
    button.onclick = () => this.toggle();
    loopButton.onclick = () => this.setLooping(!this.looping);
    for (const surface of [canvas, spectrogram]) this.pointer(surface);
    canvas.addEventListener('keydown', event => {
      if (!this.result) return;
      if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); this.toggle(); }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); this.seek(this.position + (event.key === 'ArrowLeft' ? -1 : 1)); }
    });
    new ResizeObserver(() => this.draw()).observe(canvas);
    this.update();
  }
  /** A click seeks; a drag selects the loop region. */
  pointer(surface) {
    let start = null;
    const seconds = event => { const rect = surface.getBoundingClientRect(); return Math.max(0, Math.min(this.duration, (event.clientX - rect.left) / rect.width * this.duration)); };
    surface.addEventListener('pointerdown', event => { if (!this.result) return; start = { x: event.clientX, t: seconds(event) }; surface.setPointerCapture(event.pointerId); });
    surface.addEventListener('pointermove', event => {
      if (!start || Math.abs(event.clientX - start.x) < 5) return;
      const t = seconds(event); this.region = { start: Math.min(start.t, t), end: Math.max(start.t, t) }; this.draw(); this.update();
    });
    surface.addEventListener('pointerup', event => {
      if (!start) return;
      const dragged = Math.abs(event.clientX - start.x) >= 5; start = null;
      if (!dragged) { this.seek(seconds(event)); return; }
      if (this.region && this.region.end - this.region.start < 0.02) this.region = null;
      if (this.region) { this.setLooping(true); this.seek(this.region.start); } else this.setLooping(false);
    });
  }
  get duration() { return this.result ? this.result.length / this.result.sampleRate : 0; }
  get position() {
    if (!this.playing) return this.offset;
    const elapsed = this.offset + this.context.currentTime - this.startedAt;
    if (this.looping && this.region && elapsed >= this.region.end) return this.region.start + (elapsed - this.region.start) % (this.region.end - this.region.start);
    return Math.min(this.duration, elapsed);
  }
  load(result) {
    const keep = this.result && this.position < result.length / result.sampleRate ? this.position : 0;
    this.stop(); this.result = result; this.buffer = null; this.offset = keep; this.cachedPeaks = null; this.cachedImage = null;
    if (this.region && this.region.end > this.duration) { this.region = null; this.looping = false; }
    for (const set of [this.muted, this.solo]) for (const name of [...set]) if (!result.tracks.includes(name)) set.delete(name);
    this.lanesFor(result); this.draw(); this.update();
  }
  /** Swaps in a re-mix (mute/solo) without moving the playhead or rebuilding the lanes. */
  replaceAudio(channels) {
    const wasPlaying = this.playing, at = this.position;
    this.stop(); this.result = { ...this.result, channels }; this.buffer = null; this.cachedPeaks = null; this.cachedImage = null; this.offset = at;
    if (wasPlaying) this.play(); else { this.draw(); this.update(); }
  }
  enabled() { return this.result ? this.result.tracks.filter(name => this.solo.size ? this.solo.has(name) : !this.muted.has(name)) : []; }
  get remixed() { return this.muted.size > 0 || this.solo.size > 0; }
  toggle() { if (this.playing) this.pause(); else this.play(); }
  setLooping(on) {
    this.looping = !!(on && this.region);
    if (this.playing) { const at = this.position; this.stop(); this.offset = at; this.play(); } else { this.draw(); this.update(); }
  }
  /** Must run from a user gesture (iOS starts audio only then). */
  play() {
    if (!this.result || !this.result.length) return;
    this.context ||= new (globalThis.AudioContext || globalThis.webkitAudioContext)();
    this.context.resume?.();
    if (!this.buffer) {
      const { channels, sampleRate, length } = this.result;
      this.buffer = this.context.createBuffer(channels.length, length, sampleRate);
      channels.forEach((channel, c) => this.buffer.getChannelData(c).set(channel));
    }
    const loop = this.looping && this.region;
    if (loop && (this.offset < this.region.start || this.offset >= this.region.end)) this.offset = this.region.start;
    if (!loop && this.offset >= this.duration) this.offset = 0;
    const source = this.source = this.context.createBufferSource();
    source.buffer = this.buffer; source.connect(this.context.destination);
    if (loop) { source.loop = true; source.loopStart = this.region.start; source.loopEnd = this.region.end; }
    source.onended = () => { if (this.source !== source) return; this.playing = false; this.offset = 0; this.source = null; this.update(); this.draw(); };
    this.startedAt = this.context.currentTime; source.start(0, this.offset); this.playing = true;
    this.update(); this.tick();
  }
  pause() { if (!this.playing) return; this.offset = this.position; this.stop(); this.update(); this.draw(); }
  stop() {
    if (this.source) { const source = this.source; this.source = null; try { source.stop(); } catch (_) { /* Already ended. */ } }
    this.playing = false;
  }
  seek(seconds) {
    const wasPlaying = this.playing; this.stop();
    this.offset = Math.max(0, Math.min(this.duration, seconds));
    if (wasPlaying) this.play(); else { this.update(); this.draw(); }
  }
  tick() { if (!this.playing) return; this.draw(); this.update(); requestAnimationFrame(() => this.tick()); }
  update() {
    const format = s => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
    this.button.textContent = this.playing ? 'Pause' : 'Play';
    this.button.disabled = !this.result?.length;
    this.loopButton.disabled = !this.region; this.loopButton.setAttribute('aria-pressed', String(this.looping));
    this.time.textContent = this.result ? `${format(this.position)} / ${format(this.duration)}` : '';
  }
  size(canvas) {
    const ratio = globalThis.devicePixelRatio || 1, rect = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width * ratio)), height = Math.max(1, Math.round(rect.height * ratio));
    const changed = canvas.width !== width || canvas.height !== height;
    if (changed) { canvas.width = width; canvas.height = height; }
    return { width, height, ratio, changed };
  }
  overlay(g, width, height, ratio) {
    if (this.region && this.duration) {
      const a = this.region.start / this.duration * width, b = this.region.end / this.duration * width;
      g.fillStyle = this.looping ? 'rgba(214, 51, 108, 0.16)' : 'rgba(91, 63, 209, 0.12)'; g.fillRect(a, 0, b - a, height);
    }
    const played = this.duration ? this.position / this.duration * width : 0;
    g.fillStyle = '#d6336c'; g.fillRect(Math.min(width - 2 * ratio, played), 0, 2 * ratio, height);
  }
  draw() {
    const { width, height, ratio, changed } = this.size(this.canvas), g = this.canvas.getContext('2d');
    if (changed) this.cachedPeaks = null;
    g.fillStyle = '#fbfaff'; g.fillRect(0, 0, width, height);
    if (this.result) {
      if (!this.cachedPeaks) this.cachedPeaks = AudioWaveform.peaks(this.result.channels, width);
      const lane = height / this.cachedPeaks.length, played = this.duration ? this.position / this.duration * width : 0;
      this.cachedPeaks.forEach((p, c) => {
        const mid = lane * c + lane / 2, scale = lane / 2 - 2 * ratio;
        g.strokeStyle = '#e4defa'; g.beginPath(); g.moveTo(0, mid); g.lineTo(width, mid); g.stroke();
        for (let x = 0; x < width; x++) {
          g.fillStyle = x < played ? '#3b23a3' : '#7d66e0';
          const top = mid - p[2 * x + 1] * scale, bottom = mid - p[2 * x] * scale;
          g.fillRect(x, top, 1, Math.max(1, bottom - top));
        }
      });
      this.overlay(g, width, height, ratio);
    }
    this.drawSpectrogram();
  }
  drawSpectrogram() {
    const canvas = this.spectrogram, { width, height, ratio, changed } = this.size(canvas), g = canvas.getContext('2d');
    if (changed) this.cachedImage = null;
    if (!this.result || !this.result.length) { g.fillStyle = '#100a28'; g.fillRect(0, 0, width, height); return; }
    if (!this.cachedImage) {
      // Columns at device pixels are costly on wide screens; render at most 1200 columns and scale.
      const columns = Math.min(width, 1200), rows = Math.min(height, 256), { channels, sampleRate } = this.result;
      const mono = channels.length === 1 ? channels[0] : channels[0].map((v, i) => (v + channels[1][i]) / 2);
      const image = new ImageData(Spectrogram.image(mono, sampleRate, columns, rows), columns, rows);
      this.cachedImage = document.createElement('canvas'); this.cachedImage.width = columns; this.cachedImage.height = rows;
      this.cachedImage.getContext('2d').putImageData(image, 0, 0);
    }
    g.imageSmoothingEnabled = true; g.drawImage(this.cachedImage, 0, 0, width, height);
    this.overlay(g, width, height, ratio);
  }
  lanesFor(result) {
    this.lanes.replaceChildren();
    const duration = this.duration || 1;
    for (const track of result.tracks) {
      const row = document.createElement('div'); row.className = 'lane';
      const name = document.createElement('span'); name.className = 'lane-name'; name.textContent = track; name.title = track;
      const toggle = (label, set, title) => {
        const button = document.createElement('button'); button.className = 'lane-toggle'; button.textContent = label;
        button.setAttribute('aria-label', `${title} ${track}`); button.setAttribute('aria-pressed', String(set.has(track)));
        button.onclick = () => { if (set.has(track)) set.delete(track); else set.add(track); button.setAttribute('aria-pressed', String(set.has(track))); this.onMix(this.enabled()); };
        return button;
      };
      const area = document.createElement('div'); area.className = 'lane-area';
      for (const clip of result.clips.filter(c => c.track === track)) {
        const block = document.createElement('button'); block.className = 'clip';
        block.style.left = `${clip.start / duration * 100}%`; block.style.width = `${Math.max(0.4, (clip.end - clip.start) / duration * 100)}%`;
        block.title = `${clip.label} · ${clip.start.toFixed(2)}–${clip.end.toFixed(2)} s${clip.line ? ` · line ${clip.line}` : ''}`;
        block.setAttribute('aria-label', block.title);
        block.onclick = () => { this.seek(clip.start); if (clip.line) this.onClip(clip.line); };
        area.append(block);
      }
      row.append(name, toggle('M', this.muted, 'Mute'), toggle('S', this.solo, 'Solo'), area); this.lanes.append(row);
    }
  }
}
if (typeof module !== 'undefined') module.exports = { AudioWaveform, AudioPlayer };
else Object.assign(globalThis, { AudioWaveform, AudioPlayer });
})();
