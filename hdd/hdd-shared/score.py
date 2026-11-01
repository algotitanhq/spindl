"""Score for the 3.5" 7200 rpm drive tour: no music. The spindle's hum is the bed: its fundamental is the platter's
rotation frequency (rpm / 60, so 120 Hz at speed), rising through the spin-up and falling through the coast-down,
with the harmonics a small speaker can play and a breath of air that grows with the square of the speed. On top,
three accents only: a small dry click when the heads leave the ramp and at each seek, and the tac of the heads
landing back in the ramp's detent. Every time and the speed curve come from sound.json, written from the drive's
plan (node gen-timeline.mjs), so nothing here can drift from the picture.

    python run_sfx.py hdd/hdd-shared/score.py
"""

import json
import math
import os
import random

from sfx.dsp import svf
from sfx.synth import SR, bandnoise, click

TIMELINE = "../hdd-film/timeline.json"
SOUND = os.path.join(os.path.dirname(os.path.abspath(__file__)), "../hdd-film/sound.json")
OUT = os.path.join(os.environ.get("TEARDOWN_OUT", "teardown-out"), "hdd-score.wav")
# a steady drone reads louder than music at the same LUFS: master a little lower than the kit's −14
TARGET_LUFS = -16.0
SEED = 7


def rpm_at(snd, t):
    r = snd["rpm"]
    x = t * r["rate"]
    i = min(len(r["samples"]) - 2, max(0, int(x)))
    k = min(1.0, max(0.0, x - i))
    return r["samples"][i] * (1 - k) + r["samples"][i + 1] * k


def hum(snd, dur):
    """The spindle: harmonics of the rotation frequency f = rpm/60, plus air noise ∝ (rpm/7200)²."""
    n = int(dur * SR)
    air = bandnoise(n, lambda k: 2600, q=0.6)
    out = [0.0] * n
    ph = 0.0
    for k in range(n):
        t = k / SR
        rpm = rpm_at(snd, t)
        f = rpm / 60.0
        s = rpm / 7200.0
        ph += 2 * math.pi * f / SR
        # 1st (120 Hz) to 6th harmonic; the 4th (480 Hz) is the motor's commutation, a touch stronger
        tone = (math.sin(ph) * 0.55 + math.sin(2 * ph) * 0.4 + math.sin(3 * ph) * 0.22 + math.sin(4 * ph) * 0.3 + math.sin(6 * ph) * 0.08)
        out[k] = s * tone * 0.5 + s * s * air[k] * 0.35
    return out


def tac(level=1.0):
    """Heads into the ramp's detent: a short plastic knock."""
    n = int(0.09 * SR)
    out = []
    for k in range(n):
        t = k / SR
        s = math.sin(2 * math.pi * 1150 * t) * math.exp(-t / 0.006) * 0.7
        s += math.sin(2 * math.pi * 430 * t) * math.exp(-t / 0.014) * 0.6
        s += random.uniform(-1, 1) * math.exp(-t / 0.0012) * 0.8
        out.append(level * s)
    return out


def score(mix, tl):
    with open(SOUND, encoding="utf8") as f:
        snd = json.load(f)
    dur = tl["duration"]
    mix.put(0, hum(snd, dur), 0.5)
    for e in snd["loads"]:
        mix.put(e["t"], click(3200, 0.03), 0.10)
    for e in snd["seeks"]:
        # the seek's two pushes: the coil kicks at the start, brakes at the middle of the move
        mix.put(e["t"], click(2600, 0.035), 0.16)
        mix.put(e["t"] + (e["t1"] - e["t"]) * 0.47, click(2100, 0.03), 0.07)
    for e in snd["retracts"]:
        mix.put(e["t1"] - 0.02, tac(), 0.3)
    _ = svf
