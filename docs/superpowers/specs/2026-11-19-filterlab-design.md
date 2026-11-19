# Filterlab — design

Date: 2026-11-19. Status: revision 2, for approval.

## Intent

Filterlab is a digital filter design toolkit: a numpy-only Python library (`dsp/`) and a
self-contained web app (`web/index.html`) whose `web/dsp.js` is a line-for-line port of it.
It is a portfolio and learning project for an EE student heading toward signal processing and
hardware: DSP rigour, verification and clear theory come before feature count (from `CLAUDE.md`).

The existing code (from `filterlab.zip`, committed untouched as 4b15f49) is the baseline.
It is not rewritten. Work proceeds in the order 0, A, B, C, D, each with its own short
plan, green tests and a commit.

## Baseline as found (2026-11-19, Windows 11, Python 3.12.10, Node 26.13.0)

| Command (as written in `CLAUDE.md`) | Result |
|---|---|
| `pytest tests -q` | pass, 31 tests |
| `python tests/export_reference.py` | pass; rewrites `tests/reference.json` with differences up to 1.6e-15 from the committed copy (numpy build noise) |
| `node tests/cross_check.js` | pass, 56 checks |
| `node tests/ui_sweep.js` | **fail**: `Cannot find module 'playwright'`; also hard-codes `/usr/bin/google-chrome` |
| `node tests/ui_shots.js` | **fail**: same `Cannot find module 'playwright'`; same hard-coded Chrome path |

Problems found while reading (not fixed yet):
- `ui_sweep.js` / `ui_shots.js` build the page URL as `'file://' + process.cwd() + '/web/index.html'`,
  which breaks on Windows (backslashes, the space in `Code DEV`); they never create `shots/`;
  `ui_sweep.js` exits 0 even when designs miss spec or the console logs errors;
  `ui_shots.js` only shoots 1440 px wide.
- README uses `python3` (the Microsoft Store stub here, which fails) and `&&`.
- No `package.json`, no single test command.
- JS/Python drift: `firNoiseTheory` defaults `inputQuantized=false` (Python `True`);
  `sosNoiseTheory` has no `inputQuantized` (always false); JS `toInt` has no `overflow`
  argument (Python has saturate and wrap). The cross-check only exercises the false path.
- `cross_check.js` uses absolute tolerances only and never compares IIR poles or zeros.

## Goals

- **0. Windows/VS Code port only.** No DSP or UI behaviour changes.
- **A.** UI/UX critique first (ui-ux-pro-max, impeccable), then: grouped and collapsible controls
  panel, one-handed phone layout (<= 480 px), compare mode, plain-language captions on the
  Quantization tab, a DF-I signal-flow diagram (diagram-design) with the rounding point marked.
- **B.** Even-length Parks-McClellan (type II), Hilbert and differentiator (types III/IV),
  elliptic IIR with `min_order`, overflow modes (saturate/wrap) with a headroom control,
  error-feedback rounding compared with theory.
- **C.** Time-domain demo: tones + noise or an uploaded WAV, input/output spectra, float vs
  quantized, optional Web Audio playback.
- **D.** README (including the JS/Python name mapping table), `docs/theory.md`, regenerated
  `examples/gallery.png`.

## Non-goals and anti-goals

Non-goals: new dependencies (numpy in `dsp/`; scipy only in tests and the noise-theory helpers
that already use it; no npm packages), runtime network or CDN, multirate or adaptive filters.

Failures even if everything "works": Python and JS drifting; the UI reporting a design meets spec
when it does not; a test command that passes when it should fail (as `ui_sweep.js` does today);
anything that only runs in bash or only on Linux; losing visible focus or usability at 390 px.

## Constraints

- Python launcher detected once, in order `python`, `py -3`, `python3`; first that imports numpy
  wins (here: `python`; `python3` is the Store stub). README records the choice.
- No `&&` in scripts or docs. `package.json` scripts `test:py`, `test:js`, `test:ui`,
  `test:all`; `run_tests.js` runs them in sequence.
- File URLs via `url.pathToFileURL(path.resolve(...))`; forward slashes in code paths; Node `fs`
  instead of `rm`/`zip`/`sed`.
- Browser from `EDGE_PATH` or `CHROME_PATH`, then common Windows/macOS/Linux install locations,
  else a clear error. (Here: Edge at `C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe`.)
- `npm run serve` for VS Code's Simple Browser; screenshots to `shots/`.
- Never edit `web/index.html` by hand; rebuild with `web/build.py`.
- Colours: `#2a78d6` = floating point / ideal, `#eb6834` = quantized (CVD-validated, per
  `CLAUDE.md`). Tabular numerals, visible focus, `prefers-reduced-motion`, both themes.
- Python first with a failing pytest, then the JS port, then `cross_check.js`, for every DSP change.

## Approaches considered

1. **Browser tests: zero-dependency DevTools-protocol driver (chosen; required by `CLAUDE.md`).**
   Spawn Edge/Chrome with `--headless=new --remote-debugging-port=0 --user-data-dir=<temp>`, read
   `DevToolsActivePort`, talk over Node's built-in `WebSocket`. The driver exposes the few calls the
   two scripts use (goto, evaluate, click, mouse drag, set viewport and colour scheme, screenshot,
   collect console errors). Rejected: `playwright-core` (npm install).
2. **Serve: `npm run serve` -> `run_tests.js serve` -> `<python> -m http.server` on `web/` (chosen)**,
   reusing the launcher detection. Rejected: a separate Node static server (one more file to keep).
3. **Order: 0 then A to D, one plan each (chosen, per `CLAUDE.md` roadmap).**

## Task 0: Windows/VS Code port (details)

- `tests/browser.js` (driver, as above); `ui_sweep.js` and `ui_shots.js` ported onto it with the
  same checks, plus: non-zero exit on any missed spec, failed interaction check or console error;
  `shots/` created with `fs.mkdirSync(..., {recursive: true})`; shots in light and dark at 1440
  and 390 px.
- `package.json` + `run_tests.js` (launcher detection, `py`/`js`/`ui`/`all`/`serve`/`build`).
  `test:js` runs `export_reference.py` then `cross_check.js`.
- `cross_check.js` hardening:
  - mixed tolerance everywhere: pass when `|js - py| <= atol + rtol * |py|` element-wise, with
    `rtol = 1e-9` and `atol = 1e-12` by default (tighter per check where it already is, e.g. exact
    integer results stay at 0);
  - IIR zeros and poles compared from the design's own `z`/`p` (computed analytically from the
    prototype and band transform), never by root-finding `b` or `a`: repeated roots (e.g. the
    Butterworth low-pass's zeros all at z = -1) are ill-conditioned for root finders. Match as
    multisets: sort by (real, imag) after rounding to 1e-9, then the mixed tolerance.
- README: commands without `python3` or `&&`, the detected launcher, and `npm` scripts.
- `tests/reference.json` stays committed; `test:js` regenerates it, so run-to-run diffs around
  1e-15 are expected and are not committed unless the cases change.

## Task B details

**Public signature changes (approved by the owner 2026-11-19; keyword-only, existing names kept,
coefficient and signal formats stay separate arguments):**

1. `remez(numtaps, bands, desired, weight=None, fs=2.0, grid_density=20, maxiter=80, tol=1e-9, return_info=False, *, kind="bandpass")`.
   `numtaps` may be even. `kind` in {"bandpass", "hilbert", "differentiator"}.
   Even `numtaps` with "bandpass" = type II; a band with non-zero gain at Nyquist then raises
   `ValueError` saying type II has a forced zero at fs/2. "hilbert"/"differentiator" give
   type III (odd) or IV (even). Checked against `scipy.signal.remez(..., type=...)`.
2. `design_iir(kind="ellip", ...)` and `min_order(kind="ellip", ...)`: a new value of the existing
   `kind` argument (uses the existing `rp` and `rs`). Jacobi elliptic functions by descending
   Landen / AGM; order from the degree equation. Checked against `scipy.signal.ellip` / `ellipord`.
3. `simulate_fir_fixed(h, x, coef_fmt, sig_fmt, *, overflow="saturate")`.
4. `simulate_sos_fixed(sos, x, coef_fmt, sig_fmt, *, overflow="saturate", headroom_bits=0, error_feedback=False)`.
5. `sos_noise_theory(sos, sig_fmt, input_quantized=True, *, error_feedback=False)`.

JS mirrors each with an options object, e.g. `sosFixedSim(sos, x, coefFmt, sigFmt, rounding, {overflow, headroomBits, errorFeedback})`.
The JS drift listed above (noise-theory defaults, `toInt` overflow) is fixed in B, where those
functions change anyway, and the cross-check then covers both paths.

**Overflow.** `"saturate"` clamps each section output (as now); `"wrap"` applies two's-complement
wrap with the existing `to_int` rule. **Headroom:** the input is shifted right by `headroom_bits`
before the first section (fewer overflow events, `headroom_bits` x 6.02 dB less SNR); the caller
multiplies the output by `gain * 2**headroom_bits`. UI slider 0 to 6 bits.

**Error feedback: sign convention (pinned).** For a section with denominator row
`[1, a1, a2]` (A(z) = 1 + a1 z^-1 + a2 z^-2) and integer feedback coefficients
`c1 = round(a1)`, `c2 = round(a2)`:

```
acc'[n] = acc[n] - c1 * r[n-1] - c2 * r[n-2]
y[n]    = (acc'[n] + half) >> sh
r[n]    = acc'[n] - (y[n] << sh)          # the part rounding threw away, in accumulator LSBs
```

So the section's rounding noise reaches its output through `N(z) / A(z)` with
`N(z) = 1 + c1 z^-1 + c2 z^-2`, which nearly cancels A(z) for poles near z = 1. Theory: as today,
with each section's `[1]` numerator for its own rounding replaced by `N(z)`.

Tests (pytest, then cross-check):
- `test_error_feedback_reduces_lowpass_noise`: Butterworth low-pass, order 4, edge 0.02 x fs,
  scaled and quantized with 24-bit coefficients, Q0.15 signal; measured output noise with
  `error_feedback=True` is at least 6 dB below without it.
- `test_error_feedback_matches_theory`: the measured noise with error feedback is within 1.5 dB of
  `sos_noise_theory(..., error_feedback=True)`. Because theory uses `N(z) = 1 + c1 z^-1 + c2 z^-2`,
  this also fails if the implementation's sign is flipped (that gives `1 - c1 z^-1 - c2 z^-2`,
  several dB worse), which pins the convention.

## Task A details (builder's calls; owner may override)

- Controls in native `<details>` groups (Response, Method, Specs, Arithmetic, Export); Response and
  Specs open by default so the panel fits a 768 px-tall viewport.
- Phone (<= 480 px): single column, tab bar fixed at the bottom, controls collapsible above the
  chart, drag tabs with 44 px hit areas.
- Compare mode: "Pin as B" snapshots the current design; B is drawn **dashed in a neutral ink token**
  (both themes), not in `#eb6834`, because that colour means "quantized"; legend "A current, B pinned";
  the hover readout and data table include both. Magnitude plot only.
- Quantization captions: one or two plain sentences under each chart.
- Signal-flow diagram: inline, theme-aware SVG of one DF-I biquad with the single rounding point
  marked (after the accumulator, before the output delays); the error-feedback path is drawn dashed
  and appears once B adds that option.

## Task C details

Test signal: sum of tones plus white noise, seeded. WAV upload: PCM 16/24-bit and float32, mono or
stereo (mixed to mono), at most 10 s, every header field bounds-checked, and a plain error message
when the file is not one of these. Spectra via FFT in `dsp/` (numpy) and `dsp.js` (ported and
cross-checked). Float vs quantized: same cascade through `simulate_sos_fixed`/`simulate_fir_fixed`.
Playback: Web Audio, gain clamped, starts muted, stops on tab change.

## Task D details

`docs/theory.md`, short derivations of:
- the order estimates (Kaiser, Herrmann/Remez, the analog-prototype orders, elliptic degree equation);
- the noise model (q^2/12 per rounding, shaped by 1/A_k(z) and the remaining sections; error feedback's N(z));
- **the scaling definition, stated exactly: each biquad is scaled to unit peak gain of its own
  transfer function, max over w of |B_k(e^jw) / A_k(e^jw)| = 1, and the leftover gain is applied
  once at the output** (what `scale_sos` does), and why this choice (per-section L-infinity, not
  cumulative L2) was made.

README: the JS/Python name mapping table (Python snake_case, JS camelCase, e.g.
`simulate_sos_fixed` / `sosFixedSim`, `measure_lowpass` / `measure`), commands, launcher.
`examples/gallery.png` regenerated with `examples/demo.py`.

## Left to the builder

Internal helper names, drawing code, CSS values within the tokens, extra test cases beyond those
named, exact caption copy (plain language, short).
