# SystemVerilog export

`dsp/rtl.py` (and its byte-identical JavaScript port `web/rtl.js`) turns a quantized Filterlab design into a
synthesizable SystemVerilog module. The module computes exactly what the Python bit-true simulators
`simulate_fir_fixed` and `simulate_sos_fixed` compute, sample for sample.

> **Status: generated, not synthesized, not run in a standard HDL simulator.** No HDL simulator was installed
> where this was built. The arithmetic is checked by two interpreters written for this project (below), both in
> the tests and, for `web/rtlsim.js`, live in the browser. Run the generated testbench with
> [Icarus Verilog](https://steveicarus.github.io/iverilog/) (free) to simulate it with a standard tool.
> `npm run test:rtl` does this automatically once `iverilog` and `vvp` are on the PATH. No area, timing or Fmax
> figures are claimed anywhere: no synthesis tool was used.

## API

```python
from dsp.rtl import gen_fir_sv, gen_sos_sv, gen_testbench_sv, rtl_stimulus, rtl_expected_fir, rtl_expected_sos, vectors_hex

gen_fir_sv(h_int, coef_fmt, sig_fmt, *, overflow="saturate", form="direct", module_name="fir_q")
gen_sos_sv(sos_int, coef_fmt, sig_fmt, *, overflow="saturate", headroom_bits=0, error_feedback=False, module_name="sos_q")
gen_testbench_sv(module_name, sig_fmt, n_vectors, vectors_file)
rtl_stimulus(sig_fmt, seed=1)                  # integer samples: impulse, full-scale step and square, seeded random
rtl_expected_fir(h_int, coef_fmt, sig_fmt, x_int, *, overflow)                                # from simulate_fir_fixed
rtl_expected_sos(sos_int, coef_fmt, sig_fmt, x_int, *, overflow, headroom_bits, error_feedback)  # from simulate_sos_fixed
vectors_hex(x_int, y_int, sig_fmt)             # $readmemh text: one {in, expected out} word per line
```

- `h_int`: integer taps, `to_int(h, coef_fmt)`, for example from `quantize_fir`.
- `sos_int`: integer rows `[b0, b1, b2, a1, a2]` (a0 = 1 implied) of the **peak-scaled, quantized** cascade from
  `quantize_sos`: `to_int(sq[:, [0, 1, 2, 4, 5]], coef_fmt)`. Same layout as the app's C export.
- `form` (FIR): `"direct"` (tap delay line, one adder tree) or `"transposed"` (registered partial sums). Both give
  identical outputs because every partial sum is exact.
- JS: `RTL.genFirSv(hInt, coefFmt, sigFmt, {overflow, form, moduleName})`, `RTL.genSosSv(sosInt, coefFmt, sigFmt,
  {overflow, headroomBits, errorFeedback, moduleName})`, `RTL.genTestbenchSv`, `RTL.vectorsHex`.

## Interface and timing

```
module NAME (
  input  logic clk,
  input  logic rst,                          // synchronous, active high: clears all state
  input  logic in_valid,                     // one new sample on each clock where this is high
  input  logic signed [SW-1:0] in_data,      // Qm.n signal format (sig_fmt), two's complement
  output logic out_valid,                    // in_valid delayed by one clock
  output logic signed [SW-1:0] out_data      // result for that sample, same format
);
```

- **Latency: 1 clock.** The datapath from `in_data` to the output register is combinational. When `in_valid` is
  low, state holds and `out_valid` goes low.
- **No pipelining.** The whole multiply-add chain (all taps, or all sections in series) must settle in one clock
  period. That is the simplest structure that matches the simulator. A pipelined cascade would add per-section
  latency and needs its own timing model; it is not generated.
- **Gain is outside the module.** For IIR cascades, `out_data` is the cascade output. Multiply it by the leftover
  gain from `quantize_sos` times `2^headroom_bits` downstream, exactly as for `simulate_sos_fixed`.

## Arithmetic (why it is bit-identical)

With `SW = sig_fmt.word` and `SH = coef_fmt.frac_bits`:

| Step | Simulator (`dsp/quant.py`) | Generated RTL |
|---|---|---|
| Input headroom (IIR) | `to_int(x * 2^-h)` | `(in_data + 2^(h-1)) >>> h`. Equal for on-grid inputs: both are round-half-up of `x_int / 2^h` |
| Accumulate | exact Python integers | one `ACC_W`-bit signed accumulator that provably cannot overflow (below) |
| Round | `(acc + 2^(SH-1)) >> SH` | `(acc + 2^(SH-1)) >>> SH` (arithmetic shift = floor) |
| Saturate | clamp to `[-2^(SW-1), 2^(SW-1)-1]` | ternary against signed literals sized one bit wider than the value |
| Wrap | `(v - lo) mod 2^SW + lo` | implicit truncation when assigning to an `SW`-bit signal |
| Error feedback | `acc - c1 r[n-1] - c2 r[n-2]`, `c = (a + 2^(SH-1)) >> SH`, `r = acc - (yr << SH)` | same expressions; `r` is `SH + 1` bits (it lies in `[-2^(SH-1), 2^(SH-1))`) |
| DF-I state | `x1 <- v`, `y1 <- limited y` | the same registers, updated only when `in_valid` |

Every operand is signed, so SystemVerilog extends all operands to the assignment width and the results of `+`,
`-`, `*` and `<<<` are exact modulo `2^width`. Each accumulator is wide enough to hold the true value, so modular
arithmetic changes nothing.

**Accumulator width.** For an FIR, `|acc + 2^(SH-1)| <= M = sum|h_k| * 2^(SW-1) + 2^(SH-1)`, because every
input sample has magnitude at most `2^(SW-1)`. For a DF-I section,
`M = (|b0|+|b1|+|b2|+|a1|+|a2|) * 2^(SW-1) + (|c1|+|c2|) * 2^(SH-1) + 2^(SH-1)` (the delayed outputs are limited to
`SW` bits; the error terms are below `2^(SH-1)`). Then `ACC_W = bitlen(M) + 1`. It uses the actual integer
coefficients, not their word length, so it is the smallest width that is safe for every input. Each generated
header states the derivation and the numbers.

## Verification

1. **Independent evaluator** (`tests/rtl_eval.py`). It parses the generated SystemVerilog subset (signed
   declarations, `assign` with `+ - * >>> <<<` and the saturating ternary, sized literals, one `always_ff`
   block) and executes it cycle by cycle with two's-complement width rules and non-blocking register
   updates. It does not import the simulators.
2. **pytest** (`tests/test_rtl.py`, 22 tests). The evaluator's output equals `simulate_*_fixed` on impulse,
   full-scale step, full-scale square and seeded random input. The cases cover:
   - FIR direct and transposed, saturate and wrap;
   - SOS with headroom and error feedback;
   - an unscaled resonant cascade that really saturates and wraps;
   - coefficients with no fraction bits;
   - the browser path (JS text with JS-simulated vectors).

   Structural checks cover ports, widths and every constant against `h_int`/`sos_int`. A mutation test changes
   one coefficient by one LSB and requires a mismatch.
3. **Python and JS agreement.** `tests/cross_check.js` requires byte-identical module, testbench and vectors
   text for 8 designs.
4. **HDL simulation** (`tests/rtl_sim.py`, `npm run test:rtl`). Writes 8 designs with testbenches to
   `build/rtl/` and runs `iverilog -g2012` + `vvp`, requiring `PASS`. It is skipped, with a clear message,
   when Icarus Verilog is not installed. **It has not run yet.**

5. **In-browser interpreter** (`web/rtlsim.js`, `npm run test:rtlsim`, 86 checks). It is a second, separately
   written executor (a parser rather than regexes, but by the same author from the same reading of the standard;
   see the next section). It runs 10 designs (the 8 above plus an unscaled cascade that really
   saturates and wraps) on 512 samples each, and its output must equal the Python evaluator's, the Python bit-true
   model's and the JS bit-true model's. A one-bit flip of one coefficient literal must be detected.

What this does not prove: that a real simulator or synthesis tool accepts every construct. The subset is
deliberately plain (IEEE 1800 `logic`, `always_ff`, `>>>`, sized signed literals), but it is unconfirmed until
`npm run test:rtl` runs with iverilog installed.

## Simulate it yourself

```
python examples/rtl_export.py              # writes build/rtl_example/cheby1_lp.sv, _tb.sv, .hex
cd build/rtl_example
iverilog -g2012 -o cheby1_lp.vvp cheby1_lp.sv cheby1_lp_tb.sv
vvp cheby1_lp.vvp                          # "cheby1_lp: 512 vectors, 0 mismatches" then PASS
```

In the app, the Quantization tab's **Hardware export** card gives the same module for the current design and
settings, plus a testbench and vectors file to download. **Simulate hardware** under it runs that module in the
browser (see [In-browser simulation](#in-browser-simulation)).

## In-browser simulation

The Quantization tab's **Simulate hardware** panel runs the module that the Hardware export card shows, using
`web/rtlsim.js`. That file is an interpreter for exactly the subset `dsp/rtl.py` and `web/rtl.js` emit. It parses
the generated text, not the design parameters: a hand edit to the text changes what it simulates.

**Supported subset.**
- `module name (...)` with `input|output logic [signed] [N:0] name` ports.
- Declarations: `logic [signed] [N:0] a, b;`, with ranges written `[N:0]`.
- `assign w = expr;`
- One `always_ff @(posedge clk)` block containing `begin`/`end`, `if`/`else` and non-blocking `r <= expr;`.
- Expressions: identifiers, sized literals `N'sdV`, `N'dV` and `N'bB`, unsized decimals, `'0`, unary `+` and `-`,
  binary `*`, `+`, `-`, `<<<`, `>>>`, `<` and `>`, parentheses and `?:`.
- `//` comments.

Anything else is rejected with "unsupported construct: ..." and its line number. That includes `/`, `==`, bit
selects, concatenation, `wire` and other reserved words, plain `always`, `initial`, system tasks, unsized literals
that do not fit 32 bits, a second driver, an undeclared name and a
combinational loop.

**Rules it applies** (IEEE 1800-2017, 11.6 to 11.8).
- An expression is signed only if all of its context-determined operands are signed.
- The context width is the larger of the left-hand side's width and the widest operand.
- Operands are converted to the expression's type, then extended, with sign extension only when that type is
  signed.
- Each `+`, `-`, `*` and `<<<` wraps to the context width. `>>>` is arithmetic when the expression is signed and
  logical when it is unsigned.
- Shift amounts and conditions are self-determined. `<` and `>` compare at the wider operand's width and give a
  1-bit unsigned result.
- Assignment truncates to the left-hand side's width.
- Continuous assigns are evaluated in dependency order. Register updates are non-blocking: every right-hand side
  is read before any register changes.
- All values are BigInt, so the result is exact at any width (tested with a 60-bit accumulator).

**What the panel does.**
- Reset applies one clock with `rst` high. Each later clock sets `in_valid = 1` and the next input sample.
- The waveform shows true register timing: `out_data` changes at the rising edge that ends each clock, one clock
  after its input.
- The comparison is with this tab's bit-true model (`firFixedSim`/`sosFixedSim`), computed live.

**Limits.**
- It is not a general SystemVerilog simulator. It has no event scheduler, no `#` delays, and no X/Z bit
  semantics. A register is X until it is assigned, and any X operand makes the whole result X; that is a
  conservative stand-in for 4-state logic. A real simulator can be less pessimistic: `c ? 4 : 4` with c = X gives 4 there, X here.
- It models one clock and treats each step as one rising edge.
- The interpreter and the generator were written by the same project from the same reading of the standard. If
  both misread a rule the same way, they agree with each other and can still be wrong. The Python evaluator, the
  bit-true models and the mutation test do not remove that risk.
- What would close the gap is any standard HDL simulator running `npm run test:rtl` (Icarus Verilog, Verilator or
  a commercial tool), plus a synthesis run for anything about area or timing.

## Hardware cost report (counts only)

`csd(v)`, `rtl_cost_fir(h_int, coef_fmt, sig_fmt, *, form)` and `rtl_cost_sos(sos_int, coef_fmt, sig_fmt, *, error_feedback)`
(JS: `RTL.csd`, `RTL.rtlCostFir`, `RTL.rtlCostSos`, cross-checked) count what the generated structure contains:

- **multipliers**: one general multiplier per non-zero coefficient;
- **csd_adders**: the adders and subtractors needed if each coefficient multiply is built from shifts of its
  canonical-signed-digit (non-adjacent) form instead, which is digits minus one per coefficient;
- **accumulation_adders**: adders that sum the non-zero products, plus the rounding adder (and, with error feedback,
  the feedback terms and the residual subtractor, whose constants round(a) lie in {-2..2} and are therefore shifts);
- **acc_bits** (per section for IIR) and **register_bits** (state plus the output register).

These are counts, not area, power or speed: those depend on the target technology and need a synthesis tool,
which was not available. The counts describe the generated structure as it is. A linear-phase FIR's symmetric
taps could share multipliers (pre-add `x[n-k] + x[n-N+1+k]` first, roughly halving them), and constant
multipliers can share sub-expressions. Neither optimisation is generated or counted.
