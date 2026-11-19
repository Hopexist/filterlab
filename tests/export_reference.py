"""Dump Python reference results to JSON so the JS port can be cross-checked (tests/cross_check.js)."""
import json, sys, os; sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
import numpy as np
from dsp import *
from dsp.quant import to_int
out = {}
L = lambda a: np.asarray(a).tolist()
out["remez"] = [{"N": N, "bands": b, "des": d, "w": w, "h": L(remez(N, b, d, w, fs=1.0))}
                for N, b, d, w in [(41,[0,.2,.3,.5],[1,0],None),(65,[0,.15,.25,.5],[1,0],[1,10]),(51,[0,.1,.15,.3,.35,.5],[0,1,0],[10,1,10])]]
out["window"] = [{"N": 51, "edges": [0.2], "kind": "lowpass", "win": "blackman", "h": L(fir_window(51, 0.2, "lowpass", "blackman", fs=1.0))},
                 {"N": 61, "edges": [0.1, 0.25], "kind": "bandpass", "win": "kaiser", "beta": 6.0, "h": L(fir_window(61, [0.1, 0.25], "bandpass", "kaiser", fs=1.0, beta=6.0))},
                 {"N": 60, "edges": [0.3], "kind": "highpass", "win": "hann", "h": L(fir_window(60, 0.3, "highpass", "hann", fs=1.0))}]
out["iir"] = []
for kind in ("butter", "cheby1", "cheby2", "ellip"):
    for bt, e in (("lowpass", [0.2]), ("highpass", [0.3]), ("bandpass", [0.15, 0.3]), ("bandstop", [0.15, 0.3])):
        d = design_iir(kind, bt, 5, e if len(e) > 1 else e[0], fs=1.0, rp=1.0, rs=40.0)
        C = lambda r: [[float(np.real(v)), float(np.imag(v))] for v in np.atleast_1d(r)]
        out["iir"].append({"kind": kind, "btype": bt, "edges": e, "order": 5, "sos": L(d["sos"]), "b": L(d["b"]), "a": L(d["a"]),
                           "z": C(d["z"]), "p": C(d["p"]), "k": float(d["k"])})
h = out["remez"][0]["h"]
rng = np.random.default_rng(3); x = np.clip(rng.normal(0, .25, 300), -.99, .99)
cf, sf = QFormat(0, 15), QFormat(0, 13)
y, yq, yi = simulate_fir_fixed(np.array(h), x, cf, sf)
fq = quantize_fir(np.array(h), 10, 1.0)
d = design_iir("butter", "lowpass", 6, 0.1, fs=1.0); cf2 = QFormat(2, 22); sf2 = QFormat(0, 15)
ys = simulate_sos_fixed(d["sos"], x, cf2, sf2)
d2 = design_iir("butter", "lowpass", 8, 0.03, fs=1.0)
fmt, sq, g12 = quantize_sos(d2["sos"], 12); dq = quantize_direct_form(d2["b"], d2["a"], 14); sc, gsc = scale_sos(d2["sos"])
out["quant"] = {"x": L(x), "fir_h": h, "fir_y": L(y), "hq10": L(fq["hq"]), "fmt10": [fq["fmt"].int_bits, fq["fmt"].frac_bits],
                "sos": L(d["sos"]), "sos_y": L(ys), "sos2": L(d2["sos"]), "sos_q12": L(sq), "gain12": float(g12), "scaled": L(sc), "gain_scaled": float(gsc), "dq_bq": L(dq["bq"]), "dq_aq": L(dq["aq"]), "dq_gain": float(dq["gain"]), "dq_stable": bool(dq["stable"]), "sos_fmt12": [fmt.int_bits, fmt.frac_bits],
                "theory_sos": sos_noise_theory(d["sos"], sf2, input_quantized=False), "theory_fir": fir_noise_theory(np.array(h), sf, input_quantized=False)}
# ---- task B: remez types II-IV, elliptic order, overflow / headroom / error feedback, noise-theory paths ----
out["remez_b"] = [{"N": N, "bands": b, "des": d, "w": w, "kind": k, "h": L(remez(N, b, d, w, fs=1.0, kind=k))}
                  for N, b, d, w, k in [(40, [0, .2, .3, .5], [1, 0], None, "bandpass"), (50, [0, .1, .15, .3, .35, .5], [0, 1, 0], [10, 1, 10], "bandpass"),
                                        (31, [.05, .45], [1], None, "hilbert"), (30, [.05, .45], [1], None, "hilbert"),
                                        (31, [0, .4], [1], None, "differentiator"), (30, [0, .4], [1], None, "differentiator")]]
out["min_order"] = [{"kind": k, "bt": bt, "wp": wp, "ws": ws, "gp": gp, "gs": gs, "n": min_order(k, bt, wp, ws, gp, gs, fs=1.0)}
                    for k in ("butter", "cheby1", "cheby2", "ellip")
                    for bt, wp, ws in (("lowpass", [0.1], [0.15]), ("highpass", [0.3], [0.2]), ("bandpass", [0.15, 0.3], [0.1, 0.35]), ("bandstop", [0.1, 0.35], [0.15, 0.3]))
                    for gp, gs in ((1, 40), (0.1, 80))]
de = design_iir("butter", "lowpass", 4, 0.02, fs=1.0); fe, sqe, _ = quantize_sos(de["sos"], 24)
xe = x * 0.8
dw = design_iir("cheby1", "lowpass", 4, 0.1, fs=1.0); fw = auto_format(np.abs(dw["sos"]).max(), 20)
xw = 0.98 * np.sign(np.sin(2 * np.pi * 0.01 * np.arange(300)))
hw = np.full(8, 0.24); xf = np.full(40, 0.9)
out["quant_b"] = {"xe": L(xe), "sqe": L(sqe), "fe": [fe.int_bits, fe.frac_bits],
                  "y_ef": L(simulate_sos_fixed(sqe, xe, fe, sf2, error_feedback=True)),
                  "sosw": L(dw["sos"]), "fw": [fw.int_bits, fw.frac_bits], "xw": L(xw),
                  "y_wrap": L(simulate_sos_fixed(dw["sos"], xw, fw, sf2, overflow="wrap")),
                  "y_head": L(simulate_sos_fixed(dw["sos"], xw, fw, sf2, headroom_bits=2)),
                  "y_head_ef_wrap": L(simulate_sos_fixed(sqe, xe, fe, sf2, overflow="wrap", headroom_bits=1, error_feedback=True)),
                  "fir_wrap": L(simulate_fir_fixed(hw, xf, QFormat(0, 15), QFormat(0, 15), overflow="wrap")[0]),
                  "toint_wrap": L(to_int([1.5, -1.25, 0.99, 3.2], QFormat(0, 7), overflow="wrap")),
                  "th_sos_inq": sos_noise_theory(d["sos"], sf2, input_quantized=True),
                  "th_sos_ef": sos_noise_theory(sqe, sf2, input_quantized=False, error_feedback=True),
                  "th_fir_inq": fir_noise_theory(np.array(h), sf, input_quantized=True)}
xc = tone_signal(5000, 8000.0, ((440, 0.5), (1800, 0.25)), noise_rms=0.01, seed=11)
fc, dbc = power_spectrum_db(xc, 8000.0, 1024)
out["spectrum"] = {"x": L(xc), "f": L(fc), "db": L(dbc), "x_short": L(tone_signal(301, 1000.0, ((50, 1.0),), noise_rms=0.1, seed=3))}
# ---- RTL export: generated text must be byte-identical in web/rtl.js ----
from dsp.rtl import gen_fir_sv, gen_sos_sv, gen_testbench_sv, vectors_hex
Fq = lambda f: [f.int_bits, f.frac_bits]
hf = quantize_fir(np.array(h), 12, 1.0); hf_int = to_int(hf["hq"], hf["fmt"])
d4 = design_iir("cheby1", "lowpass", 4, 0.1, fs=1.0, rp=1.0); f4, sq4, _ = quantize_sos(d4["sos"], 16); s4 = [list(map(int, to_int(r[[0, 1, 2, 4, 5]], f4))) for r in sq4]
de6 = design_iir("ellip", "bandpass", 3, [0.1, 0.2], fs=1.0, rp=0.5, rs=50); f6, sq6, _ = quantize_sos(de6["sos"], 20); s6 = [list(map(int, to_int(r[[0, 1, 2, 4, 5]], f6))) for r in sq6]
rtl = []
for form, ov, sf_ in (("direct", "saturate", QFormat(0, 15)), ("transposed", "wrap", QFormat(0, 15)), ("direct", "wrap", QFormat(0, 19))):
    rtl.append({"kind": "fir", "h": list(map(int, hf_int)), "coef": Fq(hf["fmt"]), "sig": Fq(sf_), "overflow": ov, "form": form, "name": f"fir_{form}_{ov}",
                "text": gen_fir_sv(hf_int, hf["fmt"], sf_, overflow=ov, form=form, module_name=f"fir_{form}_{ov}")})
rtl.append({"kind": "fir", "h": [1, -2, 3], "coef": [3, 0], "sig": [0, 7], "overflow": "saturate", "form": "transposed", "name": "fir_sh0",
            "text": gen_fir_sv([1, -2, 3], QFormat(3, 0), QFormat(0, 7), overflow="saturate", form="transposed", module_name="fir_sh0")})
for rows, fmt, ov, hb, ef, sf_, nm in ((s4, f4, "saturate", 0, False, QFormat(0, 15), "sos_plain"), (s4, f4, "wrap", 2, True, QFormat(0, 15), "sos_ef_h2"),
                                       (s6, f6, "saturate", 1, True, QFormat(0, 17), "ellip_bp"), (s6, f6, "wrap", 0, False, QFormat(0, 11), "ellip_bp_12")):
    rtl.append({"kind": "sos", "sos": rows, "coef": Fq(fmt), "sig": Fq(sf_), "overflow": ov, "headroom": hb, "ef": ef, "name": nm,
                "text": gen_sos_sv(np.array(rows), fmt, sf_, overflow=ov, headroom_bits=hb, error_feedback=ef, module_name=nm)})
out["rtl"] = {"designs": rtl, "tb": gen_testbench_sv("fir_t", QFormat(0, 15), 448, "fir_t.hex"),
              "vx": [0, 1, -1, 32767, -32768, 1234], "vy": [5, -5, 0, -32768, 32767, -4321], "hex": vectors_hex([0, 1, -1, 32767, -32768, 1234], [5, -5, 0, -32768, 32767, -4321], QFormat(0, 15))}
json.dump(out, open(os.path.join(os.path.dirname(__file__), "reference.json"), "w"))
print("wrote reference.json")
