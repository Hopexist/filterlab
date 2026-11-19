# Status: autonomous run on `auto/rtl-export`

Run: 2026-11-19, 16:54Z to about 17:15Z (hard stop was 18:54Z). Branch `auto/rtl-export` from `master` at
57b397e. Nothing was pushed and no remote was added. The previous run's status is in git history at `ce0a39d`.

**Headline: the RTL is generated, not synthesized, and NOT simulated.** No HDL simulator is installed
(`where iverilog`, `where verilator` and `where vvp` found nothing; neither did yosys). The arithmetic is checked
against the Python bit-true simulators by an independent evaluator of the generated text, but no simulator has
run it. To simulate it, install **Icarus Verilog** (free; on Windows the bleyer.org installer puts
`iverilog`/`vvp` on the PATH) and run `npm run test:rtl`. It then simulates 8 designs and requires zero mismatches.

## Done (nothing cut)

| Task | What landed | Commit |
|---|---|---|
| 1-2 | `dsp/rtl.py`: `gen_fir_sv` (direct, transposed), `gen_sos_sv` (DF-I cascade, overflow, headroom, error feedback), `gen_testbench_sv`, `rtl_stimulus`, `rtl_expected_fir/sos`, `vectors_hex`, `acc_width_*`. `tests/rtl_eval.py`: independent executor of the generated SV. `tests/test_rtl.py`; `tests/rtl_sim.py` + `npm run test:rtl` (runs iverilog when present) | `15e049d` |
| 3 | `web/rtl.js`, byte-identical text; `cross_check` compares 8 designs + testbench + vectors | `8658fde` |
| 4 | Hardware export card on the Quantization tab: structure choice, copy, download module, download testbench and vectors, assumptions, honest label. Also fixed a 110 px sideways scroll on the IIR Quantization tab (from the last run) and added a 1440 px no-overflow check for every tab | `d5be1a1` |
| 5 | `docs/rtl.md` (API, interface, latency, simulator-to-RTL arithmetic table, width derivation, verification, how to simulate), README section, `examples/rtl_export.py` | `4d8725b` |
| 6 (stretch) | Cost report: `csd`, `rtl_cost_fir`, `rtl_cost_sos` (Python + JS, cross-checked), shown in the export card. Counts only, no area or Fmax | `5c11bee` |

## Final test results (final commit)

| Command | Result |
|---|---|
| `npm run test:py` | pass, 91 tests (69 before + 22 RTL) |
| `npm run test:js` (export_reference, then cross_check) | pass, 200 checks (181 before + 8 RTL text + testbench + vectors + 8 cost + CSD) |
| `npm run test:rtl` | pass: 22 pytest RTL tests. **Simulation step skipped: iverilog not installed (printed as "NOT simulated")** |
| `node tests/ui_sweep.js` | pass: 24/24 designs, all earlier checks, plus no sideways scroll on any tab (FIR and IIR) at 1440 px, and the export card for FIR and IIR with the honest label and complete text |
| `node tests/ui_shots.js` | pass, 24 screenshots, no console errors; the export card was also looked at in light and dark at 1440 and 390 px |

What the RTL tests prove, and how:
- **Bit-exactness against `simulate_*_fixed`.** The independent evaluator runs the generated text on impulse,
  full-scale step, full-scale square and seeded random input. The cases cover:
  - FIR direct and transposed, saturate and wrap;
  - SOS with headroom 0, 1 and 2, with and without error feedback;
  - an unscaled resonant cascade that really saturates and wraps;
  - coefficients with no fraction bits;
  - the browser's path (JS text with JS-simulated vectors).
- **The comparison can fail.** A mutation test changes one coefficient by one LSB and requires a mismatch.
- **Structure.** Ports, widths, accumulator width = the stated bound, and every constant against
  `h_int`/`sos_int`.
- **Python and JS agree.** Byte-identical module, testbench and vectors text for 8 designs, including
  elliptic band-pass cascades.

## Needs owner approval

None. Only new functions were added (`dsp/rtl.py`, `web/rtl.js`); no existing signature changed.

## Decisions to review (all in docs/DECISIONS.md)

- **Interface:** one sample per clock, registered output (latency 1), synchronous active-high reset, **no
  pipelining**. The whole multiply-add chain must fit in one clock period.
- **Headroom happens inside the module:** `(x + 2^(h-1)) >>> h`. It equals the simulator for on-grid inputs. The
  leftover cascade gain stays outside the module, as in the simulator.
- **`sos_int` rows are `[b0, b1, b2, a1, a2]`**, the C-export layout.
- **The export is a card on the Quantization tab, not a new tab.** It uses that tab's settings directly.
- **The browser's testbench stimulus uses the JS generator** (not numpy's). Expected outputs come from the JS
  simulator, and pytest covers that path.
- **The cost report counts the generated structure:** no symmetric-tap folding, no sub-expression sharing.

## Known limits

- **No pipelining.** Long FIRs and deep cascades will limit the clock rate. How much is unknown without synthesis.
- **Unscaled bound, not typical.** The accumulator width is the worst case for any input, so it is safe rather than
  minimal for typical signals.
- **IIR export always uses the biquad cascade**, even if the Quantization tab's Structure is "single direct form"
  (the card says so). Unstable quantized cascades are not exported.
- **Fixed module names:** `filterlab_fir` / `filterlab_sos` in the app. The Python API takes any valid identifier.

## Not verified

- **Any HDL simulator or synthesis tool** accepting the generated text. The subset is deliberately plain
  (`logic`, `always_ff`, `assign`, `>>>`, sized signed literals) but is unconfirmed. The same goes for the
  testbench (`$readmemh`, `$signed`, `#1` after the clock edge).
- **The browser downloads** (Blob + `a[download]` from `file://`): the code path was not clicked through in a
  real browser. The text is checked through `#rtlText`, which uses the same strings.
- **Phone layout** was checked in headless Edge at 390 px, not on a touch device.

## Plugins used

superpowers (plans, failing tests first, verification before each commit). impeccable's design hook scanned
the CSS edits and found nothing. ui-ux-pro-max, diagram-design, ecc, agent-skills and claude-security were not
used this run. No new HTML sinks take user text: module names are fixed and the generated text is inserted with
`textContent`.
