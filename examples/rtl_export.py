"""Export a quantized Chebyshev I low-pass as SystemVerilog, with a self-checking testbench and vectors.

Run from the repo root:  python examples/rtl_export.py
Writes build/rtl_example/ (git-ignored) and prints how to simulate it with Icarus Verilog.
"""
import sys, os; sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import numpy as np
from dsp import design_iir, min_order, quantize_sos, QFormat
from dsp.quant import to_int
from dsp.rtl import gen_sos_sv, gen_testbench_sv, rtl_stimulus, rtl_expected_sos, vectors_hex

fs = 48000.0
n = min_order("cheby1", "lowpass", [4000], [6000], 0.5, 60, fs=fs)
d = design_iir("cheby1", "lowpass", n, 4000, fs=fs, rp=0.5)
coef_fmt, sq, gain = quantize_sos(d["sos"], 18)            # peak-scaled sections, one shared 18-bit format
sig_fmt = QFormat(0, 15)                                    # 16-bit samples
sos_int = np.array([to_int(s[[0, 1, 2, 4, 5]], coef_fmt) for s in sq])
opts = dict(overflow="saturate", headroom_bits=1, error_feedback=True)

name = "cheby1_lp"
sv = gen_sos_sv(sos_int, coef_fmt, sig_fmt, module_name=name, **opts)
x = rtl_stimulus(sig_fmt, seed=1)                           # impulse, step, square, random
y = rtl_expected_sos(sos_int, coef_fmt, sig_fmt, x, **opts) # what simulate_sos_fixed says the module must output

out = os.path.join(os.path.dirname(__file__), "..", "build", "rtl_example"); os.makedirs(out, exist_ok=True)
for fn, txt in ((f"{name}.sv", sv), (f"{name}_tb.sv", gen_testbench_sv(name, sig_fmt, len(x), f"{name}.hex")), (f"{name}.hex", vectors_hex(x, y, sig_fmt))):
    with open(os.path.join(out, fn), "w", encoding="utf-8", newline="\n") as f: f.write(txt)

print(f"order {n} Chebyshev I, {len(sos_int)} biquads, coefficients {coef_fmt}, signal {sig_fmt}")
print(f"multiply out_data by {gain * 2 ** opts['headroom_bits']:.6g} (leftover gain x 2^headroom) downstream")
print(f"wrote {os.path.normpath(out)}: {name}.sv, {name}_tb.sv, {name}.hex ({len(x)} vectors)")
print("simulate (Icarus Verilog), from that folder:")
print(f"  iverilog -g2012 -o {name}.vvp {name}.sv {name}_tb.sv")
print(f"  vvp {name}.vvp          # prints PASS when all {len(x)} outputs match")
