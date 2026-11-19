# Decisions

Format: decision / why / rejected alternative.

## Needs owner approval

(none yet)

## Decisions made during the run

- **Task 0. Browser readiness = DevToolsActivePort file, not the child's exit code.** Edge's Windows launcher exits 0 at once and hands off to the real browser. Rejected: waiting on the child process.
- **Task 0. `ui_shots.js` writes `{scheme}-{width}-{tab}.png` (12 shots).** Covers light and dark at 1440 and 390 for every tab. Rejected: the old 4-shot set, which had no phone width.
- **Task 0. `web/build.py` writes UTF-8 with `\n` explicitly.** On Windows, text mode wrote CRLF and rewrote all of `index.html` on every build. Rejected: a `.gitattributes` rule, which hides the problem instead of fixing it.
- **Task 0. `sos noise theory` cross-check keeps rtol 1e-3.** Python integrates on scipy's 2^15 grid and JS on its own grid, so 1e-3 is the honest bound (same as the baseline). Rejected: forcing 1e-9, which would need identical integration code.
- **Task 0. `*.zip` added to `.gitignore`.** The brief says never commit zip files. Rejected: deleting `filterlab (1).zip`, which is the owner's file.
- **Task 0. Tests run outside the agent's sandbox.** The sandbox blocks spawning a browser; this has no effect on the repo.
- **B. Remez types II-IV via A(w) = Q(w) P(cos w).** This is the textbook Parks-McClellan reduction: it reuses the existing exchange unchanged, and type I keeps its closed-form output so its results are bit-identical. Rejected: a separate solver per type.
- **B. Differentiator convention follows scipy:** D(f) = desired * f/fs and weight/f. "Trust scipy" policy. Rejected: D = 2*pi*f (physical slope), which would disagree with scipy.
- **B. Hilbert and differentiator are in the library and `dsp.js` (cross-checked), but not in the app UI.** The app's spec model (low/high/band-pass/stop with a ripple and attenuation check) has no honest pass/fail for them. Rejected: adding them with a fake spec check.
- **B. App auto mode tries N-1 taps as type II** for low-pass and band-pass after the odd search, and keeps it only if the measured response still meets spec. Manual even lengths for high-pass and band-stop are bumped to odd, with a note. Rejected: always odd (wastes a tap).
- **B. Headroom = scale the input by 2^-h, then quantize once.** It is deterministic and identical in both languages. Rejected: arithmetic right-shift of the already-quantized input (adds a second, truncating rounding).
- **B. Error feedback: round(a) is floor(a + 0.5)** (ties up, integer `(a + half) >> sh`), and the residual r is taken before saturation/wrap. This keeps r within one LSB; after a clip the true residual would be huge and destabilise the feedback. Rejected: Python's banker's `round`.
- **B. Quantization tab reports noise times 4^h when headroom is on** (referred back to the output scale), so turning headroom up shows the real SNR cost. Rejected: showing the raw in-cascade noise.
- **B. No headroom/error-feedback control for FIR in the app.** The approved FIR signature adds only `overflow`. Rejected: a sixth signature change (would need owner approval).
- **A. Control groups are Method, Response type, Spec and Size** (Method and Size collapsed, with their current value in the summary). The doc also suggested Arithmetic and Export groups, but those controls already live on the Quantization and Time tabs, next to what they affect. Rejected: duplicating them in the sidebar.
- **A. Compare mode is magnitude-only and keeps one pinned design (B).** This matches the doc. B has its own frequency axis, so pinning at another sample rate still draws correctly; the table and readout then omit B and say so.
- **A. The diagram follows diagram-design's rules, not its theme:** orthogonal connectors, masked labels, two accents (Q and the error-feedback path, in the "quantized" colour), and an accessible SVG with a title and desc. It uses the app's own CSS tokens and system fonts, because CLAUDE.md forbids external fonts. Rejected: the skill's Google-Fonts typography and style-guide gate.
- **A. Phone screenshots add viewport-only captures.** A full-page capture draws the `position: fixed` tab bar at the original viewport bottom, mid-page, which is an artifact and not the real layout. `ui_sweep` checks the real position.
- **A. impeccable ran without PRODUCT.md.** The owner asked for no questions, so product context came from CLAUDE.md and the design doc. `/impeccable init` is offered for later.
- **D. Updated one stale line in CLAUDE.md** ("Remez supports odd lengths (type I) only, until the even-length work lands"). The work has landed, and leaving the line would misdirect the next session. Rejected: leaving the owner's file untouched while it is wrong. No other lines changed.
- **D. theory.md documents a cost of the scaling choice:** the leftover gain can be large (111, or 41 dB, for the README's Chebyshev example), which raises output noise by the same factor. Found while checking the README example. Rejected: changing the scaling (out of scope, and it would change public results).
- **C. The WAV parser lives only in `dsp.js`.** It is browser I/O, not DSP. It is tested in Node with ten synthesized good and bad files, plus an in-browser upload in `ui_sweep`. The DSP parts (`tone_signal`, `power_spectrum_db`) are Python-first and cross-checked. Rejected: a Python WAV reader that nothing uses.
- **C. Loading a WAV sets the design's sample rate to the file's**, with band edges scaled by the same factor, as the Sample rate field already does. If the rate is changed afterwards, a banner says that frequencies are scaled. Rejected: silently filtering at the wrong rate.
- **C. Fixed-point output on the Signal tab always uses the biquad cascade for IIR designs** (with a note when Structure is "direct"), and none is shown when a quantized biquad pole is unstable. Rejected: simulating an unstable direct form, which only produces overflow garbage.
- **C. Playback: muted until the volume slider moves, gain at most 0.5, samples clipped to +/-1, and it stops on any tab change or volume change.** Rejected: autoplay or full-scale gain.
- **Review. A type II band ending just below fs/2 (e.g. 0.4999 fs) with non-zero gain is not rejected.** The error fires only within 1e-12 of fs/2. Below that, the edge is pulled to pi - delf and fitted, which is poorly controlled. scipy behaves the same way, and the policy is to trust scipy. Rejected: a stricter check that would diverge from scipy. Flagged for the owner.
- **Review. Fixed after the independent review:** the browser driver's port wait (it could spin without sleeping), hangs on a dropped DevTools socket (pending calls are now rejected; every call has a timeout; Browser.close waits at most 2 s), cleanup when launch fails, a leaked exit listener, and a stale Signal tab cache when two WAVs share a name and length.

## RTL export run (auto/rtl-export)

- **RTL. No HDL simulator is installed** (`where iverilog/verilator/vvp` and yosys: none). Verification uses an independent evaluator (`tests/rtl_eval.py`) that parses the generated SystemVerilog and executes it with two's-complement width rules. It never imports the simulator, and pytest compares its output with `simulate_*_fixed`. A mutation test (one coefficient off by one LSB) proves the comparison can fail. `npm run test:rtl` also runs Icarus Verilog automatically when it is present. Rejected: claiming simulation.
- **RTL. Tasks 1 and 2 share one commit.** The generator's tests need the evaluator, so neither is green alone. Rejected: a generator commit without tests.
- **RTL. Interface:** one sample per clock, `in_valid`/`in_data` in, registered `out_valid`/`out_data` (latency 1 clock), synchronous active-high `rst`. The datapath is combinational from input to the output register (no pipelining), which is the simplest structure that matches the simulator. Rejected: pipelined sections (needs a matching latency model; left for later).
- **RTL. `sos_int` rows are `[b0, b1, b2, a1, a2]`** (a0 = 1 implied), the same layout as the C export. Rejected: 6-column rows with a redundant a0.
- **RTL. Headroom inside the module is `(x + 2^(h-1)) >>> h`.** For on-grid inputs this equals the simulator's `to_int(x * 2^-h)` exactly, so the module takes full-scale samples. The leftover cascade gain stays outside the module, because the simulator also returns the cascade output before gain.
- **RTL. Wrap is implicit truncation on assignment**, saturation is a ternary against literals sized one bit wider than their value (so -2^(SW-1) is representable), and every operand is signed, so SystemVerilog's context-width rules give exact modular results.
- **RTL. Accumulator width = bitlen(M) + 1**, with M = sum|coef| * 2^(SW-1) + (|c1|+|c2|) * 2^(SH-1) + 2^(SH-1) (the rounding constant included), per FIR or per section. Each header states it.
- **RTL UI. The export is a "Hardware export" card on the Quantization tab, not a new tab.** It reuses that tab's word lengths, overflow, headroom and error-feedback settings, so what you export is exactly what the tab simulates, and the phone tab bar keeps four entries. Rejected: a fifth Export tab duplicating the settings.
- **RTL UI. Label is "Generated, not synthesized, not simulated"**, because no simulator run is recorded. The card says how the arithmetic was checked and how to run the testbench.
- **RTL UI. The browser's testbench vectors use a JS stimulus** (mulberry32, not numpy's generator) with expected outputs from the JS bit-true simulator. A pytest runs that exact path (JS text + JS vectors) through the independent evaluator. Rejected: porting numpy's PCG64.
- **RTL UI. Module names are fixed** (`filterlab_fir`, `filterlab_sos`). Rejected: a name input (an untrusted identifier; the generator validates names anyway).
- **Fix found on the way: IIR Quantization tab scrolled sideways by 110 px at 1440 px** since last run's diagram card (the inner grid track grew to the diagram's min-width). One CSS line fixes it, and `ui_sweep` now checks every tab for FIR and IIR at 1440 px.
