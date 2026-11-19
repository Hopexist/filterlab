# Filterlab: digital filter design toolkit

A numpy-only Python library and a single-file interactive app for designing FIR and IIR filters, inspecting them, and seeing what fixed-point arithmetic does to them.

| | |
|---|---|
| FIR | Windowed-sinc (rectangular, Hann, Hamming, Blackman, Kaiser); Parks-McClellan / Remez exchange for all four linear-phase types: odd and even lengths, Hilbert transformers, differentiators |
| IIR | Butterworth, Chebyshev I, Chebyshev II, elliptic, each with a minimum-order estimate. Analog prototype, band transform, bilinear transform, biquad (SOS) output |
| Analysis | Bode data, group delay, poles and zeros, spec measurement |
| Quantization | Qm.n formats, coefficient rounding (FIR, biquad cascade, single direct form), bit-true fixed-point simulation with saturate or wrap overflow, input headroom and error-feedback rounding, round-off noise theory |

## Layout

```
dsp/                 the library (fir, remez, iir, analysis, quant)
tests/               pytest suite against scipy, plus the JS cross-check
web/                 the interactive app: dsp.js (port of dsp/), app.js, style.css, build.py -> index.html
examples/demo.py     plots every method, types III/IV, coefficient rounding and error feedback (gallery.png)
docs/theory.md       order estimates, FIR types, the scaling definition, the noise model and error feedback
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

# Even length (type II), Hilbert transformer (type III/IV), elliptic
h2 = remez(36, [0, 1000, 1500, 4000], [1, 0], weight=[1/dp, 1/ds], fs=8000)
hh = remez(31, [200, 3800], [1], fs=8000, kind="hilbert")
e = design_iir("ellip", "lowpass", min_order("ellip", "lowpass", [1000], [1500], 1, 60, fs=8000), 1000, fs=8000, rp=1, rs=60)

# Bit-true cascade: wrap-around overflow, 2 bits of input headroom, error feedback
import numpy as np; x = 0.5 * np.sin(2 * np.pi * 300 / 8000 * np.arange(4000))
y = simulate_sos_fixed(sq, x, fmt, QFormat(0, 15), overflow="wrap", headroom_bits=2, error_feedback=True) * gain * 2**2
```

Conventions: edges are in Hz (pass `fs`), `sos` rows are `[b0 b1 b2 1 a1 a2]`, Qm.n means 1 sign bit + m integer bits + n fraction bits.

## Python and JavaScript names

`web/dsp.js` is a line-for-line port of `dsp/`, cross-checked by `tests/cross_check.js`. Python names are
snake_case and JavaScript names are camelCase; keyword-only Python options become an options object in JS.

| Python (`dsp/`) | JavaScript (`web/dsp.js`) | Notes |
|---|---|---|
| `window(name, N, beta)` | `windowFn(name, N, beta)` | |
| `kaiser_params(atten_db, transition_hz, fs)` | `kaiserParams(atten, transition, fs)` | JS returns `{numtaps, beta}` |
| `fir_window(numtaps, edges, kind, win, fs, beta)` | `firWindow(numtaps, edges, kind, win, fs, beta)` | |
| `remez(numtaps, bands, desired, weight, fs, ..., *, kind)` | `remez(numtaps, bands, desired, weight, fs, {kind, gridDensity, maxiter, tol})` | JS returns `{h, delta, iterations}` |
| `design_iir(kind, btype, order, edges, fs, rp, rs, butter_edge_rp)` | `designIIR(kind, btype, order, edges, fs, rp, rs, protoScale)` | JS scales the prototype directly instead of taking `butter_edge_rp` |
| `min_order(kind, btype, passband, stopband, gpass_db, gstop_db, fs)` | `minOrder(kind, btype, passband, stopband, gp, gs, fs)` | |
| `zpk2sos`, `sos2tf` | `zpk2sos`, `sos2tf` | |
| `roots_of(p)` | `polyRoots(p)` | |
| `freqz`, `sos_freqz`, `group_delay` | `freqz`, `sosFreqz`, `groupDelay` / `sosGroupDelay` | |
| `measure_lowpass(f, H, fp, fst)` | `measure(resp, bands)` | JS measures any band layout |
| `QFormat(int_bits, frac_bits)` | `qFormat(intBits, fracBits)` | |
| `auto_format`, `to_int(x, fmt, rounding, overflow)`, `quantize` | `autoFormat`, `toInt(x, fmt, rounding, overflow)`, `quantize` | |
| `quantize_fir`, `scale_sos`, `quantize_sos`, `quantize_direct_form` | `quantizeFir`, `scaleSos`, `quantizeSos`, `quantizeDirect` | JS returns objects, not tuples |
| `simulate_fir_fixed(h, x, coef_fmt, sig_fmt, *, overflow)` | `firFixedSim(h, x, coefFmt, sigFmt, rounding, {overflow})` | |
| `simulate_sos_fixed(sos, x, coef_fmt, sig_fmt, *, overflow, headroom_bits, error_feedback)` | `sosFixedSim(sos, x, coefFmt, sigFmt, rounding, {overflow, headroomBits, errorFeedback})` | JS also returns the float references `yq`, `yIdeal` |
| `fir_noise_theory(h, sig_fmt, input_quantized=True)` | `firNoiseTheory(h, sigFmt, inputQuantized = true)` | |
| `sos_noise_theory(sos, sig_fmt, input_quantized=True, *, error_feedback)` | `sosNoiseTheory(sos, sigFmt, inputQuantized = true, {errorFeedback})` | |

## Interactive app

Open `web/index.html` in a browser (no server, no network). Pick a method and response type, drag the P and S tabs on the magnitude plot to move the band edges, and the filter is redesigned live. "Pin as B" keeps the current magnitude response on the plot (dashed) so you can compare the next design against it. The Quantization tab shows the response and poles before and after rounding, a word-length sweep, measured against predicted round-off noise, and, for IIR filters, a diagram of one biquad with its rounding point. It also has controls for overflow (saturate or wrap), input headroom and error feedback. "Copy Python" reproduces the current design with this library. On a phone the views are on a tab bar at the bottom.

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

- **Remez** designs all four linear-phase types. Even-length symmetric filters (type II) have a forced zero at fs/2, so they are rejected for high-pass and band-stop; the app tries one tap fewer as type II for low- and band-pass and keeps it only if it still meets the spec. Hilbert transformers and differentiators are in the library and the JS port, not in the app (its pass/fail spec model does not fit them).
- **Elliptic** designs and orders match `scipy.signal.ellip` / `ellipord` (Jacobi functions by the AGM, degree equation by nomes). See `docs/theory.md`.
- **Window method** sizes: Kaiser's formula is an estimate, so the app adds taps until the measured response meets the spec. Fixed windows have a hard attenuation floor (Hamming about 53 dB); the app says so rather than adding taps forever.
- **Butterworth** is designed so the response is exactly -Rp dB at the passband edge (`butter_edge_rp`), which makes the spec meaningful; the textbook -3 dB cutoff is the default in the library.
- **Biquad scaling**: narrow-band filters have numerator coefficients near 1e-4, which a shared fixed-point format rounds to zero. `scale_sos` gives each section unit peak gain and returns the leftover gain as one output stage, as fixed-point code does.
- **Noise model**: direct-form-I biquads with one rounding per section; each rounding error is shaped by that section's own `1/A(z)` and then by the remaining sections. FIR: one rounding at the output. Measured against theory in the tests (within 1 to 2 dB).
- **Error feedback** subtracts `round(a1) r[n-1] + round(a2) r[n-2]` (r = what rounding discarded) before each rounding, so the error is shaped by `(1 + round(a1) z^-1 + round(a2) z^-2) / A(z)`. On a narrow low-pass this lowers the noise by about 26 dB, matching theory to within 0.1 dB.
- **Overflow and headroom**: saturate clamps each section output, wrap keeps the low bits. Headroom scales the input by `2^-h` (h bits of margin, 6.02 h dB less signal-to-noise); multiply the output by `gain * 2^h`.
- Fixed-point simulation in the browser uses doubles, exact up to 2^53, so signal and coefficient words are limited to 20 and 24 bits there.
