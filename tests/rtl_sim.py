"""Simulate every generated RTL design against its vectors with Icarus Verilog, if it is installed.

Writes each module, testbench and $readmemh vectors file to build/rtl/, runs `iverilog -g2012` and `vvp`, and
requires "PASS" (zero mismatches) from every testbench. Without iverilog it says so and exits 0: the
structural and evaluator tests in tests/test_rtl.py still run, but the RTL is then *not simulated*.
"""
import sys, os, shutil, subprocess
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import numpy as np
from dsp import *
from dsp.quant import to_int
from dsp.rtl import gen_fir_sv, gen_sos_sv, gen_testbench_sv, rtl_stimulus, rtl_expected_fir, rtl_expected_sos, vectors_hex

SF = QFormat(0, 15)

def designs():
    h = remez(31, [0, .2, .3, .5], [1, 0], fs=1.0); q = quantize_fir(h, 12, 1.0); h_int = to_int(q["hq"], q["fmt"])
    for form in ("direct", "transposed"):
        for ov in ("saturate", "wrap"):
            name = f"fir_{form}_{ov}"
            yield name, gen_fir_sv(h_int, q["fmt"], SF, overflow=ov, form=form, module_name=name), lambda x, ov=ov: rtl_expected_fir(h_int, q["fmt"], SF, x, overflow=ov)
    d = design_iir("cheby1", "lowpass", 4, 0.1, fs=1.0, rp=1.0); fmt, sq, g = quantize_sos(d["sos"], 16)
    s_int = np.array([to_int(s[[0, 1, 2, 4, 5]], fmt) for s in sq])
    for ov in ("saturate", "wrap"):
        for hb, ef in ((0, False), (2, True)):
            name = f"sos_{ov}_h{hb}_{'ef' if ef else 'plain'}"
            yield name, gen_sos_sv(s_int, fmt, SF, overflow=ov, headroom_bits=hb, error_feedback=ef, module_name=name), \
                lambda x, ov=ov, hb=hb, ef=ef: rtl_expected_sos(s_int, fmt, SF, x, overflow=ov, headroom_bits=hb, error_feedback=ef)

def main():
    iverilog, vvp = shutil.which("iverilog"), shutil.which("vvp")
    if not (iverilog and vvp):
        print("iverilog/vvp not found: the RTL was NOT simulated (tests/test_rtl.py checks structure and arithmetic).")
        print("Install Icarus Verilog (free) and re-run `npm run test:rtl` to simulate it.")
        return 0
    out = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "build", "rtl"); os.makedirs(out, exist_ok=True)
    fails = 0
    for name, sv, expect in designs():
        x = rtl_stimulus(SF, seed=7); y = expect(x)
        for fn, txt in ((f"{name}.sv", sv), (f"{name}_tb.sv", gen_testbench_sv(name, SF, len(x), f"{name}.hex")), (f"{name}.hex", vectors_hex(x, y, SF))):
            with open(os.path.join(out, fn), "w", encoding="utf-8", newline="\n") as f: f.write(txt)
        r = subprocess.run([iverilog, "-g2012", "-o", f"{name}.vvp", f"{name}.sv", f"{name}_tb.sv"], cwd=out, capture_output=True, text=True)
        log = r.stdout + r.stderr
        if r.returncode == 0:
            r = subprocess.run([vvp, f"{name}.vvp"], cwd=out, capture_output=True, text=True); log = r.stdout + r.stderr
        ok = r.returncode == 0 and "PASS" in log.split()
        fails += not ok
        print("ok  " if ok else "FAIL", name, "|", (log.strip().splitlines() or ["(no output)"])[-2 if ok else -1])
    print(f"\n{fails} RTL simulation(s) failed" if fails else "\nall RTL simulations passed: zero mismatches")
    return 1 if fails else 0

if __name__ == "__main__":
    sys.exit(main())
