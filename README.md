# Filterlab: digital filter design toolkit

A numpy-only Python library and a single-file interactive app for designing FIR and IIR filters, inspecting them, and seeing what fixed-point arithmetic does to them.

| | |
|---|---|
| FIR | Windowed-sinc (rectangular, Hann, Hamming, Blackman, Kaiser), Parks-McClellan / Remez exchange |
| IIR | Butterworth, Chebyshev I, Chebyshev II. Analog prototype, band transform, bilinear transform, biquad (SOS) output |
| Analysis | Bode data, group delay, poles and zeros, spec measurement |
| Quantization | Qm.n formats, coefficient rounding (FIR, biquad cascade, single direct form), bit-true fixed-point simulation, round-off noise theory |

## Layout

```
dsp/                 the library (fir, remez, iir, analysis, quant)
tests/               pytest suite against scipy, plus the JS cross-check
web/                 the interactive app: dsp.js (port of dsp/), app.js, style.css, build.py -> index.html
examples/demo.py     plots every method and the quantization sweep
```

## Python

```python
from dsp import *

# Equiripple low-pass: 1 dB ripple, 60 dB stopband, 1000 -> 1500 Hz at fs = 8 kHz
dp = (10**(1/20) - 1) / (10**(1/20) + 1); ds = 10**(-60/20)
h = remez(37, [0, 1000, 1500, 4000], [1, 0], weight=[1/dp, 1/ds], fs=8000)

# Chebyshev I, order from the spec, as biquads
n = min_order("cheby1", "lowpass", [1000], [1500], 1, 60, fs=8000)
d = design_iir("cheby1", "lowpass", n, 1000, fs=8000, rp=1)      # d["sos"], d["b"], d["a"], d["z"], d["p"]

# What does 10-bit arithmetic do to it?
fmt, sq, gain = quantize_sos(d["sos"], 10)                      # per-section peak scaling + shared Qm.n format
f, H = sos_freqz(sq, 2048, fs=8000); H *= gain
```

Conventions: edges are in Hz (pass `fs`), `sos` rows are `[b0 b1 b2 1 a1 a2]`, Qm.n means 1 sign bit + m integer bits + n fraction bits.

## Interactive app

Open `web/index.html` in a browser (no server, no network). Pick a method and response type, drag the P and S tabs on the magnitude plot to move the band edges, and the filter is redesigned live. The Quantization tab shows the response and poles before and after rounding, a word-length sweep, and measured against predicted round-off noise. "Copy Python" reproduces the current design with this library.

Rebuild after editing the sources: `npm run build` (or `python web/build.py`).

To view it in VS Code's Simple Browser, run `npm run serve` and open `http://localhost:8000/`.

## Tests

Needs Python 3 with numpy and scipy, Node 22 or newer, and Edge or Chrome. No npm packages.

```
npm run test:py      # pytest: library vs scipy, noise vs theory
npm run test:js      # export_reference.py, then cross_check.js: JS port vs Python at machine precision
npm run test:ui      # rebuild index.html, ui_sweep.js (every method x response type meets spec), ui_shots.js
npm run test:all     # all of the above, in order; stops at the first failure
```

**Python launcher.** `run_tests.js` uses the first of `python`, `py -3`, `python3` that can import numpy.
On the development machine (Windows 11) that is `python` (3.12); `python3` there is the Microsoft Store stub.
Run the scripts directly with the same launcher, e.g. `python -m pytest tests -q`.

**Browser.** The UI tests drive headless Edge or Chrome over the DevTools protocol (`tests/browser.js`).
Set `EDGE_PATH` or `CHROME_PATH` to choose one; otherwise the usual install locations are searched.
Screenshots go to `shots/` (light and dark, 1440 and 390 px wide). Both UI scripts exit non-zero on a missed
spec, a failed interaction check or any console error.

## Design notes and limits

- **Remez** supports odd lengths (type I) only, which covers low-, high-, band-pass and band-stop. Even lengths and differentiators/Hilbert transformers (types II-IV) are not implemented.
- **Window method** sizes: Kaiser's formula is an estimate, so the app adds taps until the measured response meets the spec. Fixed windows have a hard attenuation floor (Hamming about 53 dB); the app says so rather than adding taps forever.
- **Butterworth** is designed so the response is exactly -Rp dB at the passband edge (`butter_edge_rp`), which makes the spec meaningful; the textbook -3 dB cutoff is the default in the library.
- **Biquad scaling**: narrow-band filters have numerator coefficients near 1e-4, which a shared fixed-point format rounds to zero. `scale_sos` gives each section unit peak gain and returns the leftover gain as one output stage, as fixed-point code does.
- **Noise model**: direct-form-I biquads with one rounding per section; each rounding error is shaped by that section's own `1/A(z)` and then by the remaining sections. FIR: one rounding at the output. Measured against theory in the tests (within 1 to 2 dB).
- Fixed-point simulation in the browser uses doubles, exact up to 2^53, so signal and coefficient words are limited to 20 and 24 bits there.
