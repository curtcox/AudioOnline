const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const MiniNotation = require('../src/mini-notation.js');
const Instruments = require('../src/instruments.js');
const AudioDetector = require('../src/detector.js');
const { mathShim } = require('../src/notation.js');
const { render, notation } = require('../scripts/node-python.cjs');

const events = (text, cycles) => MiniNotation.events(text, cycles).map(e => `${e.name}@${+e.start.toFixed(4)}/${+e.dur.toFixed(4)}`).join(' ');
const scene = body => `from audio import *\n\nclass S(Scene):\n    def construct(self):\n${body.split('\n').map(line => '        ' + line).join('\n')}\n`;

test('vendored engines are the exact npm release files', () => {
  const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  assert.equal(sha('vendor/abcjs/abcjs-basic-min.js'), '3290ef44c918d5e882029d3a47ad3dd63c16c8819da5abe921f3d1e642b4f4f0'); // abcjs@6.7.2
  assert.equal(sha('vendor/zzfx/ZzFX.js'), '43f321101a935892c112a291e2e943b4da33159b43fcd4a21f3eae710f4a27ff'); // zzfx@1.4.0
  assert.equal(sha('vendor/jsfxr/sfxr.js'), '6095a6358e654bc3ffd55d9ccecf694f187953d78b1391ee2823a6fcb92551c5'); // jsfxr@1.4.1
});

test('mini-notation: subdivision, repeats, alternation, stacks, weights, replication and Euclid', () => {
  assert.equal(events('bd sn'), 'bd@0/0.5 sn@0.5/0.5');
  assert.equal(events('bd*2 [~ sn] hh'), 'bd@0/0.1667 bd@0.1667/0.1667 sn@0.5/0.1667 hh@0.6667/0.3333');
  assert.equal(events('<bd sn cp>', 3), 'bd@0/1 sn@1/1 cp@2/1');
  assert.equal(events('<bd [sn sn]>*2'), 'bd@0/0.5 sn@0.5/0.25 sn@0.75/0.25');
  assert.equal(events('[bd, hh*2]'), 'bd@0/1 hh@0/0.5 hh@0.5/0.5');
  assert.equal(events('bd, hh*2'), 'bd@0/1 hh@0/0.5 hh@0.5/0.5');
  assert.equal(events('bd@3 sn'), 'bd@0/0.75 sn@0.75/0.25');
  assert.equal(events('bd!3'), 'bd@0/0.3333 bd@0.3333/0.3333 bd@0.6667/0.3333');
  assert.equal(events('cp/2', 4), 'cp@0/1 cp@2/1');
  assert.equal(events('bd(3,8,2)'), 'bd@0.125/0.125 bd@0.5/0.125 bd@0.75/0.125');
  for (const [k, n, expected] of [[3, 8, '10010010'], [5, 8, '10110110'], [4, 16, '1000100010001000'], [0, 4, '0000'], [7, 12, '101101011010']]) assert.equal(MiniNotation.euclid(k, n).map(Number).join(''), expected);
  assert.throws(() => MiniNotation.events('bd [sn'), /Expected "\]" \(column 7\)/);
  assert.throws(() => MiniNotation.events('bd $'), /Unexpected "\$" \(column 4\)/);
  assert.throws(() => MiniNotation.events('bd(9,8)'), /Euclidean/);
  assert.throws(() => MiniNotation.events('bd*500', 50), /20,000 events/);
});

test('instruments: equal temperament, every voice and drum renders finite audio of the documented length', () => {
  assert.equal(Instruments.frequency('a4'), 440); assert.equal(+Instruments.frequency('C4').toFixed(3), 261.626);
  assert.equal(+Instruments.frequency('Bb2').toFixed(3), 116.541); assert.equal(Instruments.frequency(69), 440); assert.equal(Instruments.frequency('h2'), null);
  for (const name of Instruments.names) {
    const out = Instruments.note(name, 220, 24000, 48000, 0.8, 1);
    assert.equal(out.length, 24000 + Math.round(Instruments.tail(name) * 48000), name);
    assert.ok(out.every(Number.isFinite) && out.some(v => Math.abs(v) > 0.01) && out.every(v => Math.abs(v) < 1), name);
  }
  for (const name of Instruments.drums) {
    const out = Instruments.drum(name, 48000, 1, 3);
    assert.equal(out.length, Instruments.drumLength(name, 48000));
    assert.ok(out.every(Number.isFinite) && out.some(v => Math.abs(v) > 0.05) && out.every(v => Math.abs(v) <= 1), name);
  }
});

test('the Math shim is deterministic and seedable, and passes exact operations through', () => {
  const m = mathShim();
  m.seed(5); const a = [m.random(), m.random()]; m.seed(5); assert.deepEqual([m.random(), m.random()], a);
  assert.equal(m.floor, Math.floor); assert.equal(m.sqrt, Math.sqrt); assert.equal(m.PI, Math.PI);
  assert.ok(Math.abs(m.tan(0.3) - Math.tan(0.3)) < 1e-14); assert.ok(Math.abs(m.cbrt(-27) + 3) < 1e-14);
});

test('the detector reads Python with strings and comments blanked', () => {
  const type = text => AudioDetector.detect(text).type;
  assert.equal(type('from audio import *\nclass A(Scene):\n    pass'), 'python');
  assert.equal(type('from audio import *\nx = abc("""X:1\nK:C\nCDE""")'), 'python');
  assert.equal(type('X:1\nT:t\nK:G\nGAB'), 'abc');
  assert.equal(type('coin = [1,.05,1675,,.06]\nzzfx(...[,,925])'), 'zzfx');
  assert.equal(type('pickupCoin\nlaserShoot 3'), 'sfxr');
  assert.equal(type('{"wave_type": 0, "p_env_attack": 0.1}'), 'sfxr');
  assert.equal(type('bpm 90\ndrums: bd sn'), 'pattern');
  assert.equal(type('# X:1\n# K:C\nimport numpy'), 'python');
  assert.equal(type('print("bpm 90")'), 'python');
});

test('notation documents render with lines, labels and seeded determinism', { timeout: 120000 }, async () => {
  const abc = await render('X:1\nT:Scale\nL:1/4\nQ:1/4=120\nK:C\nCDEF|G4|]', {}, 'abc');
  assert.equal(abc.result.clips[0].label, 'Scale');
  assert.equal(abc.result.length, Math.round((8 * 0.5 + Instruments.tail('piano')) * 48000));
  const zzfx = await render('a = [1,0,440,,.1]\n\n// b\nb = [1,0,880,,.1]', {}, 'zzfx');
  assert.deepEqual(zzfx.result.clips.map(c => [c.label, c.line, c.track]), [['a', 1, 'zzfx'], ['b', 4, 'zzfx']]);
  assert.equal(zzfx.result.clips[1].start, zzfx.result.clips[0].end + 0.3);
  const coin = async seed => (await render(`pickupCoin ${seed}`, {}, 'sfxr')).hash;
  assert.equal(await coin(3), await coin(3)); assert.notEqual(await coin(3), await coin(4));
  const beat = await render('bpm 120\ncycles 2\nkick: bd*4\nbass(pluck): c2 g1', {}, 'pattern');
  assert.equal(beat.result.length, 4 * 48000); assert.deepEqual(beat.result.tracks, ['kick', 'bass']);
  const fails = async (src, kind, pattern, line) => assert.rejects(render(src, {}, kind), e => pattern.test(e.message) && e.line === line);
  await fails('bpm 120\nkick: bd [sn', 'pattern', /Expected "\]"/, 2);
  await fails('kick: bd zz', 'pattern', /"zz" is not a drum/, 1);
  await fails('a = [1,0,440]\nnot an array', 'zzfx', /one ZzFX array/, 2);
  await fails('pickupCoin\nnope!', 'sfxr', /sound code/, 2);
  await fails('{"wave_type": ', 'sfxr', /sfxr JSON/, 1);
  await fails('X:1\nK:C\n', 'abc', /no notes/, 1);
});

test('Python notation clips measure through the bridge so self.time matches the render', { timeout: 120000 }, async () => {
  const { timeline, result } = await render(scene([
    'self.play(pattern("bd sn", bpm=120, cycles=2))',
    'self.play(Note("C4", 0.5, "organ"))',
    'self.play(Drum("cp") >> zzfx([1, 0, 440, None, .1]) >> sfxr("blipSelect", seed=2))',
    'print(round(self.time, 6))'
  ].join('\n')));
  const ends = result.clips.map(c => c.end);
  assert.deepEqual(timeline.placements.map(p => +p.at.toFixed(9)), [0, 4, 4.56]); // organ release 0.06 s
  assert.ok(Math.abs(ends[2] - result.length / 48000) < 1e-9);
  assert.equal(timeline.placements[0].clip.line, 5);
  const fails = async (body, pattern, line) => assert.rejects(render(scene(body)), e => pattern.test(e.message) && e.line === line);
  await fails('Note("H4")', /not a note name/, 5);
  await fails('Note("C4", instrument="kazoo")', /instrument must be one of/, 5);
  await fails('Drum("gong")', /drum must be one of/, 5);
  await fails('x = 1\npattern("bd [")', /Expected "\]"/, 6);
  await fails('zzfx([1, "a"])', /ZzFX value must be a number/, 5);
  await fails('sfxr(42)', /preset name/, 5);
  await fails('abc("X:1\\nK:C\\n", instrument="kazoo")', /instrument must be one of/, 5);
  const engine = await notation();
  assert.equal(engine.measure({ op: 'drum', name: 'bd' }), 0.5);
});
