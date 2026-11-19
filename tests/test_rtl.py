"""RTL export: structure of the generated SystemVerilog, and bit-exactness against simulate_*_fixed through the
independent text evaluator tests/rtl_eval.py (no HDL simulator is installed on the development machine)."""
import sys, os, re; sys.path.insert(0, os.path.dirname(os.path.dirname(__file__))); sys.path.insert(0, os.path.dirname(__file__))
import numpy as np, pytest
from dsp import *
from dsp.quant import to_int
from dsp.rtl import (gen_fir_sv, gen_sos_sv, gen_testbench_sv, rtl_stimulus, rtl_expected_fir, rtl_expected_sos,
                     vectors_hex, acc_width_fir, acc_width_sos)
import rtl_eval

SF = QFormat(0, 15)

def fir_case(word=12):
    h = remez(31, [0, .2, .3, .5], [1, 0], fs=1.0); q = quantize_fir(h, word, 1.0)
    return to_int(q["hq"], q["fmt"]), q["fmt"]

def sos_case(kind="cheby1", n=4, edge=0.1, word=16):
    d = design_iir(kind, "lowpass", n, edge, fs=1.0, rp=1.0, rs=50.0); fmt, sq, g = quantize_sos(d["sos"], word)
    return np.array([to_int(s[[0, 1, 2, 4, 5]], fmt) for s in sq]), fmt

@pytest.mark.parametrize("form", ["direct", "transposed"])
@pytest.mark.parametrize("overflow", ["saturate", "wrap"])
def test_fir_rtl_bit_exact(form, overflow):
    h_int, cf = fir_case()
    h_int = h_int * 3                                       # louder taps: the square wave overflows Q0.15
    cf = QFormat(cf.int_bits + 2, cf.frac_bits)
    sv = gen_fir_sv(h_int, cf, SF, overflow=overflow, form=form, module_name="fir_t")
    x = rtl_stimulus(SF, seed=3)
    exp = rtl_expected_fir(h_int, cf, SF, x, overflow=overflow)
    assert rtl_eval.run(sv, x) == list(exp)
    assert np.any(np.abs(exp) == 2 ** 15 - 1) or overflow == "wrap"     # the case really reaches full scale

@pytest.mark.parametrize("overflow", ["saturate", "wrap"])
@pytest.mark.parametrize("headroom,ef", [(0, False), (2, False), (0, True), (1, True)])
def test_sos_rtl_bit_exact(overflow, headroom, ef):
    sos_int, cf = sos_case()
    sv = gen_sos_sv(sos_int, cf, SF, overflow=overflow, headroom_bits=headroom, error_feedback=ef, module_name="sos_t")
    x = rtl_stimulus(SF, seed=4)
    exp = rtl_expected_sos(sos_int, cf, SF, x, overflow=overflow, headroom_bits=headroom, error_feedback=ef)
    assert rtl_eval.run(sv, x) == list(exp)

def test_unscaled_resonant_cascade_overflows_and_still_matches():
    d = design_iir("cheby1", "lowpass", 4, 0.1, fs=1.0, rp=1.0)
    cf = auto_format(np.abs(d["sos"]).max(), 18)
    sos_int = np.array([to_int(s[[0, 1, 2, 4, 5]], cf) for s in d["sos"]])
    x = rtl_stimulus(SF, seed=5)
    for ov in ("saturate", "wrap"):
        exp = rtl_expected_sos(sos_int, cf, SF, x, overflow=ov)
        assert rtl_eval.run(gen_sos_sv(sos_int, cf, SF, overflow=ov, module_name="s"), x) == list(exp)
    assert np.any(np.abs(rtl_expected_sos(sos_int, cf, SF, x, overflow="saturate")) == 2 ** 15 - 1)

def test_no_fraction_bits():
    h_int = np.array([1, -2, 3, -2, 1]); cf = QFormat(3, 0); x = rtl_stimulus(SF, seed=6)
    sv = gen_fir_sv(h_int, cf, SF, overflow="saturate", module_name="f0")
    assert "assign yr = acc;" in sv and "accr" not in sv and rtl_eval.run(sv, x) == list(rtl_expected_fir(h_int, cf, SF, x, overflow="saturate"))

def test_evaluator_catches_a_one_bit_change():
    sos_int, cf = sos_case(); x = rtl_stimulus(SF, seed=4)
    sv = gen_sos_sv(sos_int, cf, SF, overflow="saturate", module_name="m")
    b0 = int(sos_int[0, 0]); w = abs(b0).bit_length() + 1
    lit = f"{w}'sd{abs(b0)}"; assert lit in sv
    bad = sv.replace(lit, f"{w}'sd{abs(b0) + 1}", 1)
    assert rtl_eval.run(bad, x) != list(rtl_expected_sos(sos_int, cf, SF, x, overflow="saturate"))

def test_structure_ports_widths_constants():
    h_int, cf = fir_case()
    sv = gen_fir_sv(h_int, cf, SF, overflow="saturate", form="direct", module_name="fir_s")
    assert re.search(r"module fir_s \(", sv) and "endmodule" in sv
    for port in ("input  logic clk", "input  logic rst", "input  logic in_valid", "input  logic signed [15:0] in_data",
                 "output logic out_valid", "output logic signed [15:0] out_data"):
        assert port in sv
    acc = re.search(r"assign acc =(.*?);", sv, re.S).group(1)
    consts = [int(v) * (-1 if s else 1) for s, v in re.findall(r"\((-?)\d+'sd(\d+)\)", acc)]
    assert consts == list(map(int, h_int))
    W = acc_width_fir(h_int, cf, SF)
    M = int(np.abs(h_int).sum()) * 2 ** 15 + 2 ** (cf.frac_bits - 1)
    assert W == M.bit_length() + 1 and f"logic signed [{W - 1}:0] acc" in sv and f"ACC_W = {W}" in sv
    sos_int, cf2 = sos_case()
    sv2 = gen_sos_sv(sos_int, cf2, SF, overflow="wrap", error_feedback=True, module_name="sos_s")
    for i, row in enumerate(sos_int):
        a = re.search(rf"assign s{i}_acc =(.*?);", sv2, re.S).group(1)
        lits = [int(v) * (-1 if s else 1) for s, v in re.findall(r"\((-?)\d+'sd(\d+)\)", a)]
        sh = cf2.frac_bits; c = [(int(row[3]) + (1 << (sh - 1))) >> sh, (int(row[4]) + (1 << (sh - 1))) >> sh]
        assert lits == list(map(int, row)) + c
        assert f"logic signed [{acc_width_sos(row, cf2, SF, True) - 1}:0] s{i}_acc" in sv2

def test_testbench_and_vectors():
    x = np.array([0, 1, -1, 32767, -32768]); y = np.array([5, -5, 0, -32768, 32767])
    txt = vectors_hex(x, y, SF)
    assert txt.splitlines() == ["00000005", "0001fffb", "ffff0000", "7fff8000", "80007fff"]
    tb = gen_testbench_sv("fir_t", SF, 5, "fir_t.hex")
    assert '$readmemh("fir_t.hex", vec)' in tb and "fir_t dut (" in tb and "[31:0] vec [0:4]" in tb

def test_rejects_bad_arguments():
    h_int, cf = fir_case()
    with pytest.raises(ValueError): gen_fir_sv(h_int, cf, SF, overflow="clip", module_name="m")
    with pytest.raises(ValueError): gen_fir_sv(h_int, cf, SF, form="systolic", module_name="m")
    with pytest.raises(ValueError): gen_fir_sv(h_int, cf, SF, module_name="2bad name")

def test_js_generated_module_and_vectors_agree_under_the_evaluator():
    """The browser's export path: web/rtl.js text + vectors from the JS bit-true simulator, run through rtl_eval."""
    import json, shutil, subprocess
    node = shutil.which("node")
    if not node: pytest.skip("node not installed")
    js = r"""
const D = require('./web/dsp.js'), R = require('./web/rtl.js'), out = [];
const sf = D.qFormat(0, 15), x = []; for (let i = 0; i < 64; i++) x.push(i ? 0 : 32767); for (let i = 0; i < 64; i++) x.push(32767);
for (let i = 0; i < 128; i++) x.push(Math.floor(i / 16) % 2 ? -32768 : 32767); for (const v of D.toneSignal(256, 1, [], 0.5, 11)) x.push(Math.max(-32768, Math.min(32767, Math.round(v * 32767))));
const d = D.designIIR('cheby1', 'lowpass', 4, [0.1], 1, 1, 40), qs = D.quantizeSos(d.sos, 14);
const rows = qs.sq.map(s => [0, 1, 2, 4, 5].map(i => D.toInt(s[i], qs.fmt, 'nearest'))), sosF = rows.map(r => [r[0] * qs.fmt.lsb, r[1] * qs.fmt.lsb, r[2] * qs.fmt.lsb, 1, r[3] * qs.fmt.lsb, r[4] * qs.fmt.lsb]);
for (const [ov, hb, ef] of [['saturate', 0, false], ['wrap', 1, true]]) {
  const y = Array.from(D.sosFixedSim(sosF, x.map(v => v * sf.lsb), qs.fmt, sf, 'nearest', { overflow: ov, headroomBits: hb, errorFeedback: ef }).y, v => Math.round(v / sf.lsb));
  out.push({ text: R.genSosSv(rows, qs.fmt, sf, { overflow: ov, headroomBits: hb, errorFeedback: ef, moduleName: 'm' }), x, y });
}
const h = D.remez(31, [0, .2, .3, .5], [1, 0], null, 1).h, qf = D.quantizeFir(h, 12), hi = Array.from(h, v => D.toInt(v, qf.fmt));
out.push({ text: R.genFirSv(hi, qf.fmt, sf, { form: 'transposed', overflow: 'wrap', moduleName: 'f' }), x, y: Array.from(D.firFixedSim(hi.map(v => v * qf.fmt.lsb), x.map(v => v * sf.lsb), qf.fmt, sf, 'nearest', { overflow: 'wrap' }).y, v => Math.round(v / sf.lsb)) });
process.stdout.write(JSON.stringify(out));"""
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    cases = json.loads(subprocess.run([node, "-e", js], cwd=root, capture_output=True, text=True, check=True).stdout)
    assert len(cases) == 3
    for c in cases:
        assert rtl_eval.run(c["text"], c["x"]) == c["y"]

# ---- stretch: coefficient hardware cost (counts only; no area or timing claims) ----
from dsp.rtl import csd, rtl_cost_fir, rtl_cost_sos

def test_csd_is_minimal_signed_digit_form():
    assert csd(0) == [] and csd(1) == [(1, 0)] and csd(7) == [(-1, 0), (1, 3)] and csd(-3) == [(1, 0), (-1, 2)]
    rng = np.random.default_rng(0)
    for v in list(rng.integers(-2 ** 23, 2 ** 23, 400)) + [2 ** 23 - 1, -2 ** 23, 5, -5, 255, 256]:
        d = csd(int(v))
        assert sum(s << k for s, k in d) == v                                     # exact
        ks = [k for _, k in d]; assert all(b - a >= 2 for a, b in zip(ks, ks[1:]))   # no two adjacent non-zero digits
        assert len(d) <= len(bin(abs(int(v)))) // 2 + 1                          # at most about half the bits

def test_fir_cost_counts():
    h_int = [3, 0, -8, 7]                    # csd digits 2, 0, 1, 2
    c = rtl_cost_fir(h_int, QFormat(3, 0), QFormat(0, 7), form="direct")
    assert [r["digits"] for r in c["coefficients"]] == [2, 0, 1, 2]
    assert c["multipliers"] == 3 and c["csd_adders"] == 2 and c["accumulation_adders"] == 2
    assert c["acc_bits"] == acc_width_fir(h_int, QFormat(3, 0), QFormat(0, 7)) and c["register_bits"] == 3 * 8 + 8
    assert rtl_cost_fir(h_int, QFormat(3, 0), QFormat(0, 7), form="transposed")["register_bits"] == 3 * c["acc_bits"] + 8

def test_sos_cost_counts():
    rows = [[4096, 8192, 4096, -7000, 3000]]; cf = QFormat(1, 12); sf = QFormat(0, 15)
    c = rtl_cost_sos(rows, cf, sf)
    assert c["multipliers"] == 5 and c["accumulation_adders"] == 4 + 1             # 5 products, rounding adder
    assert c["csd_adders"] == sum(len(csd(v)) - 1 for v in rows[0] if v)
    ce = rtl_cost_sos(rows, cf, sf, error_feedback=True)
    assert ce["accumulation_adders"] > c["accumulation_adders"] and ce["acc_bits"] == [acc_width_sos(rows[0], cf, sf, True)]
