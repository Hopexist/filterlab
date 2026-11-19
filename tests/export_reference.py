"""Dump Python reference results to JSON so the JS port can be cross-checked (tests/cross_check.js)."""
import json, sys, os; sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
import numpy as np
from dsp import *
out = {}
L = lambda a: np.asarray(a).tolist()
out["remez"] = [{"N": N, "bands": b, "des": d, "w": w, "h": L(remez(N, b, d, w, fs=1.0))}
                for N, b, d, w in [(41,[0,.2,.3,.5],[1,0],None),(65,[0,.15,.25,.5],[1,0],[1,10]),(51,[0,.1,.15,.3,.35,.5],[0,1,0],[10,1,10])]]
out["window"] = [{"N": 51, "edges": [0.2], "kind": "lowpass", "win": "blackman", "h": L(fir_window(51, 0.2, "lowpass", "blackman", fs=1.0))},
                 {"N": 61, "edges": [0.1, 0.25], "kind": "bandpass", "win": "kaiser", "beta": 6.0, "h": L(fir_window(61, [0.1, 0.25], "bandpass", "kaiser", fs=1.0, beta=6.0))},
                 {"N": 60, "edges": [0.3], "kind": "highpass", "win": "hann", "h": L(fir_window(60, 0.3, "highpass", "hann", fs=1.0))}]
out["iir"] = []
for kind in ("butter", "cheby1", "cheby2"):
    for bt, e in (("lowpass", [0.2]), ("highpass", [0.3]), ("bandpass", [0.15, 0.3]), ("bandstop", [0.15, 0.3])):
        d = design_iir(kind, bt, 5, e if len(e) > 1 else e[0], fs=1.0, rp=1.0, rs=40.0)
        out["iir"].append({"kind": kind, "btype": bt, "edges": e, "order": 5, "sos": L(d["sos"]), "b": L(d["b"]), "a": L(d["a"])})
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
json.dump(out, open(os.path.join(os.path.dirname(__file__), "reference.json"), "w"))
print("wrote reference.json")
