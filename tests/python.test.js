/* audio.py under the same Pyodide release the sandbox uses. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { render } = require('../scripts/node-python.cjs');
const golden = require('./golden.json');
const { catalog } = require('../src/examples.js');

const scene = body => `from audio import *\n\nclass S(Scene):\n    def construct(self):\n${body.split('\n').map(line => '        ' + line).join('\n')}\n`;
const fails = async (source, pattern, line) => {
  await assert.rejects(render(source), error => { assert.match(error.message, pattern); assert.equal(error.line, line); return true; });
};

test('every example renders to its golden bytes, twice', { timeout: 240000 }, async () => {
  for (const example of catalog) {
    const kind = example.type || 'python', first = await render(example.source, {}, kind), second = await render(example.source, {}, kind);
    assert.equal(first.hash, golden[example.id].hash, example.id);
    assert.equal(second.hash, first.hash, `${example.id} repeat`);
    for (const name of first.scenes.slice(1)) assert.equal((await render(example.source, { scene: name }, kind)).hash, golden[`${example.id}:${name}`].hash, name);
  }
});

test('the cursor, placements, tracks and lines describe the timeline', { timeout: 120000 }, async () => {
  const { timeline, result } = await render(scene([
    'self.play(Sine(440).dur(0.5), track="a")',
    'self.wait(0.25)',
    'p = self.add(Saw(110).dur(1).gain(-6), track="b", pan=0.5).fade_in(0.1).gain(-3)',
    'self.track("b").gain(-2)',
    'self.add((Silence(0.1) >> Square(220).dur(0.2)) * 2, at=2)',
    'self.add(Triangle(330).dur(1)[0.25:0.75], at=3)',
    'self.master.gain(-1)'
  ].join('\n')));
  assert.deepEqual(timeline.placements.map(p => [p.at, p.track, p.gain, p.pan, p.line]), [[0, 'a', 0, 0, 5], [0.75, 'b', -3, 0.5, 7], [2, 'main', 0, 0, 9], [3, 'main', 0, 0, 10]]);
  assert.deepEqual(timeline.placements[1].clip.op, 'fade');
  assert.deepEqual(timeline.tracks, { a: { gain: 0, mute: false }, b: { gain: -2, mute: false }, main: { gain: 0, mute: false } });
  assert.equal(timeline.master.gain, -1);
  assert.equal(timeline.placements[2].clip.op, 'loop'); assert.equal(timeline.placements[2].clip.of.op, 'seq');
  assert.equal(result.length, 3.5 * 48000);
  assert.deepEqual(result.clips.map(c => c.label), ['Sine(440)', 'Saw(110)', 'Silence(0.1) >> Square(220)', 'Triangle(330)']);
});

test('scene class settings override the editor; scenes are listed in definition order', { timeout: 120000 }, async () => {
  const source = 'from audio import *\nclass A(Scene):\n    sample_rate = 22050\n    channels = 1\n    def construct(self):\n        self.add(Sine(1).dur(1))\nclass B(Scene):\n    length = 2\n';
  const a = await render(source, { sampleRate: 48000, channels: 2 });
  assert.deepEqual([a.scenes, a.scene, a.result.sampleRate, a.result.channels.length], [['A', 'B'], 'A', 22050, 1]);
  const b = await render(source, { scene: 'B' });
  assert.deepEqual([b.scene, b.result.length], ['B', 96000]);
  assert.equal((await render(source, { scene: 'Missing' })).scene, 'A');
});

test('errors report the user\'s line, including syntax errors and errors raised inside audio.py', { timeout: 120000 }, async () => {
  await fails(scene('self.add(Sine(3))'), /give Sine\(3\) a duration/, 5);
  await fails(scene('x = 1\nundefined_name'), /NameError/, 6);
  await fails(scene('self.add(Sine(3).dur(1), pan=2)'), /pan must be at most 1/, 5);
  await fails(scene('Noise(color="purple")'), /Noise color/, 5);
  await fails(scene('Sine(1) >> Sine(2)'), /duration with \.dur/, 5);
  await fails('from audio import *\nclass S(Scene):\n    def construct(self)\n        pass\n', /SyntaxError/, 3);
  await fails('x = 1\n', /Define a class that extends Scene/, null);
  await fails(scene('self.add(Sine(1).dur(1), at=299.5)\nself.add(Sine(1).dur(301))'), /time must be a number/, 6);
});

test('Samples accept numpy arrays and plain lists, mono or stereo', { timeout: 240000 }, async () => {
  const stereo = await render('import numpy as np\nfrom audio import *\nclass S(Scene):\n    def construct(self):\n        self.add(Samples(np.stack([np.full(48, 0.5), np.full(48, -0.25)], axis=1), 48000))\n        self.add(Samples([0.1] * 24, 24000), at=0.002)\n');
  const [left, right] = stereo.result.channels;
  assert.equal(stereo.result.length, 96 + 48);
  assert.equal(+left[10].toFixed(4), 0.5); assert.equal(+right[10].toFixed(4), -0.25);
  await fails('import numpy as np\nfrom audio import *\nclass S(Scene):\n    def construct(self):\n        Samples(np.zeros((4, 3)), 8000)\n', /shaped/, 5);
  await fails('import numpy as np\nfrom audio import *\nclass S(Scene):\n    def construct(self):\n        Samples(np.array([np.nan]), 8000)\n', /NaN/, 5);
});
