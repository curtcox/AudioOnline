/* Sample scenes written for this site. The gallery (Step 4) builds on this catalog. */
(() => {
const catalog = [
  { id: 'hello', title: 'Hello, chime', tags: ['music', 'sfx'], description: 'Four chime notes over a pink-noise bed, then a low thump.', source: `from audio import *

class Hello(Scene):
    """Four chime notes over a soft noise bed, then a low thump."""

    def construct(self):
        bed = Noise(color="pink").lowpass(900).gain(-24).dur(2.5).fade_in(0.5).fade_out(0.8)
        self.add(bed, at=0, track="ambience")
        for i, freq in enumerate([523.25, 659.25, 783.99, 1046.5]):
            note = Sine(freq).env(adsr(0.005, 0.3, 0.2, 0.6)).dur(1.2).gain(-9)
            self.add(note, at=0.25 * i, track="chime", pan=-0.6 + 0.4 * i)
        self.wait(1.5)
        thump = (Sine(55).env(adsr(0.002, 0.15, 0, 0.2)).dur(0.4)
                 + Noise(seed=1).lowpass(600).env(adsr(0.001, 0.05, 0, 0.05)).dur(0.12))
        self.add(thump, track="sfx", gain=-3)
` },
  { id: 'narrated-intro', title: 'Narrated intro', tags: ['voice', 'music'], description: 'The bundled offline voice over a soft pad chord.', source: `from audio import *

class Welcome(Scene):
    """Speech on the voice track; say() moves the cursor to the end of each line."""

    def construct(self):
        chord = (Note("C4", 5, "pad") + Note("E4", 5, "pad") + Note("G4", 5, "pad")).gain(-14)
        self.add(chord, at=0, track="music")
        self.wait(0.6)
        self.say("Welcome to Audio Online.")
        self.wait(0.3)
        self.say("Write a few lines of Python, and hear them.", speed=0.95)
        self.add(Note("C6", 0.3, "bell").gain(-14), track="sfx")
` },
  { id: 'numpy-glide', title: 'numpy glide', tags: ['numpy', 'synthesis'], description: 'A pitch glide computed sample by sample with numpy.', source: `import numpy as np
from audio import *

class Glide(Scene):
    """numpy computes the waveform; Samples() places it on the timeline."""

    def construct(self):
        rate = 24000
        t = np.arange(int(rate * 1.5)) / rate
        freq = 220 * 2 ** (t / 1.5)           # one octave up over 1.5 s
        phase = 2 * np.pi * np.cumsum(freq) / rate
        tone = 0.4 * np.sin(phase) * np.minimum(1, (1.5 - t) * 4)
        print(f"{len(tone)} samples, peak {np.abs(tone).max():.3f}")
        self.play(Samples(tone, rate), track="glide")
        self.play(Sine(440).env(adsr(0.01, 0.1, 0.5, 0.3)).dur(0.6).gain(-6), track="answer")
` },
  { id: 'two-scenes', title: 'Two scenes', tags: ['sfx'], description: 'One file, two Scenes: choose which to render.', source: `from audio import *

class Rise(Scene):
    def construct(self):
        for step in range(6):
            self.play(Square(110 * 2 ** (step / 12)).lowpass(1800).env(adsr(0.005, 0.05, 0.4, 0.05)).dur(0.12).gain(-14))

class Fall(Scene):
    def construct(self):
        whoosh = Noise().bandpass(1200, q=2).env(Envelope([(0, 0), (0.3, 1), (1.2, 0)])).dur(1.2)
        self.play(whoosh.gain(-8), pan=-0.5)
        self.play(Triangle(330).dur(0.4).fade_out(0.3).gain(-10), pan=0.5)
` },
  { id: 'abc-tune', type: 'abc', title: 'ABC tune', tags: ['music', 'notation'], description: 'A short original reel in ABC notation, played on the pluck instrument.', source: `X:1
T:Lantern Reel
C:Audio Online
M:4/4
L:1/8
Q:1/4=132
%%MIDI program 25
K:D
|A2FA dAFA|B2GB dBGB|A2FA dfed|cAeA cAGE|
|d2fd adfd|e2ge bege|f2df ecAc|d2fe d4|]
` },
  { id: 'drum-pattern', type: 'pattern', title: 'Drum pattern', tags: ['beats', 'notation'], description: 'Mini-notation drums and a bassline: two cycles at 104 bpm.', source: `bpm 104
cycles 2
kick: bd ~ [~ bd] ~, ~ ~ ~ bd(3,8)
snare: ~ sn ~ <sn [sn cp]>
hats: hh*8
toms: ~ ~ ~ [~ lt mt ht]/2
bass(pluck): <c2 [c2 c3]> ~ <g1 eb2> [~ c2]
` },
  { id: 'ui-sounds', type: 'zzfx', title: 'UI sounds pack', tags: ['sfx', 'notation'], description: 'Six interface sounds as ZzFX parameter arrays.', source: `// Each line is one sound: ZzFX parameter arrays (blank = default).
click = [.6,0,1400,,.01,.02,1,2.4,,,,,,,,,,.5]
confirm = [.7,0,520,.01,.04,.18,1,1.4,,,260,.05]
cancel = [.7,0,340,.01,.05,.16,1,1.8,-6]
error = [.8,0,140,.02,.1,.2,2,2,,,,,,.3]
notify = [.5,0,880,.02,.08,.4,,1.2,,,440,.12,.1]
toggle = [.5,0,640,,.03,.03,1,2,4]
` },
  { id: 'sfxr-pack', type: 'sfxr', title: 'sfxr game sounds', tags: ['sfx', 'notation'], description: 'Classic sfxr presets with fixed seeds: the same seed always gives the same sound.', source: `# One sfxr preset per line, with an optional seed.
coin = pickupCoin 3
laser = laserShoot 11
jump = jump 2
hit = hitHurt 5
power = powerUp 8
blast = explosion 4
` },
  { id: 'notation-mix', title: 'Notations in a scene', tags: ['music', 'beats', 'sfx'], description: 'ABC, a drum pattern, ZzFX and sfxr clips placed together in one Python scene.', source: `from audio import *

class Arcade(Scene):
    """Notation clips are ordinary clips: place, mix and sequence them."""

    def construct(self):
        beat = pattern("bd [~ bd] sn ~, hh*8", bpm=120, cycles=2)
        tune = abc("X:1\\nL:1/8\\nQ:1/4=120\\nK:Am\\nA2cA e2cA|G2BG d2BG|A2cA e2ag|a4 z4|]", instrument="square")
        self.add(beat, track="drums", gain=-4)
        self.add(tune, track="melody", gain=-8)
        self.add(sfxr("pickupCoin", seed=3), at=1.0, track="sfx", pan=0.4, gain=-6)
        self.add(zzfx([1, .05, 75, .02, .2, .6, 4, 2.5, None, None, None, None, None, 1.6]), at=3.5, track="sfx", gain=-8)
        self.add(Note("A5", 0.5, "bell") >> Note("E5", 1.0, "bell"), at=2.0, track="melody", gain=-10)
` }
];
const AudioExamples = { catalog, defaultSource: catalog[0].source };
if (typeof module !== 'undefined') module.exports = AudioExamples;
else globalThis.AudioExamples = AudioExamples;
})();
