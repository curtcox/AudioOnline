/* Original Kitten/Kokoro ONNX loader. All network reads arrive through the editor's verified proxy.
   Inference is asynchronous; buffer()/measure() stay synchronous after prepare() for audio.py. */
(() => {
const pins = typeof module !== 'undefined' ? require('./neural-manifest.js') : globalThis.AudioNeuralManifest;
const { G2P, normalize } = typeof module !== 'undefined' ? require('./g2p.js') : globalThis.AudioG2P;
const MISSING = 'NEURAL_UTTERANCE_NOT_READY';
const keyFor = node => JSON.stringify([node.voice, node.text, node.speed ?? 1, node.pitch ?? 1]);
const decode = bytes => new TextDecoder().decode(bytes);
const join = parts => { const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0)); let at = 0; for (const p of parts) { out.set(p, at); at += p.length; } return out; };
// Small protobuf wire reader/writer. Unknown fields and tensor bytes are retained verbatim.
function fields(bytes) {
  let at = 0;
  const varint = () => {
    let n = 0, scale = 1;
    for (let i = 0; i < 10 && at < bytes.length; i++) { const b = bytes[at++]; n += (b & 127) * scale; if (b < 128) return n; scale *= 128; }
    throw new Error('Invalid ONNX varint.');
  };
  const out = [];
  while (at < bytes.length) {
    const start = at, tag = varint(), wire = tag & 7, number = Math.floor(tag / 8);
    let value;
    if (wire === 0) { const p = at; varint(); value = bytes.subarray(p, at); }
    else {
      const length = wire === 2 ? varint() : wire === 1 ? 8 : wire === 5 ? 4 : -1;
      if (length < 0 || at + length > bytes.length) throw new Error('Invalid ONNX field.');
      value = bytes.subarray(at, at + length); at += length;
    }
    out.push({ number, wire, value, raw: bytes.subarray(start, at) });
  }
  return out;
}
function varint(value) { const out = []; do { const byte = value % 128; value = Math.floor(value / 128); out.push(byte | (value ? 128 : 0)); } while (value); return Uint8Array.from(out); }
const field = (number, wire, value) => join([varint(number * 8 + wire), ...(wire === 2 ? [varint(value.length)] : []), value]);
/** Give both random operators explicit seeds. Fresh sessions below reset their RNG state per utterance. */
function seedKitten(bytes) {
  let count = 0;
  const patched = fields(bytes).map(model => {
    if (model.number !== 7) return model.raw; // ModelProto.graph
    return field(7, 2, join(fields(model.value).map(graph => {
      if (graph.number !== 1) return graph.raw; // GraphProto.node
      const node = fields(graph.value), op = decode(node.find(f => f.number === 4)?.value || new Uint8Array());
      if (!['RandomNormalLike', 'RandomUniformLike'].includes(op)) return graph.raw;
      const seed = new Uint8Array(4); new DataView(seed.buffer).setFloat32(0, ++count, true);
      const attribute = join([field(1, 2, new TextEncoder().encode('seed')), field(2, 5, seed), field(20, 0, varint(1))]);
      const kept = node.filter(f => f.number !== 5 || decode(fields(f.value).find(a => a.number === 1)?.value || new Uint8Array()) !== 'seed');
      return field(1, 2, join([...kept.map(f => f.raw), field(5, 2, attribute)]));
    })));
  });
  if (count !== 2) throw new Error('The pinned Kitten model must have exactly two random operators.');
  return join(patched);
}
/** The pinned NPZ stores little-endian float32 NPY arrays without compression. No general ZIP loader. */
function kittenStyles(buffer) {
  const view = new DataView(buffer), bytes = new Uint8Array(buffer), out = new Map();
  let end = buffer.byteLength - 22;
  while (end >= Math.max(0, buffer.byteLength - 65557) && view.getUint32(end, true) !== 0x06054b50) end--;
  if (end < 0) throw new Error('Invalid voice NPZ.');
  const total = view.getUint16(end + 10, true); let at = view.getUint32(end + 16, true);
  for (let i = 0; i < total; i++) {
    if (view.getUint32(at, true) !== 0x02014b50 || view.getUint16(at + 10, true) !== 0) throw new Error('Unexpected voice NPZ format.');
    const size = view.getUint32(at + 24, true), nameLength = view.getUint16(at + 28, true), extra = view.getUint16(at + 30, true), comment = view.getUint16(at + 32, true);
    const name = decode(bytes.subarray(at + 46, at + 46 + nameLength)).replace(/\.npy$/, ''), local = view.getUint32(at + 42, true);
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    if (decode(bytes.subarray(start + 1, start + 6)) !== 'NUMPY' || bytes[start + 6] !== 1) throw new Error('Unexpected voice NPY format.');
    const headerLength = view.getUint16(start + 8, true), header = decode(bytes.subarray(start + 10, start + 10 + headerLength));
    const rows = /'shape':\s*\((\d+),\s*256\)/.exec(header)?.[1];
    if (!rows || !header.includes("'descr': '<f4'") || !header.includes("'fortran_order': False") || size !== 10 + headerLength + Number(rows) * 256 * 4) throw new Error('Invalid voice style shape.');
    out.set(name, new Float32Array(buffer.slice(start + 10 + headerLength, start + size)));
    at += 46 + nameLength + extra + comment;
  }
  return out;
}
const symbols = '$' + ';:,.!?¡¿—…"«»"" ' + 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz' + "ɑɐɒæɓʙβɔɕçɗɖðʤəɘɚɛɜɝɞɟʄɡɠɢʛɦɧħɥʜɨɪʝɭɬɫɮʟɱɯɰŋɳɲɴøɵɸθœɶʘɹɺɾɻʀʁɽʂʃʈʧʉʊʋⱱʌɣɤʍχʎʏʑʐʒʔʡʕʢǀǁǂǃˈˌːˑʼʴʰʱʲʷˠˤ˞↓↑→↗↘'\u0329'ᵻ";
const kittenVocab = Object.fromEntries([...symbols].map((s, i) => [s, i]));
function chunks(text, g2p, kitten) {
  const out = [], limit = kitten ? 380 : 500;
  for (const sentence of normalize(text).match(/[^.!?]+[.!?]*/g) || []) {
    let phonemes = g2p.phonemes(sentence.trim() + (/[.!?,;:]$/.test(sentence.trim()) ? '' : ','));
    if (kitten) phonemes = (phonemes.match(/[\p{L}\p{M}\p{N}_]+|[^\p{L}\p{M}\p{N}_\s]/gu) || []).join(' ');
    else phonemes = phonemes.replace(/r/g, 'ɹ').replace(/x/g, 'k').replace(/ɬ/g, 'l').replace(/ʲ/g, 'j').replace(/nˈaɪnti/g, 'nˈaɪndi');
    // Prefer word boundaries; a single very long word is split rather than exceeding the model context.
    let part = '';
    for (const word of phonemes.split(/\s+/)) {
      if (part && part.length + word.length + 1 > limit) { out.push(part); part = ''; }
      for (let at = 0; at < word.length; at += limit) {
        const piece = word.slice(at, at + limit);
        if (part && part.length + piece.length + 1 > limit) { out.push(part); part = ''; }
        part += (part ? ' ' : '') + piece;
      }
    }
    if (part) out.push(part);
  }
  return out;
}
class NeuralVoices {
  constructor({ read, importModule, consent = async () => {} }) {
    Object.assign(this, { read, importModule, consent });
    this.models = new Map(); this.styles = new Map(); this.cache = new Map(); this.requested = null;
  }
  async runtime() {
    if (!this.ort) {
      const [ort, glue, wasm, dictionary] = await Promise.all([
        this.importModule(pins.assets.runtime.url), this.read(pins.assets.glue.url), this.read(pins.assets.wasm.url), this.read(pins.assets.dictionary.url)
      ]);
      ort.env.wasm.numThreads = 1; ort.env.wasm.proxy = false;
      ort.env.wasm.wasmBinary = wasm;
      // Import verified glue as a blob. ORT's module URL override prevents any CDN script-src dependency.
      const url = URL.createObjectURL(new Blob([glue], { type: 'text/javascript' }));
      ort.env.wasm.wasmPaths = { mjs: url };
      this.glueURL = url; this.ort = ort; this.g2p = new G2P(decode(dictionary));
    }
    return this.ort;
  }
  async load(name) {
    if (!pins.voices.includes(name)) throw new Error('Unknown neural voice.');
    if (this.styles.has(name)) return;
    await this.consent(name);
    const kitten = name.startsWith('kitten:'), type = kitten ? 'kitten' : 'kokoro';
    if (!this.models.has(type)) {
      // Model bytes have already been SHA-256 verified. Only Kitten's two seed attributes change in memory.
      const model = new Uint8Array(await this.read(pins.assets[type + 'Model'].url));
      this.models.set(type, kitten ? seedKitten(model) : model);
    }
    await this.runtime();
    if (kitten) {
      const [styles, config] = await Promise.all([this.read(pins.assets.kittenVoices.url), this.read(pins.assets.kittenConfig.url)]);
      this.kitten = kittenStyles(styles); this.config = JSON.parse(decode(config));
      for (const alias of Object.keys(this.config.voice_aliases)) this.styles.set('kitten:' + alias, this.kitten.get(this.config.voice_aliases[alias]));
    } else {
      this.vocab ||= JSON.parse(decode(await this.read(pins.assets.kokoroTokenizer.url))).model.vocab;
      const style = await this.read(pins.assets[name].url);
      if (style.byteLength !== 510 * 256 * 4) throw new Error('Invalid Kokoro style shape.');
      this.styles.set(name, new Float32Array(style));
    }
  }
  buffer(node) {
    if (!pins.voices.includes(node.voice)) throw new Error('Unknown neural voice.');
    if (!this.cache.has(keyFor(node))) { this.requested = { ...node }; throw new Error(this.styles.has(node.voice) ? MISSING : 'VOICE_NOT_LOADED:' + node.voice); }
    return this.cache.get(keyFor(node));
  }
  measure(node) { const b = this.buffer(node); return b.frames / b.rate; }
  async prepare(node) {
    const key = keyFor(node);
    if (this.cache.has(key)) return;
    if (typeof node.text !== 'string' || !node.text.trim() || node.text.length > 5000) throw new Error('Neural speech needs 1–5000 characters of text.');
    if (!((node.speed ?? 1) >= 0.5 && (node.speed ?? 1) <= 2)) throw new Error('speed must be from 0.5 to 2.');
    if ((node.pitch ?? 1) !== 1) throw new Error('Neural voices support pitch=1; use a Pico voice to change pitch.');
    await this.load(node.voice);
    const kitten = node.voice.startsWith('kitten:'), type = kitten ? 'kitten' : 'kokoro', ort = this.ort;
    const session = await ort.InferenceSession.create(this.models.get(type), { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    const parts = []; let length = 0;
    try {
      for (const phonemes of chunks(node.text, this.g2p, kitten)) {
        const vocab = kitten ? kittenVocab : this.vocab;
        const ids = [0, ...[...phonemes].filter(p => Object.hasOwn(vocab, p)).map(p => vocab[p]), ...(kitten ? [10, 0] : [0])];
        if (ids.length < 4) continue;
        const styles = this.styles.get(node.voice), rows = styles.length / 256;
        const row = kitten ? Math.min(ids.length, rows - 1) : Math.min(Math.max(ids.length - 2, 0), 509);
        const speed = (node.speed ?? 1) * (kitten ? this.config.speed_priors[this.config.voice_aliases[node.voice.slice(7)]] : 1);
        const feeds = {
          input_ids: new ort.Tensor('int64', BigInt64Array.from(ids, BigInt), [1, ids.length]),
          style: new ort.Tensor('float32', styles.slice(row * 256, (row + 1) * 256), [1, 256]),
          speed: new ort.Tensor('float32', Float32Array.of(speed), [1])
        };
        const outputs = await session.run(feeds);
        const tensor = outputs[kitten ? session.outputNames[0] : 'waveform'];
        const samples = tensor?.data;
        if (!(samples instanceof Float32Array)) throw new Error('The neural model returned invalid audio.');
        const part = samples.slice(0, kitten ? Math.max(0, samples.length - 5000) : samples.length);
        length += part.length;
        if (length > 300 * 24000 || !part.every(Number.isFinite)) throw new Error('Neural speech exceeded the audio limits.');
        parts.push(part);
        for (const t of Object.values(feeds)) t.dispose();
        for (const t of Object.values(outputs)) t.dispose();
      }
    } finally { await session.release(); }
    if (!length) throw new Error('No English speech could be synthesized from this text.');
    const samples = new Float32Array(length); let at = 0;
    for (const part of parts) { samples.set(part, at); at += part.length; }
    // Bound retained utterances by sample bytes. The active scene is itself limited to 300 seconds.
    const bytes = [...this.cache.values()].reduce((n, b) => n + b.frames * 4, 0);
    if (bytes + length * 4 > 128 * 1024 * 1024) throw new Error('Neural speech cache is full. Cancel and render a smaller scene.');
    this.cache.set(key, { rate: 24000, frames: length, channels: [samples] });
  }
}
const api = { NeuralVoices, MISSING, keyFor, seedKitten, kittenStyles, chunks, kittenVocab };
if (typeof module !== 'undefined') module.exports = api; else globalThis.AudioNeuralVoice = api;
})();
