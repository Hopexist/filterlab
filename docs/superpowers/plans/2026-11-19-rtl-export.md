# RTL export — implementation plan

> Autonomous run, plan pre-approved. No HDL simulator on this machine, so task 2 takes the "no simulator" path.

**Goal:** turn a quantized design into synthesizable SystemVerilog whose output equals `simulate_fir_fixed` /
`simulate_sos_fixed` bit for bit. Additive API only: `dsp/rtl.py`, `web/rtl.js`.

## Architecture
- One sample per clock: `in_valid`/`in_data` in, `out_valid`/`out_data` registered, latency 1 clock; synchronous
  active-high `rst`. Datapath is combinational between the input and the output register (no pipelining).
- Generated text uses a deliberately small SV subset: signed `logic` declarations, `assign` with + - * >>> <<<
  and one saturating ternary, signed sized literals (`N'sdV`), and one `always_ff` whose `if (in_valid)` block
  contains only `reg <= wire;`. Widths follow from the integer coefficients: ACC_W = bitlen(M) + 1 where M bounds
  |acc + half| (derivation in each header). Wrap = implicit truncation on assignment.
- Headroom: the module takes full-scale samples and applies `(x + 2^(h-1)) >>> h`, which equals the simulator's
  `to_int(x * 2^-h)` exactly for on-grid inputs. The leftover cascade gain stays outside the module (as in the
  simulator, which returns the cascade output before gain).
- Verification without a simulator: `tests/rtl_eval.py` parses the generated text and executes it cycle by cycle
  with two's-complement width semantics; it never imports `simulate_*`. pytest compares it with `simulate_*_fixed`
  on impulse, full-scale step, full-scale square and seeded random stimulus, and a mutation test proves the
  evaluator notices a one-bit change in the RTL.

## Review focus
1. sh = 0 (coefficients with no fraction bits) -> no rounding stage, half = 0.
2. Saturation literals at the word edges (-2^(SW-1)) -> literals sized one bit wider than the value.
3. Wrap on a resonant section with full-scale square input -> exercised in the vectors.
4. Error-feedback residual width -> r in [-half, half), RW = SH + 1.
5. JS BigInt for the width bound (exceeds 2^53 at 24-bit coefficients x 20-bit signals).

### Tasks
1. `dsp/rtl.py`: `gen_fir_sv`, `gen_sos_sv`, `rtl_stimulus`, `rtl_expected_fir`, `rtl_expected_sos`, `vectors_hex`, `gen_testbench_sv`.
2. `tests/rtl_eval.py` + `tests/test_rtl.py`; `npm run test:rtl` runs the RTL tests (and iverilog when present).
3. `web/rtl.js` byte-identical; cross_check compares >= 6 designs.
4. Export section in the app (form, copy, download, assumptions, "generated, not synthesized, not simulated").
5. `docs/rtl.md`, README section, `examples/rtl_export.py`.
6. Stretch: CSD adder-count cost report.
