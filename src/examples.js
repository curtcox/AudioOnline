/* Original sample scenes for this site and its gallery (gallery.html). files are base64 WAVs; neural names
   the on-demand voice an example needs (its gallery cover uses the bundled voice instead). */
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
  { id: 'podcast-ducking', title: 'Podcast with ducking', tags: ['voice', 'music', 'effects'], description: 'A music bed that dips under the voice, then a limiter on the master.', source: `from audio import *

class Episode(Scene):
    """The music track ducks 12 dB whenever the voice track speaks."""

    def construct(self):
        groove = pattern("bd ~ [~ bd] ~, ~ sn ~ sn, hh*8", bpm=92, cycles=5)
        chords = (Note("A2", 2.6, "pad") >> Note("F2", 2.6, "pad") >> Note("C3", 2.6, "pad") >> Note("G2", 2.6, "pad")).gain(-4)
        self.add(groove + chords, at=0, track="music", gain=-6)
        self.tracks["music"].fx(LowPass(5000), Compressor(-22, 3, makeup=2)).duck(under="voice", amount=-12)
        self.wait(2.5)
        self.say("Welcome back to the show.")
        self.wait(0.4)
        self.say("Today: how computers learned to speak.", speed=0.95)
        self.track("voice").fx(HighPass(90), Compressor(-20, 2.5, makeup=3))
        self.master.fx(Limiter(-1))
` },
  { id: 'explosion', title: 'Synthesized explosion', tags: ['sfx', 'effects'], description: 'Layered noise and a falling sine, driven and filtered, in a big room.', source: `from audio import *

class Boom(Scene):
    """Three layers: a sub drop, a noisy body and a crackling tail."""

    seed = 7

    def construct(self):
        sub = Sine(70).env(Envelope([(0, 0), (0.01, 1), (1.2, 0)])).dur(1.4).fx(Drive(3))
        body = Noise("brown").env(adsr(0.005, 0.4, 0.3, 1.0)).dur(1.8).fx(LowPass(900, q=1.2), Gain(6))
        crackle = Noise().bandpass(2500, q=3).env(adsr(0.02, 0.3, 0.1, 1.2)).dur(2.0).gain(-12)
        self.add(sub, track="low")
        self.add(body, track="mid")
        self.add(crackle, at=0.05, track="high", pan=0.3)
        self.master.fx(Reverb(room=0.8, damp=0.3, mix=0.25), Compressor(-14, 4), Limiter(-1))
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
` },
  { id: 'door', title: 'Creaking door and slam', tags: ['sfx', 'effects'], description: 'A hinge that creaks slower as the door swings, then a heavy slam in a hallway.', source: `from audio import *

class Door(Scene):
    """Short resonant buzzes that slow down make the creak; three layers make the slam."""

    seed = 3

    def construct(self):
        t, gap = 0.0, 0.035
        for k in range(28):
            pitch = 300 + 140 * (k % 5) - 3 * k
            grain = Saw(pitch).bandpass(pitch * 3, q=6).env(adsr(0.002, 0.02, 0.2, 0.02)).dur(0.05)
            self.add(grain.gain(-4 - (k % 3) * 2), at=t, track="hinge", pan=-0.4 + k / 40)
            t, gap = t + gap, gap * 1.06
        self.wait(t + 0.15)
        slam = (Sine(48).env(adsr(0.001, 0.25, 0, 0.2)).dur(0.5).fx(Drive(4))
                + Noise("brown").lowpass(700).env(adsr(0.001, 0.08, 0.1, 0.25)).dur(0.4).gain(4)
                + Noise().highpass(3000).env(adsr(0.0005, 0.02, 0, 0.03)).dur(0.06).gain(-8))
        self.play(slam, track="slam", pan=0.3)
        self.track("hinge").fx(Peak(900, 6, 1.5), HighShelf(4000, -6))
        self.master.fx(Reverb(room=0.55, damp=0.6, mix=0.22), Limiter(-1))
` },
  { id: 'haunted-hallway', title: 'Haunted hallway', tags: ['sound design', 'voice', 'sfx', 'effects'], description: 'Wind and hum, footsteps crossing the room, a knock and a whisper: ambience, effects and voice in one scene.', source: `from audio import *

class Hallway(Scene):
    """Each layer has its own track and space; the ambience ducks under the voice."""

    seed = 11
    length = 9

    def construct(self):
        wind = Noise("pink").bandpass(500, q=0.8).dur(9).fade_in(1.5).fade_out(2)
        hum = (Sine(55) + Sine(110).gain(-9)).dur(9).fade_in(2).fade_out(2)
        self.add(wind, at=0, track="ambience", gain=-14)
        self.add(hum, at=0, track="ambience", gain=-26)
        self.track("ambience").automate("gain", [(0, -6), (4, 0), (9, -8)])
        # Footsteps walk from left to right and slow down.
        step = (Noise("brown").lowpass(400).env(adsr(0.002, 0.06, 0, 0.08)).dur(0.15)
                + Sine(70).env(adsr(0.001, 0.05, 0, 0.05)).dur(0.1))
        for k in range(7):
            self.add(step.gain(-2 - k % 2 * 3), at=0.6 + k * (0.5 + k * 0.03), track="steps", pan=-0.8 + k * 0.25)
        knock = (Sine(160).env(adsr(0.001, 0.05, 0, 0.06)).dur(0.12)
                 + Noise().bandpass(800, q=2).env(adsr(0.001, 0.02, 0, 0.03)).dur(0.05))
        for k in range(3):
            self.add(knock, at=5.3 + k * 0.28, track="door", pan=0.6)
        self.wait(6.5)
        self.say("Is anyone there?", speed=0.9, pitch=0.85)
        self.track("steps").fx(Reverb(room=0.7, damp=0.4, mix=0.35))
        self.track("door").fx(LowShelf(250, 4), Reverb(room=0.6, mix=0.3))
        self.track("voice").fx(HighPass(120), Delay(0.32, 0.25, 0.18), Reverb(room=0.85, damp=0.5, mix=0.3))
        self.track("ambience").duck(under="voice", amount=-6)
        self.master.fx(Limiter(-1))
` },
  { id: 'cid-wavetable', title: 'Wavetable from a CID', tags: ['music', 'samples', 'hashbin'], description: 'A 64-byte WAV addressed by its HashBin CID, looped into notes and re-pitched with speed().', source: `from audio import *

# One cycle of an organ-like wave: 20 samples of 8-bit WAV at 8 kHz, 64 bytes in all.
# A CID this short carries its content, so it needs no network. Longer CIDs download
# from HashBin and are checked against the CID before they play.
WAVE = "AAAAAABAUklGRjgAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YRQAAACAwMu4try2uMvAgEA1SEpESkg1QA"

class Wavetable(Scene):
    """Sample(cid=...) is a clip like any other: loop it into notes and change its speed."""

    def construct(self):
        cycle = Sample(cid=WAVE)
        print(f"one cycle lasts {cycle.duration * 1000:.1f} ms (400 Hz)")
        tone = cycle.loop(until=0.5).lowpass(2500)
        for step in [0, 4, 7, 12, 7, 4, 0, -5]:
            note = tone.speed(2 ** (step / 12)).env(adsr(0.01, 0.1, 0.6, 0.12))
            self.play(note.gain(-1), track="lead", pan=0.2)
        drone = cycle.loop(until=1.75).speed(0.5).lowpass(900)
        self.add(drone.env(Envelope([(0, 0), (0.4, 1), (2.8, 1), (3.5, 0)], curve="smooth")).gain(-5), at=0, track="drone", pan=-0.2)
        self.master.fx(Reverb(room=0.4, mix=0.2), Limiter(-1))
` },
  { id: 'uploaded-loop', title: 'Chopping an uploaded loop', tags: ['beats', 'samples'], description: 'loop.wav, an attached audio file, sliced into hits, reversed and re-pitched.', files: { 'loop.wav': 'UklGRvwZAABXQVZFZm10IBAAAAABAAEAESsAABErAAABAAgAZGF0YdgZAABybIGGn6u2vrzIv7/j1OLj6eXk2Nvn2tTd2tHLxL27s6ylnpaOhn93b2hgWVJLRT86NTAsKSYkIiEgICEiJCYpLDA0OT5DSU9WXWNqcnmAh46VnKOpsLa7wcbKztLV2Nrc3d7e3t3c2tjV0s7KxsG8t7GrpZ+ZkoyFfnhxa2ReWFJNSEM+OjYyLywqKCYlJCQkJSYnKSwuMTU4PUFGSlBVWmBmbHJ4foSKkJacoaessba7v8PHys7Q09XX2Nna2trZ2NfV1NHPzMjFwb25tLCrpqGblpGLhoB6dXBqZWBbVlFNSERBPTo3NDEvLSwqKSkoKCkpKiwtLzE0Njk9QERHS1BUWV1iZ2xxdnuAhYqPlJidoqarr7O3ur7BxMfKzM7Q0dPU1NXV1dXU09LRz83LycbEwb26t7Ovq6ejn5qWkY2IhH97dnFtaWRgXFhUUE1JRkNAPTs5NjQzMTAvLi4tLS0uLi8wMTM0Njg7PUBCRUhMT1JWWl1hZWltcXZ6foKGio6SlpqeoqWprLCztrm8vsHDxcfJyszNzs/P0NDQ0NDPz87Ny8rIxsXCwL67ubazsK2qpqOfnJiVkY2KhoJ+e3dzcGxoZWJeW1hVUk9MSUdEQkA+PDs5ODY1NDQzMzIyMjMzNDQ1Njc5Ojw+P0FERkhLTVBTVlhbX2JlaGtvcnV5fH+DhoqNkJOXmp2go6apq66xs7W4ury+v8HDxMXHyMjJysrLy8vLy8rKycjIx8XEw8HAvry6uLa0sq+tqqilop+dmpeUkY6LiIWCf3x5dnNwbWpnZGFfXFpXVVJQTkxKSEZEQ0FAPz08Ozs6OTk4ODg4ODg5OTo6Ozw9Pj9AQkNFRkhKTE5QUlRXWVteYGNlaGttcHN1eHt+gIOGiIuOkJOWmJudoKKkp6mrra+xs7W2uLm7vL2/wMHCwsPExMXFxcXFxcXFxMTDw8LBwL++vbu6ube2tLKwrq2rqaakoqCem5mXlJKPjYuIhoOBfnx5d3RycG1raWZkYmBeXFpYVlRSUE9NTEpJSEZFRENCQUFAPz8/Pj4+Pj4+Pj4/P0BAQUFCQ0RFRkdJSktNTlBSU1VXWFpcXmBiZGZoa21vcXN2eHp8f4GDhYeKjI6QkpSXmZudn6CipKaoqausrq+xsrS1tre4ubq7vLy9vb6+v7+/v7+/v7+/vr6+vb28u7q6ubi3trSzsrGvrqyrqaimpKOhn52bmpiWlJKQjoyKiIaEgoB+fHp4dnRycG5samhmZWNhX15cW1lXVlVTUlFQTk1MS0pJSUhHR0ZGRUVERERERERERERERUVFRkZHSEhJSktMTU5PUFFSVFVWWFlbXF5fYWJkZmdpa21ucHJ0dnh5e31/gYOEhoiKjI6PkZOUlpiZm52eoKGjpKanqKmrrK2ur7CxsrO0tLW2tre3uLi5ubm5ubm5ubm5ubm4uLe3tra1tbSzsrGwr66trKuqqaimpaSioaCenZuamJaVk5KQjo2LiYiGhIOBf318enh3dXRycG9tbGppZ2ZkY2FgX11cW1pZV1ZVVFNSUlFQT05OTU1MTEtLS0pKSkpKSkpKSkpKSktLS0xMTU1OT09QUVJTU1RVVldYWltcXV5gYWJjZWZoaWpsbW9wcnN1dnh6e31+gIGDhIaHiYuMjo+QkpOVlpeZmpudnp+goqOkpaanqKmqq6usra6ur7CwsbGysrKzs7Ozs7S0tLSzs7Ozs7KysrGxsLCvr66trayrqqmop6empaOioaCfnp2bmpmYlpWUkpGQjo2LiomHhoSDgYB/fXx6eXh2dXNycW9ubWtqaWhmZWRjYmFgX15dXFtaWVhXV1ZVVVRTU1JSUVFRUFBQUFBPT09PT09PUFBQUFBRUVJSUlNUVFVVVldYWFlaW1xdXl5fYWJjZGVmZ2hpa2xtbnBxcnN1dnd5ent9fn+AgoOEhoeIiouMjY+QkZKUlZaXmJmam5ydnp+goaKjpKWlpqenqKmpqqqrq6ysrK2tra6urq6urq6urq6urq2tra2srKurq6qqqaiop6ampaSjo6KhoJ+enZybmpmYl5aVlJORkI+OjYyKiYiHhoSDgoF/fn18e3l4d3Z1c3JxcG9ubWxramhnZ2ZlZGNiYWBfX15dXFxbW1pZWVhYV1dXVlZWVVVVVVVVVVVVVVVVVVVVVVZWVldXV1hYWVlaWltcXF1eXl5iXmRgZmFoZGdpZ21ncGlwbnBxcnN1dHh2e3h8fH2AfYV+hoKFiIWMh46JkIyQkJCTk5OXlJmWm5icmp6boJ2goZ+knqegpqKnoqqhrKKso6ykrKWspquoqaqoqqipqKmpqKinqKaopaano6ehp5+mnaabpJygnJ6bnJmamJiXlZeSlpCTj5COjY2Ki4mIiIWFhIKDf4J8gXl+eXp3eHZ2c3Rxcm9xbW9rbWprZ2tlaWRmY2ZhZV9kXmJeX15dX1tfWV5ZXFpcWFxXXFhbWFtYWllZWllaWlpaW1tbXFtdXF1eXl5gXmJgYmNiZGNmZGdmaGlqamtsbm1wb3BycnN0dnV4d3l6e3x9fn+BgIOChIWGh4eKiYuLjI6OkI+TkJSSlZWWlpiYmZmbm5udnZ6dn56hnqKgoqGio6Kjo6SjpKSkpaSlpKSkpKSlpKSkpKOjoqOioqGioKGgn6Cdn5yenJybmpqYmZeXlpWVlJOSkZGPkI2Oi4yKioiIhoaFhIOCgoCAfn59fHt6eXh3d3V1dHNycXFvb21ubGxra2lpaGhnZ2VmZGRjY2JiYWJhYWBgYF9gXl9eXl5eXl1eXV9dX11fXV9eX15fX19gX2FgYmFjYmNjZGRlZWZmZ2hoaWpra2xsbm5vcHBxcnN0dHZ2d3h5eXt7fH1+foCAgoKDhIWFh4eJiYqLi42Mjo6Qj5KRk5OUlJWWlpeXmJmZmpqbm5ucnJ2dnp2enp+foJ+goKCgoKCgoaChoKCgoKCgoJ+fn5+enp6dnZ2dnJybm5qamZmYmJeXlZaUlZOTkZKQkI+PjY2Mi4qKiYiHhoaFhIODgoGAf39+fXx7enp5eHd3dnV0dHNycXFwcG5ubW1sbGtqamlpaGhnZ2ZmZmVlZGRkZGNjYmNiY2JiYmJiYmFiYWJiYmJiYmJiY2NjY2RkZGVlZWZmZ2dnaGhpaWpqa2xsbW1ubm9wcXFycnN0dXV2d3d4eXp6e3x9fX5/gIGBgoOEhIWGh4eIiYmKi4yMjY6Oj4+QkZKSk5OUlJWVlpaXl5eYmJmZmZqampubm5ubnJycnJ2cnZydnZ2dnZycnJycnJucm5ubm5qampmZmJiYl5eWlpaVlZSUk5KSkZGQj4+Ojo2MjIuKiomIiIeGhoWEg4OCgYCAf35+fXx8e3p5eXh3d3Z1dXR0c3JycXFwb29ubm1tbGxra2pqamlpaWhoaGdnZ2dmZmZmZmZlZWVlZWVlZWVlZWVlZmZmZmZmZ2dnZ2hoaGlpaWpqa2trbGxtbW5ub29wcHFycnNzdHV1dnZ3eHh5enp7fHx9fn5/gICBgoKDhISFhoaHiIiJioqLi4yMjY6Oj4+QkJGRkpKTk5SUlJWVlZaWlpeXl5eYmJiYmJmZmZmZmZmZmZmZmZmZmZmZmZmYmJiYmJeXl5aWlpaVlZSUlJOTkpKRkZGQkI+Pjo2NjIyLi4qJiYiIh4aGhYWEg4OCgYGAgH9+fn18fHt7enl5eHh3dnZ1dXR0c3NycnFxcHBvb25ubm1tbWxsbGtra2pqamppaWlpaWlpaGhoaGhoaGhoaGhoaWlpaWlpaWpqampra2trbGxsbW1ubm5vb3BwcHFxcnJzc3R0dXV2d3d4eHl5ent7fHx9fX5/f4CAgYKCg4OEhYWGhoeHiIiJioqLi4yMjY2Njo6Pj5CQkJGRkpKSk5OTlJSUlJWVlZWVlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpWVlZWVlJSUlJOTk5KSkpGRkZCQkI+Pjo6NjYyMi4uKiomJiIiHh4aGhYWEhIOCgoGBgIB/f359fXx8e3t6enl5eHh3d3Z2dXV0dHNzc3JycXFxcHBvb29vbm5ubW1tbW1sbGxsbGxra2tra2tra2tra2tra2tra2xsbGxsbG1tbW1tbm5ub29vcHBwcXFxcnJzc3N0dHV1dnZ3d3d4eHl5enp7e3x9fX5+f3+AgIGBgoKDg4SEhYWGhoeHiIiJiYqKiouLjIyNjY2Ojo6Pj4+QkJCRkZGRkpKSkpKTk5OTk5OTlJSUlJSUlJSUlJSUlJOTk5OTk5OSkpKSkpGRkZGQkJCQj4+Pjo6OjY2MjIyLi4qKiYmJiIiHh4aGhYWEhIODgoKBgYCAf39/fn59fXx8e3t6enl5eHh4d3d2dnV1dXR0dHNzc3JycnFxcXBwcHBvb29vb29uboBYfae1hY+e1Ybljr/TlnvKjr9GwEl8hmuyPltyIGtiUYpIXKhVFKQsoUlAhTmQZ0IpcRZ+bT0zQzaeaERPnoFYf4ftgavNvLiXtPLRyMqCucTCgau9WKBgcG+KSnwqTpY7j2lQRnCQVX2oj1pSp6xIpo2Ui2KHcMR0cqOKlY6HmNWTmpi3zOuV65LkqsLkzI2uzq5zl7SJW4JFemxaaX8nS38qXF+Ta1t1WptWsJeXYaqKqp24gZVlwHzFXpmOxlykiopzq6euYK6afZK9sXqKiXySYI5pi0CCYiNCXm8fOUZNMy5rWzpZZm49pHlKjJV9r7JgiJKevY6HlGWUmX5RmIRWjHKVTl+hblmBXGyjbnptPZN0V11gdmdCTVNsT1wnUWV6TFQmYH6lWXaTcKaTmpesmb+rjpCv0pGckLVqsHaWZZdedI2CY3iCXnZ6YKNUkJJtaJCLZIpyfXiiiUtxiZ1wdWCVg3+Zlne1iKKSqJyquL7Zob68p6GmyI2ZuJO0X6GNV459YqBpY2R5SH2HgnNxllOlZZF2n3+ocaOFe4x1gJqVf5abXpWLc6yTm5F/lJyJwaOUb5zAm5F/couZX55uTWVxY4pSPGBLRmhuWTyEXEl/dmh0XnyBoH5ziYdzeq1xiXV7cJdwdYdYj3iAbJdraqRxcYtmiItWb4iNcHdJgldseD5SdkRVdkZoTGJcQoFheXZzV3Sme6SNeY6ZgYW2k5eGhX+booF4bJOPaJF3bIiNjXpmeZGEcJVwdpt9a4SRfWBvmmqHfk5xoVyPhlGCn3GOpm6Zs4aIrrOuj5GvxJ6VwqF7soC5iYCYm2uDpnFvhpKMa4RtjYR4inSjgm2YcaRtmnuBiISZbZZ+c3ucjId/dIKfmH2EoJyzh52Jh6Wqj3mfj6OUhH1veX9nkW5YfWZgjFtpT31benpjc3dahGmUemZ6i2WRYJhsdZB7W4x6cG2KaYpmfI6Ii159mmd6hpZ8eHN0lHtdcHtta2VkUmxlX2BWfGRXXnFkaFx5Y5VmfIBvj5B2cIWZiYx+dImHfGuEkImPfGp+iYdvfYGEl4aDe3KDi32JenaBh4hodXyDdnJ0emtsh3h1eoKJj4eEd4argJKdoJaYnqCakY2YoaCGh56afpp6gY6bhoCNj3eUdYmKh4qfcZSCjHSbeI6TboGBnXaFfn1rhaGJboGijoh0m5OIj5ymkoiHpIqUpn2ZjIaHfYKAinF/b3eIfXphaZBtboZngHZjfoSIcnB0hHiMZnxrkHtcgneAb3mCZ4R5iWiHd4GIe419e4d2dHyWcHiAg2ZrcIBycWtdanBpZFpjdG15ZXtib2p5gF95jWiBg25+j3pxbI5yhnN9h3l7gX9ph36Hg3R6hZZ9hHGMgICGa4yBgHSIdH91d29/cXyBYH55kHhmfoqDjYxwi4mckn6QkpN9lpWMn4iEjomTlJeEeJeKiox9k3+Xhpl+kI2HgY+If5mIgH2Vi3mAi4d1eoiIk3d7hZeFh3WbhoyVhouOkp+FmouciYWPlYyFfo6Ei4aBkHN7f4CJf3R7eIt2eo5thn93e3mFfHt5b4ZriXhweH16e3p3fXF2g4h5boKKgXd7joR0iXmGdXiOfHVtcod4bnhjfW1xbGlvfHNcfXZheX1ocH5tfHJ5dYJwdH5xcodveoJmdn6EgXB5gHaEfXiAf4OAgHmIdo96fIKBd3Z/goV1c3xreHl/eoRve3B1iX+Db36Sh3KJjn6Fg42WgIt+ipSEin+Il4uFfZCJiIiLiIGSj4yDkYaLjIeDiY2bf4WKe4KIj35+joB5kIJ6k397j4aThYSHhpCVhZGNkIaXhJSGjJiFioaAiY+Dg49+g4iCfoiEhH+IfI13hH6Ed4COgHh9eX59d3x7inCCenJ+doZ9fX19dniNg3l5hH+DgoWBeX97g4N2e3h7dHtteoBwdHV1dXNyfHJvcnx0eXdseXt6d3Nxcnt7d2p5dnx2d3l+cHV9e26DgXR/d4B9hXSBgYOAfXd5eYl9enR6gXGAd3t2dXR9hXOBd3SCdn+Jf3t+gHuEhoOMg3SHgY2EfI1+hn+KgoWJj3uOhYeDiImQgJKLgIuJgpR+kYaBioV8jYOAiYh/gYV/jISHinqJhomTg4mFjoaLloGLjY+DhJKIiYqMiYiFhYSHi4qIhIOBjIOBj32Mh4V8fYqAinx/g4d4hnp4gnyId352iXiGcoh4gIV7hHmIfX6AiX90iIKEdn9+fX99dYF3eniBe3B7dYJ3cX95bYBwgHZ1eXx4d3N0fXhufXB4fHV9bH5yeHt5coB3eXp4gXZ6fIN9dIJ7e3h9fYF5en57fXV4f3Z0e356dnh6gXN5hnV8hnd/eIR9gHt5gX2HgYN2jnl/hXyGgIGIgIGJg4KNgIKHhIqFi4p9iIWJi4CNgYWAho2Dgn+HgIeHgIeChIaIhYKFjIiJiIeJf4iJjpCEgo6Ei4OQiIOBkIqGgIaShYaBi4qFiIWFjYCJgYeDhoiHf3+AgIiGfIB7inqAfIOBgISDfX2FfoJ8f4p9iHt+h4J6hYN8fHuChnp/e3x8d31/gHd6fnt7eXqBeHh1fnt7e3h0enl/c3p7cntxeIB1enZzeYF2dX19d3x4gHd7gHh7gHZ5e4N2e3t7fHt8d3N8gHZ7enl9fHR9eoF1f3t7gH17eHx+gX19g3l+fIJ8gHl+hYKBfoN+gIOBhoSAhoKGf4mAg4eGhISDhYSFfoGKhIKHgX+FhISCioGEhICHiYSKgYSJhIeIjIKIiIWEioeEioiFhImGiIeIh4eKhYaHhIaJh4mLgIiFhIaHhYh/gYh/iXyChYGHfoGCgYGDhYGCf4GIgn+BfoiBfoaDeYR/hIR8fIWBeIGCfH9+fn5+gn18fX16gXt5gn17d396fXp3e352eHx7enl3dnt+d3x5e4B8g4J/gX+Dgn9+h32Dgn+FhH1/foSBgn2DfICBhHyBgn19gISCfnyCf3yAgYR8hH2AfX2Cf3+CfYB+gIR+e3+CgYKCf4GAgoN9gIKDg3+Af4CBgoGDf4F/foB8fYKEf316gIN+g39+f36Af32AgoWBeYR7gIOCf3yAgH+Df35/gYV+gIF+hH6DgIN9hH2ChX+CgIB9gYKBf32AfIR/e36EfX2Agn2BgH57gn+Ef32Ag3+EfIN/f4N8gYKEfYCAf4GAgYSCfIJ/gn6Df4CEgHyDfoR9f4V+gH9+fYKAf3+Ee4F9gn97gX2EgXuBg3yBgIGBgoF9g4J+f4SAgYN+gX5+g3+DgX59gYCBgoF/foJ/gYCBgICAf36Af4KAgX98gYCAgH58gn+Bf4F9gYCBgoB9gIGCgIV9f4OBgIKAgIF/fYV/f4CDfoJ8g32BgYCAfX2DfYJ/gH6AgYN9foN+gX2CgHx/goJ/f4B8g3+AgX+CgX+Af4OCf4KBfoGAhX9/f4KAgX+AfoCAgYB+f3+Bfn+Df398gn+Agn6Bf4J+f4J/gX+AfoF/gIGBf4GAgn6Cf4J+gn+DgH+Bf4GBf4F/gYCBhHyAf3+Bf4GBfYCBf35+f4N/fIKAfoCDgX5+g4B/gIN9gn+Cf3+CgYGAgX2Bgn+AgIF+goCCf4F/foGEgIB8gIOAfYF/gH+AgX5/gn9+gIB+g39/gH9/gYF/gYF/goCBf4GAgYF/gYGAgn+Bf32Agn+AgIF+gICAgn6Cf39/gX6Agn+AgH9/gYF/f32Bgn9/gIF/f4J+gICAgYF/gIGAg36DgICBfoGAgIKCfn6DgH2Ag39/gYB+f4GBf4B/f4B/g36BfoCBf4CBf3+Cf36BfoCCfoCBgYCAf4GBgn9/gIJ/goF/gICAfoGDgX6Bf3+CgH6Bfn+Af4J/gX2BgH9/gn6Af4GAgn9/gH+Af4N/gH+BgX+AfoGDfoJ/gH+AgH+BgIGAgX+BfoF/gYCBf4CAfn+BgIB/gX1/gIJ/foCAgIGAf4CAfoGBgX+BgIB/gIKAf4CBgYB+gn+BgYF/f3+CgIF/gIB/goCAfoCAgYCBf39/gH+BgH+AgH6AgX+Af4CAgn6Bf3+AgoGBf4GBgX+AgICBgn+Af4CDf4CAgYB/f4CAgYF+gIB+gICAgoB/gH6Bf3+AgoB+gICAgH6AgICBf4F+gYB/gYGBf3+CgX+Bf4GCf3+Cf4J/f4GAgIKAfYCAgYF+gICAf4CAgICBf4F+gYB/gIF/gIF/gH+BgX+Bf4CAgYCCf4CAgICAgIF/goB/goCAf4CCgIB/gX+BgH+Cf4B/gICAfn+AgH+Af4CAgH+AgYCBf3+Bf4CAgYF/gICBgH+Bf4KAgH+Af3+AgYCBgX+Af4CBgYCAf3+AgX+Bf4F/f4CAgn9/gH6AgICBgX6AgYCBgX9/gYGBf3+BgIGAgX+AgIF/gH+AgICBgX+A' }, source: `from audio import *

class Breakbeat(Scene):
    """loop.wav (see Audio files) is one bar: kick, hat, snare, hat, 0.15 s each."""

    def construct(self):
        bar = Sample("loop.wav")
        kick, hat, snare = bar[0:0.15], bar[0.15:0.3], bar[0.3:0.45]
        self.play(bar * 2, track="drums")
        fill = kick >> kick >> snare >> hat.speed(1.5) >> hat.speed(1.5) >> snare.reverse()
        self.play(fill, track="drums")
        self.play(bar.speed(0.8) * 2, track="drums")
        self.add(bar.reverse().pan(0.7), at=0.6, track="echo", gain=-12)
        for k, pitch in enumerate(["C2", "C2", "Eb2", "G1", "Bb1", "C2"]):
            self.add(Note(pitch, 0.25, "pluck"), at=k * 0.6, track="bass", gain=-6)
        self.track("drums").fx(LowShelf(120, 3), Compressor(-16, 3, makeup=2))
        self.track("echo").fx(Delay(0.15, 0.4, 0.5))
        self.master.fx(Limiter(-1))
` },
  { id: 'neural-narrator', title: 'Neural narrator', tags: ['voice', 'neural', 'music'], neural: 'Kitten TTS nano', description: 'A neural voice over a soft chord. It downloads once, after you confirm; change the voice to "pico:en-US" to stay offline.', source: `from audio import *

class Narrator(Scene):
    """Neural voices download on demand (about 46 MB) and are not part of offline use."""

    def construct(self):
        bed = (Note("D3", 7, "pad") + Note("A3", 7, "pad") + Note("F#4", 7, "pad")).gain(-16).fade_out(2)
        self.add(bed, at=0, track="music")
        self.wait(0.8)
        self.say("Some stories need a warmer voice.", voice="kitten:Bella")
        self.wait(0.3)
        self.say("This one downloads once, after you say yes.", voice="kitten:Bella")
        self.track("music").duck(under="voice", amount=-8)
        self.master.fx(Limiter(-1))
` }
];
const AudioExamples = { catalog, defaultSource: catalog[0].source };
if (typeof module !== 'undefined') module.exports = AudioExamples;
else globalThis.AudioExamples = AudioExamples;
})();
