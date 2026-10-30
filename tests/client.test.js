const { test } = require('node:test');
const assert = require('node:assert/strict');
const AudioClient = require('../src/audio-client.js');
const AudioSandbox = require('../src/audio-sandbox.js');

function fakeTimers() {
  let now = 0, next = 0; const timers = new Map();
  return { setTimeout: (fn, ms) => { timers.set(++next, { fn, at: now + ms }); return next; }, clearTimeout: id => timers.delete(id),
    advance(ms) { now += ms; for (const [id, t] of [...timers].sort((a, b) => a[1].at - b[1].at)) if (t.at <= now) { timers.delete(id); t.fn(); } } };
}
function fakeWorker(reply) {
  const worker = { terminated: false, posted: [], postMessage(data) { this.posted.push(data); reply?.(data, worker); }, terminate() { this.terminated = true; } };
  return worker;
}
const ok = (id, length = 4) => ({ id, sampleRate: 48000, length, channels: [new Float32Array(length), new Float32Array(length)], tracks: ['main'], clips: [{ track: 'main', start: 0, end: 1, line: 3, label: 'Sine(1)' }], scenes: ['A'], scene: 'A', output: 'hi', ms: 5 });

test('results resolve; scene errors keep the warm worker; settings are normalized', async () => {
  const workers = [];
  const client = new AudioClient({ timers: fakeTimers(), workerFactory: () => { const w = fakeWorker((data, w) => queueMicrotask(() => {
    w.onmessage({ data: { type: 'started', id: data.id } });
    w.onmessage({ data: data.src === 'bad' ? { id: data.id, error: { message: 'NameError: x', line: 4, traceback: 't' }, scenes: ['A'], output: '' } : ok(data.id) });
  })); workers.push(w); return w; } });
  const result = await client.run('good', { sampleRate: 1 });
  assert.equal(result.length, 4); assert.equal(workers[0].posted[0].settings.sampleRate, 48000); assert.deepEqual(result.clips[0], { track: 'main', label: 'Sine(1)', line: 3, start: 0, end: 1 });
  await assert.rejects(client.run('bad'), error => error.scene && error.line === 4 && error.message === 'NameError: x');
  assert.equal(workers.length, 1); assert.equal(workers[0].terminated, false);
});

test('startup and render deadlines are separate; a timeout terminates the worker', async () => {
  const timers = fakeTimers(), workers = [];
  const client = new AudioClient({ timers, timeout: 1000, startupTimeout: 5000, workerFactory: () => { const w = fakeWorker(); workers.push(w); return w; } });
  const pending = client.run('loop');
  timers.advance(4000); // still downloading Python: no render deadline yet
  workers[0].onmessage({ data: { type: 'started', id: 1 } });
  timers.advance(999); assert.equal(workers[0].terminated, false);
  timers.advance(2);
  await assert.rejects(pending, /timed out after 1 seconds/); assert.equal(workers[0].terminated, true);
  const slow = client.run('x'); timers.advance(5001); await assert.rejects(slow, /took too long/);
});

test('cancel, stale replies and status messages', async () => {
  const statuses = [], workers = [];
  const client = new AudioClient({ timers: fakeTimers(), onStatus: text => statuses.push(text), workerFactory: () => { const w = fakeWorker(); workers.push(w); return w; } });
  const first = client.run('a'); client.cancel(); await assert.rejects(first, /Cancelled/);
  const second = client.run('b');
  workers[1].onmessage({ data: ok(1) }); // a reply for an older id is ignored
  workers[1].onmessage({ data: { type: 'status', id: 2, text: 'Loading Python…' } });
  workers[1].onmessage({ data: ok(2) });
  assert.equal((await second).length, 4); assert.deepEqual(statuses, ['Loading Python…']);
});

test('results from the sandbox are validated before the editor uses them', () => {
  const bad = patch => assert.throws(() => AudioClient.validate({ ...ok(1), ...patch }));
  bad({ sampleRate: 12345 }); bad({ length: -1 }); bad({ length: 300 * 48000 + 1 }); bad({ channels: [] }); bad({ channels: [new Float64Array(4)] });
  bad({ channels: [new Float32Array(4), new Float32Array(3)] }); bad({ channels: [1, 2, 3].map(() => new Float32Array(4)) });
  const cleaned = AudioClient.validate({ ...ok(1), output: 'x'.repeat(300000), scenes: ['A'.repeat(500)], clips: [{ track: 7, line: -2, start: NaN, end: 2, label: '<b>' }, null] });
  assert.equal(cleaned.output.length, 200000); assert.equal(cleaned.scenes[0].length, 100);
  assert.deepEqual(cleaned.clips, [{ track: '', label: '<b>', line: null, start: 0, end: 2 }]);
  assert.deepEqual(AudioClient.validate({ id: 1, error: { message: 5, line: 0 } }).error, { message: 'The scene failed.', line: null, traceback: '' });
});

test('the sandbox runs the worker files in order, proxying only the runtime, audio.py and vendored engines', async () => {
  let options; const fetched = [];
  const sdk = { createSandbox(o) { options = o; return { postMessage() {}, terminate() {} }; } };
  globalThis.AudioCore = require('../src/audio-core.js');
  const worker = AudioSandbox.factory({ loadSDK: async () => sdk, base: 'https://audio.hashbin.page/src/', fetchSource: async url => { fetched.push(url); return `/*${url.split('/').pop()}*/`; } })();
  worker.postMessage({ id: 1 });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(options.origin, 'opaque');
  assert.deepEqual(options.proxy, ['https://cdn.jsdelivr.net/pyodide/v314.0.7/full/', 'https://audio.hashbin.page/src/py/', 'https://audio.hashbin.page/vendor/']);
  assert.equal(await options.source, AudioSandbox.FILES.map(f => `/*${f}*/`).join('\n;\n'));
  worker.terminate(); delete globalThis.AudioCore;
});
