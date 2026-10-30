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
` }
];
const AudioExamples = { catalog, defaultSource: catalog[0].source };
if (typeof module !== 'undefined') module.exports = AudioExamples;
else globalThis.AudioExamples = AudioExamples;
})();
