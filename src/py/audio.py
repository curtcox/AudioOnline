"""audio-lite: describe sound in Python; the Audio Online renderer turns the description into samples.

A Scene's construct() places clips on tracks. Clips are immutable descriptions (sources plus
operations); nothing is synthesized in Python. run_scene() returns a JSON timeline that the
deterministic JavaScript renderer realizes. Times are in seconds.
"""
import json
import sys
import traceback

__all__ = [
    "Scene", "Clip", "Track", "Placement", "Envelope", "adsr",
    "Sine", "Square", "Saw", "Triangle", "Noise", "Silence", "Samples",
    "Note", "Drum", "abc", "zzfx", "sfxr", "pattern", "INSTRUMENTS", "DRUMS",
]

INSTRUMENTS = ("sine", "square", "piano", "organ", "pad", "bell", "pluck")
DRUMS = ("bd", "sn", "hh", "oh", "cp", "lt", "mt", "ht", "rim", "cb", "cy")

USER_FILE = "scene.py"
_buffers = []
_buffer_bytes = 0
MAX_BUFFER_BYTES = 64 * 1024 * 1024


def _number(value, name, low=None, high=None):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise TypeError(f"{name} must be a number, not {type(value).__name__}")
    value = float(value)
    if value != value or value in (float("inf"), float("-inf")):
        raise ValueError(f"{name} must be finite")
    if low is not None and value < low:
        raise ValueError(f"{name} must be at least {low:g}")
    if high is not None and value > high:
        raise ValueError(f"{name} must be at most {high:g}")
    return value


def _user_line():
    """The line in the user's scene.py that led here, for lanes and error markers."""
    frame = sys._getframe(1)
    while frame is not None and frame.f_code.co_filename != USER_FILE:
        frame = frame.f_back
    return frame.f_lineno if frame is not None else None


class Envelope:
    """Gain over time. Envelope([(0, 0), (0.1, 1), (1, 0)]) interpolates linearly; see also adsr()."""

    def __init__(self, points):
        pts = [(_number(t, "envelope time", 0), _number(v, "envelope level")) for t, v in points]
        if not pts:
            raise ValueError("an Envelope needs at least one (time, level) point")
        if any(b[0] < a[0] for a, b in zip(pts, pts[1:])):
            raise ValueError("Envelope times must not decrease")
        self._json = {"kind": "points", "points": [list(p) for p in pts]}

    def __repr__(self):
        return f"Envelope({self._json['points']!r})"


class _ADSR(Envelope):
    def __init__(self, attack, decay, sustain, release):
        self._json = {"kind": "adsr", "a": _number(attack, "attack", 0), "d": _number(decay, "decay", 0),
                      "s": _number(sustain, "sustain", 0, 1), "r": _number(release, "release", 0)}

    def __repr__(self):
        j = self._json
        return f"adsr({j['a']:g}, {j['d']:g}, {j['s']:g}, {j['r']:g})"


def adsr(attack, decay, sustain, release):
    """Attack, decay and release in seconds; sustain is a level from 0 to 1. Release ends with the clip."""
    return _ADSR(attack, decay, sustain, release)


class Clip:
    """An immutable sound description. Operations return new clips.

    a + b mixes (overlays from time 0), a >> b plays b after a, a * n repeats a n times.
    clip[0.5:1.5] slices by seconds.
    """

    def __init__(self, node, duration, label):
        self._node = node
        self.duration = duration  # seconds, or None for generators without .dur()
        self._label = label

    def __repr__(self):
        return self._label

    def _wrap(self, op, duration=None, label=None, **fields):
        node = {"op": op, "of": self._node}
        node.update(fields)
        return Clip(node, self.duration if duration is None else duration, label or self._label)

    def _finite(self, action):
        if self.duration is None:
            raise ValueError(f"give {self._label} a duration with .dur(seconds) before {action}")
        return self.duration

    def dur(self, seconds):
        """Limit (or pad with silence) to exactly this many seconds."""
        s = _number(seconds, "duration", 0)
        return self._wrap("dur", duration=s, seconds=s)

    def gain(self, db):
        return self._wrap("gain", db=_number(db, "gain (dB)", -200, 60))

    def env(self, envelope):
        if not isinstance(envelope, Envelope):
            raise TypeError("env() needs an Envelope or adsr(...)")
        return self._wrap("env", env=envelope._json)

    def fade_in(self, seconds):
        return self._wrap("fade", **{"in": _number(seconds, "fade-in", 0), "out": 0})

    def fade_out(self, seconds):
        return self._wrap("fade", **{"in": 0, "out": _number(seconds, "fade-out", 0)})

    def _filter(self, kind, freq, q):
        return self._wrap("filter", type=kind, freq=_number(freq, "filter frequency", 1), q=_number(q, "Q", 0.01, 100))

    def lowpass(self, freq, q=0.7071067811865476):
        return self._filter("lowpass", freq, q)

    def highpass(self, freq, q=0.7071067811865476):
        return self._filter("highpass", freq, q)

    def bandpass(self, freq, q=1.0):
        return self._filter("bandpass", freq, q)

    def reverse(self):
        self._finite("reversing it")
        return self._wrap("reverse")

    def loop(self, count):
        if isinstance(count, bool) or not isinstance(count, int) or count < 0:
            raise ValueError("loop() needs a whole number of repeats")
        return self._wrap("loop", duration=self._finite("looping it") * count, count=count)

    def __mul__(self, count):
        return self.loop(count)

    def __getitem__(self, key):
        if not isinstance(key, slice) or key.step is not None:
            raise TypeError("slice clips by seconds, like clip[0.5:2]")
        start = _number(key.start or 0, "slice start", 0)
        end = None if key.stop is None else _number(key.stop, "slice end", 0)
        if end is None:
            length = self._finite("slicing it without an end") - start
        else:
            length = end - start if self.duration is None else min(end, self.duration) - start
        return self._wrap("slice", duration=max(0.0, length), start=start, end=end)

    def __add__(self, other):
        if not isinstance(other, Clip):
            return NotImplemented
        items = []
        for c in (self, other):
            items.extend(c._node["items"] if c._node["op"] == "mix" else [c._node])
        known = [c.duration for c in (self, other)]
        duration = None if None in known else max(known)
        return Clip({"op": "mix", "items": items}, duration, f"{self._label} + {other._label}")

    def __rshift__(self, other):
        if not isinstance(other, Clip):
            return NotImplemented
        first, second = self._finite("sequencing it"), other._finite("sequencing it")
        items = []
        for c in (self, other):
            items.extend(c._node["items"] if c._node["op"] == "seq" else [c._node])
        return Clip({"op": "seq", "items": items}, first + second, f"{self._label} >> {other._label}")


def _osc(wave, name):
    def make(freq, phase=0.0):
        node = {"op": "osc", "wave": wave, "freq": _number(freq, "frequency", 0), "phase": _number(phase, "phase", 0, 1)}
        return Clip(node, None, f"{name}({freq:g})")
    make.__name__ = name
    make.__doc__ = f"A {wave} oscillator at freq Hz. Infinite until .dur(seconds)."
    return make


Sine = _osc("sine", "Sine")
Square = _osc("square", "Square")
Saw = _osc("saw", "Saw")
Triangle = _osc("triangle", "Triangle")


def Noise(color="white", seed=None):
    """White, pink or brown noise. Unseeded noise derives its seed from the Scene's seed."""
    if color not in ("white", "pink", "brown"):
        raise ValueError("Noise color must be 'white', 'pink' or 'brown'")
    if seed is not None and (isinstance(seed, bool) or not isinstance(seed, int)):
        raise TypeError("Noise seed must be a whole number")
    node = {"op": "noise", "color": color}
    if seed is not None:
        node["seed"] = seed & 0xFFFFFFFF
    return Clip(node, None, f"Noise({color!r})")


def Silence(seconds):
    s = _number(seconds, "silence", 0)
    return Clip({"op": "silence", "seconds": s}, s, f"Silence({s:g})")


def Samples(data, rate):
    """Raw audio: a sequence of floats in −1…1 (mono), or a numpy array shaped (frames,) or (frames, 2)."""
    global _buffer_bytes
    rate = int(_number(rate, "sample rate", 8000, 192000))
    try:
        import numpy as np
    except ImportError:
        np = None
    if np is not None and isinstance(data, np.ndarray):
        array = np.asarray(data, dtype=np.float32)
        if array.ndim == 2 and array.shape[1] in (1, 2):
            channels = [np.ascontiguousarray(array[:, c]) for c in range(array.shape[1])]
        elif array.ndim == 1:
            channels = [np.ascontiguousarray(array)]
        else:
            raise ValueError("Samples arrays must be shaped (frames,) or (frames, 2)")
        if not all(np.isfinite(c).all() for c in channels):
            raise ValueError("Samples contain NaN or infinite values")
        payload = [c.tobytes() for c in channels]
        frames = len(channels[0])
    else:
        from array import array as _array
        values = _array("f", [_number(v, "sample") for v in data])
        payload, frames = [values.tobytes()], len(values)
    size = sum(len(p) for p in payload)
    if _buffer_bytes + size > MAX_BUFFER_BYTES:
        raise ValueError("Samples are limited to 64 MiB per scene")
    _buffer_bytes += size
    _buffers.append({"rate": rate, "frames": frames, "channels": payload})
    node = {"op": "buffer", "ref": len(_buffers) - 1}
    return Clip(node, frames / rate, f"Samples({frames} frames @ {rate} Hz)")


def _measure(node):
    """Length in seconds from the JavaScript engines, so the cursor matches the rendered audio."""
    import _audio_js
    from pyodide.ffi import JsException
    try:
        return float(_audio_js.measure(json.dumps(node)))
    except JsException as exc:
        message = str(exc)
        raise ValueError(message[7:] if message.startswith("Error: ") else message) from None


def _engine_clip(node, label):
    node["line"] = _user_line()
    return Clip(node, _measure(node), label)


def _seed(seed):
    if isinstance(seed, bool) or not isinstance(seed, int):
        raise TypeError("seed must be a whole number")
    return seed & 0xFFFFFFFF


_NOTES = {"c": 0, "d": 2, "e": 4, "f": 5, "g": 7, "a": 9, "b": 11}


def _frequency(pitch):
    if isinstance(pitch, str):
        import re
        m = re.fullmatch(r"([a-gA-G])([#b]?)(-?\d)?", pitch.strip())
        if not m:
            raise ValueError(f"{pitch!r} is not a note name like 'C4', 'F#3' or 'Bb2'")
        midi = 12 * (int(m.group(3) or 4) + 1) + _NOTES[m.group(1).lower()] + {"#": 1, "b": -1, "": 0}[m.group(2)]
    elif isinstance(pitch, int) and not isinstance(pitch, bool):
        midi = pitch
    else:
        raise TypeError("pitch is a note name like 'C4' or a MIDI number")
    if not 0 <= midi <= 135:
        raise ValueError("pitch is outside the MIDI range")
    return 440.0 * 2 ** ((midi - 69) / 12)


def Note(pitch, seconds=0.5, instrument="piano", velocity=0.8):
    """One note on a built-in instrument; the clip includes the instrument's release."""
    if instrument not in INSTRUMENTS:
        raise ValueError(f"instrument must be one of {', '.join(INSTRUMENTS)}")
    node = {"op": "note", "instrument": instrument, "freq": _frequency(pitch), "seconds": _number(seconds, "note length", 0, 300),
            "velocity": _number(velocity, "velocity", 0, 1), "seed": 0}
    return _engine_clip(node, f"Note({pitch!r}, {instrument})")


def Drum(name, velocity=1.0):
    """One hit from the built-in kit: bd sn hh oh cp lt mt ht rim cb cy."""
    if name not in DRUMS:
        raise ValueError(f"drum must be one of {' '.join(DRUMS)}")
    return _engine_clip({"op": "drum", "name": name, "velocity": _number(velocity, "velocity", 0, 1), "seed": 0}, f"Drum({name!r})")


def abc(text, instrument=None, seed=0):
    """An ABC notation tune. Without instrument, %%MIDI program choices map to the built-in instruments."""
    if not isinstance(text, str):
        raise TypeError("abc() needs the tune as text")
    if instrument is not None and instrument not in INSTRUMENTS:
        raise ValueError(f"instrument must be one of {', '.join(INSTRUMENTS)}")
    title = next((line[2:].strip() for line in text.splitlines() if line.startswith("T:")), "tune")
    return _engine_clip({"op": "abc", "text": text, "instrument": instrument, "seed": _seed(seed)}, f"abc({title[:40]!r})")


def zzfx(params, seed=0):
    """A ZzFX sound from its parameter list; None stands for a blank (default) value."""
    if not isinstance(params, (list, tuple)) or len(params) > 21:
        raise TypeError("zzfx() needs a list of up to 21 numbers")
    values = [None if v is None else _number(v, "ZzFX value") for v in params]
    return _engine_clip({"op": "zzfx", "params": values, "seed": _seed(seed)}, "zzfx(...)")


def sfxr(sound, seed=0):
    """An sfxr sound: a preset name such as "pickupCoin", a jsfxr sound code, or a parameter dict."""
    node = {"op": "sfxr", "seed": _seed(seed)}
    if isinstance(sound, dict):
        node["params"] = sound
    elif isinstance(sound, str) and sound in ("pickupCoin", "laserShoot", "explosion", "powerUp", "hitHurt", "jump", "blipSelect", "synth", "tone", "click", "random"):
        node["preset"] = sound
    elif isinstance(sound, str):
        node["b58"] = sound
    else:
        raise TypeError("sfxr() needs a preset name, a sound code or a dict of parameters")
    return _engine_clip(node, f"sfxr({sound if isinstance(sound, str) else '{...}'!s:.30})")


def pattern(text, bpm=120, cycles=1, instrument="pluck", seed=0):
    """A rhythm in mini-notation; one cycle is four beats. Drum names play the kit, note names the instrument."""
    if not isinstance(text, str):
        raise TypeError("pattern() needs the pattern as text")
    if isinstance(cycles, bool) or not isinstance(cycles, int):
        raise TypeError("cycles must be a whole number")
    node = {"op": "pattern", "text": text, "bpm": _number(bpm, "bpm", 20, 400), "cycles": cycles, "instrument": instrument, "seed": _seed(seed)}
    return _engine_clip(node, f"pattern({text[:40]!r})")


class Placement:
    """A clip at a time on a track. Methods adjust this placement and return it for chaining."""

    def __init__(self, clip, at, track, gain, pan, line):
        self.clip, self.at, self.track, self.line = clip, at, track, line
        self._gain, self._pan, self._in, self._out = gain, pan, 0.0, 0.0

    @property
    def end(self):
        return self.at + self.clip.duration

    def gain(self, db):
        self._gain += _number(db, "gain (dB)", -200, 60)
        return self

    def pan(self, position):
        self._pan = _number(position, "pan", -1, 1)
        return self

    def fade_in(self, seconds):
        self._in = _number(seconds, "fade-in", 0)
        return self

    def fade_out(self, seconds):
        self._out = _number(seconds, "fade-out", 0)
        return self

    def _json(self):
        node = self.clip._node
        if self._in or self._out:
            node = {"op": "fade", "of": node, "in": self._in, "out": self._out}
        return {"clip": node, "at": self.at, "track": self.track, "gain": self._gain, "pan": self._pan,
                "line": self.line, "label": self.clip._label[:80]}


class Track:
    """Settings for every clip placed on one track."""

    def __init__(self, name):
        self.name = name
        self._gain = 0.0
        self._mute = False

    def gain(self, db):
        self._gain = _number(db, "track gain (dB)", -200, 60)
        return self

    def mute(self, muted=True):
        self._mute = bool(muted)
        return self

    def _json(self):
        return {"gain": self._gain, "mute": self._mute}


class Scene:
    """Subclass and implement construct(). self.time is a cursor that play() and wait() advance."""

    sample_rate = None   # 22050, 32000, 44100 or 48000; None uses the editor setting
    channels = None      # 1 or 2; None uses the editor setting
    seed = 0             # all unseeded randomness derives from this
    length = None        # seconds; None ends at the last clip

    def __init__(self):
        self._placements = []
        self._time = 0.0
        self._tracks = {}
        self.master = Track("master")

    @property
    def time(self):
        return self._time

    def construct(self):
        pass

    def track(self, name):
        if not isinstance(name, str) or not name or len(name) > 64:
            raise ValueError("track names are 1–64 characters")
        if name not in self._tracks:
            self._tracks[name] = Track(name)
        return self._tracks[name]

    def add(self, clip, at=None, track="main", gain=0, pan=0):
        """Place clip at a time (default: self.time) without moving the cursor."""
        if not isinstance(clip, Clip):
            raise TypeError(f"add() needs a clip, not {type(clip).__name__}")
        if clip.duration is None:
            raise ValueError(f"give {clip._label} a duration with .dur(seconds) before adding it")
        at = self._time if at is None else _number(at, "at", 0)
        self.track(track)
        placement = Placement(clip, at, track, _number(gain, "gain (dB)", -200, 60), _number(pan, "pan", -1, 1), _user_line())
        self._placements.append(placement)
        return placement

    def play(self, clip, **options):
        """Place clip at the cursor and move the cursor to its end."""
        placement = self.add(clip, **options)
        self._time = max(self._time, placement.end)
        return placement

    def wait(self, seconds=1.0):
        self._time += _number(seconds, "wait", 0)
        return self

    def _timeline(self, rate, channels):
        return {
            "format": "audio-timeline", "version": 1, "sampleRate": rate, "channels": channels,
            "seed": int(self.seed) & 0xFFFFFFFF,
            "length": None if self.length is None else _number(self.length, "length", 0),
            "placements": [p._json() for p in self._placements],
            "tracks": {name: t._json() for name, t in self._tracks.items()},
            "master": self.master._json(),
        }


def _scenes(namespace):
    return [v for v in namespace.values()
            if isinstance(v, type) and issubclass(v, Scene) and v is not Scene and v.__module__ == "__main__"]


def _error(exc):
    line = getattr(exc, "lineno", None) if isinstance(exc, SyntaxError) and exc.filename == USER_FILE else None
    frames = [f for f in traceback.extract_tb(exc.__traceback__) if f.filename == USER_FILE]
    if line is None and frames:
        line = frames[-1].lineno
    detail = "".join(traceback.format_list(frames)) + "".join(traceback.format_exception_only(type(exc), exc))
    return {"message": f"{type(exc).__name__}: {exc}", "line": line, "traceback": detail}


def run_scene(source, settings_json):
    """Runs the user's source and returns {timeline, buffers, scenes, scene} or {error}."""
    global _buffer_bytes
    settings = json.loads(settings_json)
    _buffers.clear()
    _buffer_bytes = 0
    namespace = {"__name__": "__main__", "__file__": USER_FILE}
    try:
        exec(compile(source, USER_FILE, "exec"), namespace)
        scenes = _scenes(namespace)
        names = [s.__name__ for s in scenes]
        if not scenes:
            return {"error": {"message": "Define a class that extends Scene, with a construct() method.", "line": None, "traceback": ""}, "scenes": []}
        cls = scenes[names.index(settings["scene"])] if settings.get("scene") in names else scenes[0]
        scene = cls()
        scene.construct()
        rate = cls.sample_rate or settings["sampleRate"]
        channels = cls.channels or settings["channels"]
        if rate not in (22050, 32000, 44100, 48000):
            raise ValueError("sample_rate must be 22050, 32000, 44100 or 48000")
        if channels not in (1, 2):
            raise ValueError("channels must be 1 or 2")
        timeline = scene._timeline(rate, channels)
        buffers = list(_buffers)
        return {"timeline": json.dumps(timeline, allow_nan=False), "buffers": buffers, "scenes": names, "scene": cls.__name__}
    except BaseException as exc:  # noqa: BLE001 - every failure is reported to the editor
        return {"error": _error(exc), "scenes": [s.__name__ for s in _scenes(namespace)]}
