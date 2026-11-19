# Filterlab

Digital filter design toolkit: a numpy-only Python library (`dsp/`) plus a single-file interactive web app (`web/`).
It designs FIR (windowed-sinc, Parks-McClellan) and IIR (Butterworth, Chebyshev I/II) filters, analyzes them
(Bode, group delay, pole-zero), and shows what fixed-point quantization does to them.

Purpose: a portfolio and learning project for an EE student heading toward signal processing, semiconductor
design and CPU/GPU/AI-hardware work. Favor DSP rigor, verification and clear theory over feature sprawl.

## Layout

```
dsp/            Python library: fir.py, remez.py, iir.py, analysis.py, quant.py
web/            dsp.js (line-for-line port of dsp/), app.js (UI), style.css, index.template.html,
                build.py -> web/index.html (self-contained, generated; never edit by hand)
tests/          test_vs_scipy.py, export_reference.py + cross_check.js, ui_sweep.js, ui_shots.js
examples/       demo.py (writes gallery.png)
README.md       user-facing docs
```

## Commands

Detect the Python launcher once (`python`, `py` or `python3`) and use it everywhere. Do not chain commands with
`&&` in scripts or docs; this runs in VS Code, possibly on Windows. Prefer the npm scripts if they exist.

```
pytest tests -q                              # library vs scipy, noise vs theory
python tests/export_reference.py             # dump Python reference results to tests/reference.json
node tests/cross_check.js                    # JS port vs Python, must pass at machine precision
python web/build.py                          # rebuild web/index.html after editing web/*
node tests/ui_sweep.js                       # drives the real page; all 20 method x response-type designs meet spec
node tests/ui_shots.js                       # screenshots to shots/ (light and dark)
```

Run all of them before calling any task done.

## Rules

1. **Python is the source of truth.** Any DSP change goes in `dsp/*.py` first, with a pytest written first. Then port
   it to `web/dsp.js`, then cover it in `tests/cross_check.js`. Python and JS must never drift.
2. **Verify, don't assume.** Look at screenshots of any UI change in light and dark themes, at about 1440px and about
   390px wide. Report anything you could not verify.
3. **Never edit `web/index.html` directly.** Edit the sources and rebuild.
4. **Keep the app self-contained:** no CDN, no network, no external fonts. It must run from a `file://` URL.
5. **Ask before changing a public function signature in `dsp/`.** Add parameters with defaults instead.
6. **No new dependencies** unless asked. Python: numpy for the library, scipy only in tests and the noise-theory
   helpers that already use it. Node: no packages; browser tests use a zero-dependency headless Edge/Chrome driver
   over the DevTools protocol. Find the browser from `EDGE_PATH` or `CHROME_PATH`, then common install locations,
   and fail with a clear message if none is found.
7. **Paths:** build file URLs with `url.pathToFileURL(path.resolve(...))`, use forward slashes in code, and avoid
   POSIX-only tools (`rm`, `zip`, `sed`) in scripts.
8. Commit after each finished task with a clear message. Do not commit `shots/`, `node_modules/` or `__pycache__/`.

## Conventions

- Frequencies are in Hz and take an `fs` argument. Biquad (`sos`) rows are `[b0 b1 b2 1 a1 a2]`.
- Qm.n means 1 sign bit + m integer bits + n fraction bits. Quantized biquads are peak-scaled per section
  (`scale_sos`) with the leftover gain applied once at the output; do not quantize unscaled narrow-band sections.
- Remez supports odd lengths (type I) only, until the even-length work lands.
- Order searches: Kaiser/Remez formulas are estimates; in auto mode, search until the measured response meets the spec.
- Noise model: direct-form-I biquads, one rounding per section, each error shaped by that section's `1/A(z)` and then
  the remaining sections. Measured noise must stay within about 1-2 dB of theory in tests.
- JS fixed-point simulation uses doubles (exact to 2^53), so signal and coefficient words are capped at 20 and 24 bits.

## UI conventions

- Trace colors: `#2a78d6` (floating point / ideal) and `#eb6834` (quantized), validated for color-vision deficiency.
  Light and dark themes use CSS variables in `web/style.css`; every new color needs both.
- Numbers use tabular figures. Keyboard focus stays visible. Respect `prefers-reduced-motion`.
- Copy: plain sentence case, active voice, buttons say what they do. Errors say what went wrong and how to fix it.
- Charts: a legend for two or more series, a hover readout, and a data-table fallback.

## Plugins to use when available

superpowers (brainstorming, writing-plans, TDD, verification-before-completion) for every DSP change;
ui-ux-pro-max and impeccable for design critique before UI work; diagram-design for signal-flow figures;
ecc and agent-skills for review before finishing; claude-security for a pass over exported-code strings and
clipboard handling. Say at the end which ones you used.

## Roadmap (do in order, one short plan each, green tests before the next)

0. Baseline check: run every command above and confirm green before changing anything.
A. UI/UX pass: compact controls panel, phone layout, compare mode (overlay a second design), plain-language captions on the Quantization tab, signal-flow diagram.
B. DSP: even-length Parks-McClellan, Hilbert and differentiator designs, elliptic IIR with `min_order`, overflow modes (saturate vs wrap) with a headroom control, error-feedback rounding compared to theory.
C. Time-domain demo: filter a test signal or an uploaded WAV, show input and output spectra, float vs quantized.
D. Docs: update README, add `docs/theory.md` (order estimates, noise model, peak-scaling choice), regenerate `examples/gallery.png`.

## Definition of done

All commands green, new behavior covered by tests, UI screenshots reviewed in both themes and on mobile,
`web/index.html` rebuilt, README updated, and a closing summary of what changed, what was verified and what was not.
