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
