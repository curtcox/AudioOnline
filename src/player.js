/* Preview: waveform, playhead, play/pause/seek and track lanes for the last good render.
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
  constructor({ canvas, lanes, button, time, onClip = () => {} }) {
    Object.assign(this, { canvas, lanes, button, time, onClip });
    this.result = null; this.offset = 0; this.playing = false;
    button.onclick = () => this.toggle();
    canvas.addEventListener('pointerdown', event => {
      if (!this.result) return;
      const rect = canvas.getBoundingClientRect();
      this.seek((event.clientX - rect.left) / rect.width * this.duration);
    });
    canvas.addEventListener('keydown', event => {
      if (!this.result) return;
      if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); this.toggle(); }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); this.seek(this.position + (event.key === 'ArrowLeft' ? -1 : 1)); }
    });
    new ResizeObserver(() => this.draw()).observe(canvas);
    this.update();
  }
  get duration() { return this.result ? this.result.length / this.result.sampleRate : 0; }
  get position() { return this.playing ? Math.min(this.duration, this.offset + this.context.currentTime - this.startedAt) : this.offset; }
  load(result) {
    const keep = this.result && this.position < result.length / result.sampleRate ? this.position : 0;
    this.stop(); this.result = result; this.buffer = null; this.offset = keep; this.cachedPeaks = null;
    this.lanesFor(result); this.draw(); this.update();
  }
  toggle() { if (this.playing) this.pause(); else this.play(); }
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
    if (this.offset >= this.duration) this.offset = 0;
    const source = this.source = this.context.createBufferSource();
    source.buffer = this.buffer; source.connect(this.context.destination);
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
    this.time.textContent = this.result ? `${format(this.position)} / ${format(this.duration)}` : '';
  }
  draw() {
    const canvas = this.canvas, ratio = globalThis.devicePixelRatio || 1, rect = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width * ratio)), height = Math.max(1, Math.round(rect.height * ratio));
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; this.cachedPeaks = null; }
    const g = canvas.getContext('2d');
    g.fillStyle = '#fbfaff'; g.fillRect(0, 0, width, height);
    if (!this.result) return;
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
    g.fillStyle = '#d6336c'; g.fillRect(Math.min(width - 2 * ratio, played), 0, 2 * ratio, height);
  }
  lanesFor(result) {
    this.lanes.replaceChildren();
    const duration = this.duration || 1;
    for (const track of result.tracks) {
      const row = document.createElement('div'); row.className = 'lane';
      const name = document.createElement('span'); name.className = 'lane-name'; name.textContent = track;
      const area = document.createElement('div'); area.className = 'lane-area';
      for (const clip of result.clips.filter(c => c.track === track)) {
        const block = document.createElement('button'); block.className = 'clip';
        block.style.left = `${clip.start / duration * 100}%`; block.style.width = `${Math.max(0.4, (clip.end - clip.start) / duration * 100)}%`;
        block.title = `${clip.label} · ${clip.start.toFixed(2)}–${clip.end.toFixed(2)} s${clip.line ? ` · line ${clip.line}` : ''}`;
        block.setAttribute('aria-label', block.title);
        block.onclick = () => { this.seek(clip.start); if (clip.line) this.onClip(clip.line); };
        area.append(block);
      }
      row.append(name, area); this.lanes.append(row);
    }
  }
}
if (typeof module !== 'undefined') module.exports = { AudioWaveform, AudioPlayer };
else Object.assign(globalThis, { AudioWaveform, AudioPlayer });
})();
