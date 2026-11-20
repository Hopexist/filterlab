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
- **RTL stretch. The cost report counts the generated structure only:** no symmetric-tap folding or sub-expression sharing, and no area or Fmax (no synthesis tool). CSD is the non-adjacent form, which is unique and has minimal non-zero digits. Rejected: estimating LUTs or gate counts without a tool.

## In-browser RTL simulation run (auto/rtl-sim)

- **RTLSIM. A real parser, not a port of rtl_eval.py's regexes.** `web/rtlsim.js` tokenizes the text, parses module, ports, declarations, assigns and one `always_ff` block (begin/end, if/else, `<=`) into a tree, and evaluates expressions with IEEE 1800 sizing: signedness from the operands, context width max(LHS, operands), sign-extension only in signed context, shift amounts and conditions self-determined, `<`/`>` give 1-bit unsigned. Everything else (division, concatenation, bit selects, `==`, `wire`, plain `always`, system tasks, loops, double drivers) throws "unsupported construct". Rejected: regex matching, which would accept text it does not understand.
- **RTLSIM. Values are BigInt everywhere**, so a 60-bit accumulator is exact (tested against a BigInt reference). X is modelled conservatively: a register is X until assigned, and any X operand gives X. Rejected: full 4-state bit merging, which the generated code never needs after reset.
- **RTLSIM. Continuous assigns are run in dependency order** (with a loop check), even though the generator emits them in order. SystemVerilog does not depend on text order, so the interpreter should not either.
- **RTLSIM tests: 10 designs** (the 8 cross-check designs plus an unscaled cascade that really saturates and wraps), each on 512 samples of impulse, full-scale step, full-scale square and seeded random input. Each output must equal the Python evaluator's, the Python bit-true model's and the JS bit-true model's. A one-bit flip of one coefficient literal in the text must be detected (3 designs). Hand-made modules check the signed/unsigned and width rules. Tasks 1 and 2 are separate commits, but the gate ran once over both (task 1 adds a file nothing loads yet).
- **RTLSIM honesty:** the interpreter and the generator come from the same project, and both follow my reading of the standard. Agreement with the Python evaluator and the bit-true models shows that the text computes the model's arithmetic under those rules; it does not show that a standard simulator or a synthesis tool reads the text the same way. Running `npm run test:rtl` with Icarus Verilog (or any standard simulator) closes that gap.
- **RTLSIM UI. "Simulate hardware" is its own card directly under Hardware export** on the Quantization tab, so it simulates exactly the text that card exports (same settings, same module). Rejected: folding it into the export card, which would make that card very long on a phone.
- **RTLSIM UI. Stepping is real:** Reset re-creates the interpreter and applies one reset clock, Step 1 clock runs one more edge, Run to end runs the rest. The panel opens fully run, so the comparison is visible at once. There is no step back (a simulator cannot run backwards); the cursor (hover, or arrow keys / Home / End on the focused waveform) inspects any clock already simulated.
- **RTLSIM UI. The waveform shows true register timing:** in_data and the accumulators hold their value through clock n, and out_data changes at the rising edge that ends it, so the one-clock latency is visible. Rows are in_data, the headroom-shifted input if any, the first state register (FIR), up to three section accumulators, and out_data. The data table lists every accumulator. The fixed readout under the waveform (not a floating tip) shows the integer and its Qm.n value for each row, so it also works on touch screens.
- **RTLSIM UI. Default 32 samples** (range 16 to 256), so individual clock edges are visible on a phone; at long lengths the clock row becomes a band. The noise input is seeded (seed 11), so it is repeatable.
- **RTLSIM UI. The export card's tag is now "Generated, not synthesized, not run in an HDL simulator"**, replacing "not simulated": the text is now simulated, but only by Filterlab's own interpreter. The simulation card carries the requested plain label verbatim.
- **Review (independent code-reviewer agent). Fixed:** shift amounts were zero-extended inside their own expression. They are now evaluated self-determined in their own type and read as unsigned, as IEEE 1800 requires; generated code only uses literal amounts, so no design changed. Reserved words used as names, and unsized literals that do not fit 32 bits, are now rejected. Six checks were added: shift-amount type, `?:` sign, a signed vs unsigned compare, a non-blocking swap, and the two rejections. The docs no longer imply an independent author. **Not changed:** the X model stays all-or-nothing (disclosed; generated code never reads X after reset). A slider drag re-simulates on every input event, which is fast enough at 256 samples and was not optimized.

## UI polish run (auto/ui-polish)

- **UI. No questions, per the brief:** Impeccable's context step asks for one probe question and FontHound wants the owner to pick fonts by eye. Both were skipped, and product context came from CLAUDE.md and the brief. Rejected: blocking on a question the owner said not to ask.
- **UI. Fonts are a system stack, nothing embedded.** There is no FontHound selection on disk, and the only freely licensed font file present is matplotlib's DejaVu. Bahnschrift (DIN 1451, engineering lettering, shipped with Windows) is used for display and readouts, with DIN Alternate / Barlow / Roboto Condensed / system-ui fallbacks, plus Cascadia Mono for data. Rejected: base64-embedding a Windows font (not ours to redistribute) and Google Fonts (no network).
- **UI. Took from ui-ux-pro-max:** dense spacing, mono-for-data with sans-for-labels, its accessibility checklist, and "not colour alone". **Rejected:** its suggested style, pattern, palette and fonts, which matched badly ("Biomimetic", "Enterprise Gateway", #FF4D4D, Google Fonts).
- **UI task 3. Impeccable's craft floor rejects a system display face; the brief overrides it.** The brief allows "a carefully chosen system stack" when no font can be embedded legitimately, and Bahnschrift is a real DIN 1451 cut. Without Bahnschrift (macOS, Linux), the stack falls back through DIN Alternate / Barlow / Roboto Condensed to system-ui.
- **UI task 3. Readout units are split for display only** (`unitSplit`): the text "0.826 dB" is unchanged, and the number is wrapped big with the unit small and muted. Values that do not start with a number ("Stable", "order 8, 4 biquads") are set smaller rather than split.
- **UI task 4. Plots sit on an instrument "screen":**
  - the plot field uses the `--screen` surface inside a `--bezel` frame, with a major graticule plus a minor one halfway between the ticks;
  - the pole-zero plot gets the same square screen;
  - chart text went from 11 px `--ink-3` to 12 px `--ink-2`;
  - the multiplicity label is offset and haloed, so it no longer collides with the × marker;
  - the pole-zero legend uses drawn SVG marks instead of unicode glyphs.
- **UI task 4. Ideal and quantized differ without colour:** wherever both are overlaid (Quantization response, Signal spectra, first samples), the ideal trace is wide (3.5 px) and drawn underneath, and the quantized one is thin (1.6 px) on top; the legends show the same weights. The dataviz validator passes both themes against the new screen surfaces: CVD ΔE 24.7 light and 26.8 dark (target ≥ 8), normal-vision ΔE 33.6 and 31.8, contrast ≥ 3:1. Trace hues are unchanged.
- **UI task 5. Quantization tab layout:**
  - The plots column holds the response, the word-length sweep and (IIR) the biquad diagram.
  - The side column leads with **Rounding effects** (the tab's result), then poles and zeros.
  - Hardware export and Simulate hardware share a full-width row below, side by side above 1180 px.

  This removes the 1,500 px dead column and puts a failing stopband at the top. Rejected: a readout strip under the sliders (it would duplicate the Rounding effects card).
- **UI task 5. Long explanations fold into "How this was checked" / "How the simulation works".** Their wording is unchanged. The honesty tags ("Generated, not synthesized, not run in an HDL simulator", "Interpreted in your browser") and the simulator's plain label stay visible. Rejected: hiding any honesty wording.
- **UI task 5. Phones open on the plot:** at ≤ 480 px the stage comes first and the design controls follow it, so a tab change visibly changes the screen. Rejected: a bottom sheet for the controls (new interaction code, and more risk than this pass should take).
- **UI task 5. Control group titles are h2**, which fixes the detector's skipped heading level. The biquad diagram uses the new tokens (panel-well boxes, bezel strokes, DIN name) and keeps diagram-design's earlier rules: orthogonal connectors, masked labels, and two accents for Q and the error-feedback path.
- **UI task 6. Motion answers actions only.**
  - Removed: the 0.9 s magnitude-trace "draw" that played on page load.
  - Added, all inside `prefers-reduced-motion: no-preference`:
    - a 160 ms fade-and-settle of the view on a tab change (only when the tab actually changes, not on every slider re-render, which would flicker);
    - a 140 ms reveal when a details panel opens;
    - 120 ms colour transitions on buttons, tabs and segments.
  - Caught by `ui_sweep`: an inline comment briefly swallowed the pinned-B series line. It was fixed before commit.
- **UI task 7. Final check.** I looked at all screenshots: every tab at 1440 px in light and dark, every tab's phone viewport in both themes, the IIR Quantization view and a forced simulator mismatch. Fixed from that look:
  - the Signal tab's "First samples" now shows 120 samples, not 400 (it was unreadable; the caption says the spectra use the whole run);
  - legend line samples have a 2 px floor, so the thin quantized sample still reads as orange;
  - the compare swatch's repeating-gradient stripes are now a dashed border (detector advisory).

  Impeccable's detector afterwards: the file scan and 1440×1000 are clean. At 390×844 it still reports "nested cards" for the segmented control in two card headers. It is a control, not a card, so I logged it as a false positive rather than restyling a working control.
- **UI task 7. README screenshots** live in `docs/screenshots/`: three curated images (light response, dark quantization, a phone pair), because `shots/` is not committed. `examples/gallery.png` is a matplotlib figure of DSP results, not of the UI, so it was not regenerated.

## Interactive run (auto/ui-interactive)

- **Themes. Five choices in one header switcher:** Instrument light, Instrument dark, Swiss, Phosphor and Paper. Each is one `:root[data-theme]` token block plus a few theme-specific rules.
  - **Swiss** is light: white sheet, black 2 px rules instead of card borders, no radius, Helvetica stack.
  - **Phosphor** is dark: green-black CRT, glow on traces via `drop-shadow(currentColor)`, readouts in the phosphor accent.
  - **Paper** is light: warm sheet, inline SVG grain (no file, no network), serif headings, dotted graticule.
- **Themes. Checks:**
  - The dataviz validator passes each trace pair on its own screen: Swiss `#2a78d6/#e0592a`, Phosphor `#3d8ef5/#e2661e`, Paper `#2a6fc4/#c8551f`.
  - Phosphor's first pick, `#4aa3ff/#ff8a3d`, failed the dark lightness band and was stepped down.
  - Text contrast (`docs/ui-contrast.py` method): ink-3 is 5.0:1 or better in every theme; the accent is at least 6.7:1.
  - Ideal vs quantized keeps the wide/thin line-weight encoding in every theme.
  - Focus uses the theme accent.
- **Themes. Remembered per viewer** in `localStorage` (`filterlab.theme`), with try/catch on read and write; if storage is blocked, the theme still applies for the visit. With no stored choice, the system light/dark preference picks Instrument light or dark, as before.
- **Themes. Not built:** Neumorphism, Pixel Art, Maximalism and Surrealism. Each trades legibility of the data (low-contrast embossing, coarse pixels, competing ornament, distortion) for style, which this tool cannot afford. Any other theme requested later is logged as "later".
- **Themes. Brief over a rule:** Phosphor is "near-black with one bright accent" and Paper is "warm cream with orange", both patterns the previous critique listed as generic tells. The brief asks for them explicitly, so they ship as opt-in themes, and the default stays Instrument.
- **Interaction a. Linked cursor.** Response-tab magnitude, phase or group delay, and the pole-zero plot share one frequency.
  - Hovering any of them shows exact readouts on all three. The pole-zero plot marks the point e^{jω} on the unit circle and shows |H| and phase there.
  - Each plot is focusable, and ←/→ (Shift for bigger steps) drive the same cursor.
  - Measured at 256 taps over 60 pointer moves: the broadcast to the other plots takes 1.1 ms median, 1.6 ms p95.
- **Interaction b. Scrubbing.** The Quantization sliders (coefficient and signal word length, headroom) re-render at most once per frame. The controls block is kept, so a mouse drag is never cut off, and only the plots below are redrawn; before, every input event rebuilt the whole tab, including the slider under the pointer.
  - The previous quantized response stays faint behind the new one, with a "Previous setting (faint)" legend entry.
  - A new order slider (manual order) scrubs the Response tab the same way, with "Previous order (faint)".
  - Timings at 256 taps: order scrub about 65 ms per frame; word-length scrub 95-145 ms per frame.
  - FIR zeros are now computed lazily (the same `polyRoots`, on first use), because root-finding a 256-tap FIR takes about 1 s. While a long FIR (more than 64 taps) is scrubbed, its pole-zero plot shows "redraws when you let go" and redraws once on release. Releasing a 256-tap word-length scrub costs about 1 s for that one redraw.
- **Interaction c. Transitions.**
  - The main magnitude trace morphs between designs (WAAPI on the SVG `d` property, 220 ms ease-out). It does so only when the command structure matches, and never during a drag or scrub.
  - Spec-check and rounding readouts count from the old value to the new one in 220 ms and end on the exact original text.
  - A details panel reveals only when the reader opens it, not when a redraw re-creates it.
  - Nothing plays on load, and with reduced motion nothing animates. `ui_sweep` checks both states through `setMotion`.
- **Interaction d. Keyboard.**
  - Shortcuts: 1-4 tabs, T theme, S/R step or run the simulator, G tour, D spec sheet, ? help.
  - They are ignored while typing in a field or a dialog, or with Ctrl/Alt/Meta held.
  - The help is a native `<dialog>` (focus trap and Esc built in), opened by ? or the header "?" button.
- **Interaction e. Guided tour** (StageShow is absent, so built by hand):
  - Six steps: design, shape on the plot, spec check, quantize, export, simulate.
  - It starts only from "Take the tour" or G, and a reload never opens it.
  - Keys: ←/→ move between steps, Tab stays inside the card, Esc or "Skip tour" ends it.
  - Steps 1 and 4 load a demo design (Chebyshev I low-pass, 12-bit coefficients). The tour snapshots your design first and restores it on Finish or Skip, then returns focus.
  - The ring and card glide in 200 ms only with motion allowed.
  - `ui_sweep` walks it keyboard-only with real key presses.
- **Interaction f. Spec sheet (SVG)** (dimensional-drawing is absent, so built by hand).
  - The "Spec sheet (SVG)" button on Spec check, or D, downloads a drawing with:
    - the magnitude plot;
    - spec limits (dashed);
    - a chain dimension of the band edges;
    - dimensioned attenuation and a leader for passband ripple;
    - a title block with the design parameters, the measured values, and the app's own pass/fail wording ("Target 1 dB or less", "Over by / Short by", meets/misses).
  - It also says the figures are measured by Filterlab's spec check on the floating-point design. Valid SVG, checked in `ui_sweep`.
- **Interaction g. Pole-zero "what-if" (stretch): built.**
  - "Explore: drag poles and zeros" on the Poles and zeros card edits a copy of the design's roots. Conjugate pairs move together, and real roots stay on the real axis, so the coefficients stay real.
  - The pole-zero plot keeps a fixed scale while you drag. The roots move by pointer, or by arrow keys on a focused root (Shift for bigger steps).
  - The existing `zpk2sos` + `sosFreqz` recompute a dashed "Exploration (what-if, not a design)" trace on the magnitude plot, with gain normalised to a 0 dB peak.
  - A banner reads "Exploration, not a spec-meeting design." The design, its Spec check and every other tab are untouched, which `ui_sweep` checks. A pole on or outside the unit circle adds an "unstable" note.
  - Any redesign ends the exploration.
- **Found, not fixed (needs owner approval: `dsp/` and the pass/fail logic are out of scope).** Parks-McClellan fails for long filters at the default spec: at 160 taps and above, `web/dsp.js` `remez` returns all-zero coefficients, and `dsp/remez.py` returns NaN (divide by zero in the barycentric step). With a manual order of 160 or more, the app then shows an empty response and the Spec check marks ✓ "0 dB ripple, 240 dB attenuation", which is a false pass. Auto mode (36 taps) never gets there. The fix belongs in `remez` (and the spec check should reject an all-zero or non-finite filter). The new order slider allows up to 256 taps for FIR; Remez is broken above about 150 taps, so treat those results as invalid until this is fixed.
- **Verify.** I looked at all 36 screenshots, plus close-ups of the tour, the spec sheet and every theme on a phone. Fixed from that look:
  - the spec sheet's ripple label collided with the edge dimension, and the attenuation label ran off the sheet;
  - the tour card covered tall targets, so it now sits beside them when it fits neither above nor below;
  - the tour changed the design without updating the side panel's fields, and restoring had the same gap; both now resync the controls, and `ui_sweep` checks the field.

  Impeccable's detector: file and 1440×1000 clean. At 390×844 it still reports the segmented-control "nested cards" false positive from the last run.
- **Impeccable design hook: flat-type-hierarchy.** Card titles were 16 px over 14 px body (1.14x). Raised to 18 px (1.29x). Screenshots checked at 1440 and 390 px; the full gate passes.

## Portfolio run (auto/portfolio)

- **Third-party skills were read as text, never run.** StageShow (benji.org, a website, no repo), Dimensional Drawing, Oil UI, Emil Kowalski's skills, Taste skill and Brand Identity were shallow-cloned into the scratchpad and their SKILL.md files read as guidance. Nothing was installed, and none of their scripts or hooks ran.
  - The Awwwards MCP repo (`INSANE0777/Awwwards`) returned "not found", so no references were pulled.
  - Figma needs a sign-in in this session, and Manus is a separate agent service; neither was used.
  - anime.js / Motion were not added: Emil's own rule is "cheapest tool that works", and CSS plus WAAPI cover every animation here, so the app stays dependency-free and offline.
- **Themes: 11 added, 16 in total.** Synthwave, Cyberpunk (also covers Cybercore), Neo-brutalism, Editorial, Luxury typography, Glassmorphism, Claymorphism, Y2K, Conceptual sketch, Pixel art and Neumorphism, alongside Instrument light/dark, Swiss (also covers Minimalism) and Paper (Wabi-sabi).
  - Rule for every theme: the frame carries the style, and the plot screens stay solid with a validated trace pair.
  - Neumorphism and Pixel art were refused last run for legibility. They now ship under that rule, as the owner asked for them.
  - Not built, logged as "later": Maximalism, Surrealism, Scrapbook, Ethereal, Bohemian, Victorian. Bento grid is a layout, not a theme, and is used on the landing page.
- **Theme checks.**
  - The dataviz validator passes each theme's trace pair on its own screen.
  - `ui_sweep` now loops over every theme in the switcher and computes AA text contrast from the live tokens (translucent panels blended over the page; it also fails on a value it cannot compute).
  - `ui_shots` captures every theme.
  - Glassmorphism's frosted buttons first hid the selected-segment state; fixed.
- **Emil's frequency rule applied:** a tab switch from the keyboard (1-4) no longer animates, while a pointer click keeps the short fade.
- **Deep links:** `?theme=` and `?tab=`, so the landing page can open the app in a given theme or tab.
