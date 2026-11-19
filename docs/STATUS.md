# Status: autonomous run on `auto/rtl-sim`

Run: 2026-11-19, 19:24Z to about 19:50Z (hard stop was 20:54Z). Branch `auto/rtl-sim` from `master` at 4504ae1,
after `auto/rtl-export` had been merged. Nothing was pushed and no remote was added. The previous run's status is in
git history at `36c4f40`.

**Headline: the generated SystemVerilog now runs in the browser, in Filterlab's own interpreter.** It matches the
bit-true model on every design and input tested. It is still **not run in a standard HDL simulator and not
synthesized**: no simulator is installed here (`iverilog`, `vvp` and `verilator` were not found). The generator and
both interpreters (`tests/rtl_eval.py`, `web/rtlsim.js`) were written in this project from one reading of IEEE 1800.
If that reading is wrong somewhere, all three can agree and still be wrong. To close that gap, install
**Icarus Verilog** (free) and run `npm run test:rtl`, which simulates 8 designs and requires zero mismatches.

## Done (nothing cut)

| Task | What landed | Commit |
|---|---|---|
| 1 | `web/rtlsim.js`: tokenizer, parser and evaluator for exactly the generated subset. It applies the IEEE 1800 sizing and sign rules (11.6-11.8), uses BigInt values, runs assigns in dependency order, applies register updates non-blocking, and models X conservatively. Anything else throws "unsupported construct: ..." with its line number | `1c8e173` |
| 2 | `tests/rtlsim_check.js` (`npm run test:rtlsim`, also in `npm run test:all`). It runs 10 designs: both FIR forms, saturate and wrap, headroom, error feedback, and an unscaled cascade that really overflows. Each runs on 512 samples of impulse, step, full-scale square and seeded random input, and must equal the Python evaluator, the Python bit-true model and the JS bit-true model. Also: a mutation test (a one-bit coefficient flip is caught), 12 rejected constructs, hand-made checks of the SV width and sign rules, and a 60-bit datapath against a BigInt reference. `export_reference.py` now exports the Python results | `6ca9114` |
| 3 | "Simulate hardware" card under Hardware export on the Quantization tab. It offers impulse, step, square, sine or seeded noise input of 16-256 samples; Reset, Step 1 clock and Run to end; and an SVG waveform (clk, input, state register, up to 3 accumulators, output) with a cursor. The cursor shows exact integers and Qm.n values on hover, arrow keys, Home and End. A live line reads "N of N samples identical", or gives the first mismatch with both values. There is a data table and the plain label, verbatim. The export card's tag is now "not run in an HDL simulator" | `f113376` |
| 4 | README section and `docs/rtl.md` "In-browser simulation": subset, rules, panel behaviour, limits, and what would close the gap | `b76c2cb` |
| Review | One real bug fixed: a shift amount built from mixed signed widths was zero-extended (generated code only uses literal amounts, so no design changed). Reserved words and over-wide unsized literals are now rejected, and 6 more checks were added | `0a4873e` |

## Final test results (final commit)

| Command | Result |
|---|---|
| `npm run test:py` | pass, 91 tests |
| `npm run test:js` | pass, 204 cross-checks (2 more designs exported: the overflowing cascade, saturate and wrap) |
| `npm run test:rtl` | pass, 22 tests. **The iverilog step was skipped (not installed)** |
| `npm run test:rtlsim` | pass, 86 checks |
| `node tests/ui_sweep.js` | pass. New checks for FIR and IIR: 64 of 64 identical, the plain label present, Reset, three single steps ("3 of 3 so far"), arrow-key and hover cursor readouts, four inputs and lengths (16 to 256), and a forced mismatch reported with its clock and values. No sideways scroll at 1440 px |
| `node tests/ui_shots.js` | pass, 24 screenshots, no console errors. I also looked at panel close-ups in light and dark at 1440 and 390 px, including a forced-mismatch view |

## Decisions to review (details in `docs/DECISIONS.md`)

- The panel is its own card under Hardware export, not part of that card.
- Stepping is real, and forward only: a simulator cannot step back. The cursor inspects any clock already simulated.
- The waveform shows true register timing: out_data changes at the edge that ends each clock, one clock late.
- The default is 32 samples, so clock edges are visible on a phone.
- The X model is all-or-nothing. It is more pessimistic than a real simulator for `?:` with an X condition. This is disclosed and cannot happen in generated code after reset.
- The export tag changed from "not simulated" to "not run in an HDL simulator".

## Needs owner approval

Nothing. No existing public signature changed (`dsp/` is untouched).

## Not verified

- That a standard simulator or synthesis tool accepts the generated text, and agrees with these interpreters on it.
- Touch interaction on a real phone. The 390 px layout was checked only by screenshot, and the cursor was driven by synthetic mouse and key events.
- The download buttons, by clicking them in a real browser (unchanged from the last run).
- Responsiveness on slow machines: each slider movement re-simulates up to 256 clocks. That is fast here, but it was not profiled.

Plugins used: superpowers (plan and verification discipline from the earlier runs), and agent-skills' code-reviewer for the independent review.
