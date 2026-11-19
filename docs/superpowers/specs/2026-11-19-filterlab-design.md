# Filterlab — design

Date: 2026-11-19. Status: draft for approval.

## Intent

Filterlab is a digital filter design toolkit: a Python reference library (`dsp/`) and a
self-contained interactive web app (`web/index.html`) that ports the same maths line for line.
You design a filter, see whether it meets spec, and see what happens when the coefficients
and arithmetic go fixed-point.

The original code (described as "already verified") was not available, so it is rebuilt from
scratch here (owner's decision, 2026-11-19), then extended with tasks A–D.

## Goals

- Baseline: the features listed under "What exists" in the brief, with the three test suites.
- A: UI/UX pass (critique first), collapsible controls, one-handed phone layout, compare mode,
  plain-language captions plus a DF-I signal-flow diagram on the Quantization tab.
- B: even-length Parks-McClellan (type II), Hilbert transformer and differentiator (types III/IV),
  elliptic IIR with min_order, overflow modes (saturate/wrap) and a scaling-headroom control,
  error-feedback noise shaping compared with theory.
- C: time-domain demo: tones+noise or an uploaded WAV, input/output spectra, float vs quantized,
  optional Web Audio playback.
- D: README, `docs/theory.md`, regenerated `examples/gallery.png`.

## Non-goals

- No dependencies beyond numpy in `dsp/` (scipy is test-only). No npm packages at all.
- No server-side anything; no network at runtime; no CDN.
- No multirate, adaptive filters, or arbitrary-response FIR (frequency sampling) design.
- Not matching scipy's API names; matching scipy's *results* is what the tests check.

## Anti-goals (a failure even if it works)

- Python and JS disagreeing beyond machine precision on any shared function.
- A design the UI reports as meeting spec that does not.
- A UI that is unusable at 390 px wide or loses visible keyboard focus.
- Test or build commands that only work in bash, or only on Linux.

## Constraints (from the owner, verbatim where it matters)

- Runs on the owner's Windows machine in VS Code; must also work on macOS/Linux.
- Python launcher detected (try `python`, then `py -3`, then `python3`; first one that imports
  numpy wins). On this machine `python3` is the Microsoft Store stub and fails; `python` works.
  The choice is written into README.
- No `&&` chaining in scripts or docs. `package.json` scripts `test:py`, `test:js`, `test:ui`,
  `test:all`; `run_tests.js` runs them in sequence.
- File URLs via `url.pathToFileURL(path.resolve(...))`. Forward slashes in code paths.
  No POSIX-only tools (rm, zip, sed) in scripts: use Node `fs`.
- Browser driver finds Edge/Chrome via `EDGE_PATH` / `CHROME_PATH`, then common install
  locations on Windows, macOS, Linux; clear error if none. (Here: Edge at
  `C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe`; no Chrome, no Playwright.)
- `npm run serve` for VS Code Simple Browser; screenshots to `shots/`.
- `web/index.html` self-contained; tabular numerals; visible focus; `prefers-reduced-motion`;
  chart colours #2a78d6 (design A / primary) and #eb6834 (design B / secondary).
- Python first with a pytest, then JS port, then cross-check, for every DSP change.
- Ask the owner before changing a public `dsp/` function signature.

## Approaches considered

1. **Browser automation: zero-dependency DevTools-protocol driver (chosen).** Node 26 has a
   global `WebSocket`; spawn Edge/Chrome headless with `--remote-debugging-port=0`, read
   `DevToolsActivePort`, drive with `Runtime.evaluate`, `Page.captureScreenshot`,
   `Emulation.setDeviceMetricsOverride`. ~150 lines, no installs.
   Rejected: `playwright-core` (an npm install, against the no-install rule); the
   chrome-devtools MCP (not runnable as a test command).
2. **JS port shape: same function names as Python, snake_case (chosen)** so a grep for
   `remez` finds both sides. Rejected: idiomatic camelCase (breaks the one-to-one mapping).
3. **Build order: baseline then A→D, each its own plan and commit (chosen).** Rejected: folding
   B's DSP into the baseline (loses the "commit after each task" history the brief asks for).

## Architecture

```
dsp/            numpy-only reference
  fir.py        window design (Kaiser + classic windows), kaiser order estimate,
                remez (Parks-McClellan), PM order estimate (Herrmann)
  iir.py        analog prototypes (butter, cheby1, cheby2, ellip), lp->lp/hp/bp/bs,
                bilinear with prewarp, zpk -> SOS pairing, min_order per family
  analysis.py   freqz, group delay, roots, spec check (passband ripple / stopband atten)
  quant.py      Qm.n quantize, per-section peak scaling (L-inf of section-input transfer),
                bit-true FIR and SOS (DF-I) simulation, round-off noise theory
  signal.py     (task C) test-signal generator, FFT spectrum helper
web/
  dsp.js        line-for-line port; works in the browser and under `require` in Node
  app.js        UI; canvas plots; no framework
  style.css     tokens on :root, dark theme via prefers-color-scheme + [data-theme]
  index.src.html  template; build.py inlines css+js -> index.html
  build.py
tests/
  test_*.py               pytest vs scipy
  export_reference.py     runs dsp/ on fixed cases -> tests/ref/*.json
  cross_check.js          runs dsp.js on the same cases, max rel err <= 1e-9
  browser.js              DevTools-protocol driver (find browser, launch, eval, screenshot)
  ui_sweep.js             every method x response type in the real page must meet spec
  ui_shots.js             light/dark x 1440/390 screenshots -> shots/
tools/serve.js            tiny static file server for `npm run serve`
run_tests.js, package.json
```

Methods x responses in the sweep: {Kaiser window, Parks-McClellan, Butterworth, Chebyshev I,
Chebyshev II} x {lowpass, highpass, bandpass, bandstop} = 20 (24 once elliptic lands in B).
Even-length PM and Hilbert/differentiator are added to the sweep in B as extra cases.

## Decisions on the details (builder's calls, owner may override)

- Collapsible controls: native `<details>` groups — Response, Method, Specs, Arithmetic,
  Export. Only Response + Specs open by default, so the panel fits a 768 px-tall viewport.
- Phone (<=480 px): single column; tab bar fixed at the bottom (thumb reach); controls in a
  collapsible sheet above the chart; band-edge drag tabs get 44 px hit areas.
- Compare mode: "Pin as B" snapshots the current design; B is drawn dashed in #eb6834 over A
  (solid #2a78d6) with a legend; "Clear B" removes it. Only the magnitude plot overlays.
- Quantization captions: one or two sentences under each chart, plain language.
- Signal-flow diagram: inline SVG (theme-aware via CSS variables) of one DF-I biquad, the
  single rounding point (after the accumulator, before the delay line) marked, with the
  error-feedback path drawn dashed when that option is on. Built with diagram-design guidance.
- Overflow: `wrap` = two's-complement wrap of the accumulator result; `saturate` = clamp.
  Headroom slider: 0–6 bits of extra scaling below the peak-scaling choice.
- Error feedback: second-order error feedback with integer coefficients (round(-a1), round(-a2)
  in the section's own fixed-point format) fed back before the rounding; theory = white
  rounding noise q^2/12 shaped by (1 + c1 z^-1 + c2 z^-2) times the section-to-output
  response. Test: simulated output noise power within 1 dB of theory.
- Elliptic: Jacobi elliptic functions via descending Landen / AGM (Orfanidis' method);
  min_order from the degree equation. Checked against scipy.signal.ellip/ellipord.
- Type II/III/IV PM: standard reduction to type I by a fixed factor cos(w/2), sin(w), sin(w/2)
  (Parks-McClellan / McClellan-Parks-Rabiner). Checked against scipy.signal.remez.
- WAV upload: PCM 16/24-bit and float32, mono or stereo (mixed to mono), length capped at
  10 s, every header field bounds-checked. Playback gain clamped and starts silent.
- Export: coefficients as C arrays and Python lists, numbers formatted by the code itself
  (never user-supplied text interpolated). Clipboard through `navigator.clipboard.writeText`,
  with a select-the-textarea fallback when it is unavailable (file://).

## Public signatures that tasks B/C will extend (needs owner approval)

All additive, keyword-only, with defaults that keep existing behaviour:

- `remez(numtaps, bands, desired, weight=None, *, kind="bandpass")` — `numtaps` may be even;
  `kind` in {"bandpass", "hilbert", "differentiator"}.
- `design_iir(..., family)` gains the value `"ellip"` (new value, not a new parameter) and
  `min_order(...)` gains `"ellip"`.
- `simulate_sos(x, sos_q, fmt, *, overflow="saturate", headroom_bits=0, error_feedback=False)`
  and `simulate_fir(x, h_q, fmt, *, overflow="saturate")`.
- `roundoff_noise(sos, fmt, *, error_feedback=False)`.

## Settled during the builder check (builder's calls)

- Units: band edges in Hz with a sample-rate field (default 48 kHz); specs as passband ripple
  Rp (default 1 dB) and stopband attenuation Rs (default 60 dB).
- "Meets spec" = max passband deviation <= Rp and min stopband attenuation >= Rs on a dense
  grid (8192 points), excluding transition bands.
- Order estimates (Kaiser, Herrmann) can undershoot; the app and `auto_order` step the order up
  until the design meets spec (capped at 400 taps FIR, 30 IIR), and say so if the cap is hit.
- Cross-check tolerance: relative error <= 1e-9 for coefficients and responses; roots compared
  after sorting, <= 1e-7.

## Left to the builder

Internal helper names, plot drawing code, exact CSS values within the tokens, test-case
selection beyond the ones named, and the exact copy of captions (plain language, short).
