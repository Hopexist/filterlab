"""Design a filter with each method, plot Bode + pole-zero, and show the quantization sweep.
Run from the filterlab folder:  python3 examples/demo.py   (writes examples/gallery.png)"""
import sys, os; sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import numpy as np, matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt
from dsp import *

fs, fp, fst, rp, rs = 8000.0, 1000.0, 1500.0, 1.0, 60.0
dp = (10 ** (rp / 20) - 1) / (10 ** (rp / 20) + 1); ds = 10 ** (-rs / 20)
h_pm = remez(37, [0, fp, fst, fs / 2], [1, 0], weight=[1 / dp, 1 / ds], fs=fs)
n_k, beta = kaiser_params(rs, fst - fp, fs)
h_kw = fir_window(n_k, (fp + fst) / 2, "lowpass", "kaiser", fs=fs, beta=beta)
iir = {k: design_iir(k, "lowpass", min_order(k, "lowpass", [fp], [fst], rp, rs, fs), fp if k != "cheby2" else fst, fs=fs, rp=rp, rs=rs,
                     butter_edge_rp=rp if k == "butter" else None) for k in ("butter", "cheby1", "cheby2")}

fig, ax = plt.subplots(2, 2, figsize=(12, 8)); (a_mag, a_ph), (a_pz, a_q) = ax
def plot(name, b, a=1.0):
    f, H = freqz(b, a, 4096, fs); a_mag.plot(f, 20 * np.log10(np.abs(H) + 1e-12), label=name)
    a_ph.plot(*group_delay(b, a, 2048, fs), label=name)
plot(f"Parks-McClellan ({len(h_pm)} taps)", h_pm); plot(f"Kaiser window ({len(h_kw)} taps)", h_kw)
for k, d in iir.items(): plot(f"{k} (order {len(d['a']) - 1})", d["b"], d["a"])
a_mag.axhline(-rs, color="r", ls=":"); a_mag.set(ylim=(-100, 5), xlabel="Hz", ylabel="dB", title="Magnitude"); a_mag.legend(fontsize=8)
a_ph.set(xlabel="Hz", ylabel="samples", title="Group delay", ylim=(0, 40)); 
t = np.linspace(0, 2 * np.pi, 400); a_pz.plot(np.cos(t), np.sin(t), "k", lw=.8)
d = iir["cheby1"]; a_pz.plot(d["z"].real, d["z"].imag, "o", mfc="none", label="zeros"); a_pz.plot(d["p"].real, d["p"].imag, "x", label="poles")
a_pz.set(aspect="equal", title="Chebyshev I poles and zeros"); a_pz.legend(fontsize=8)
for w, s in ((6, "-"), (8, "--"), (12, "-"), (16, "-")):
    fmt, sq, g = quantize_sos(iir["cheby1"]["sos"], w); f, H = sos_freqz(sq, 4096, fs)
    a_q.plot(f, 20 * np.log10(np.abs(g * H) + 1e-12), ls=s, label=f"{w}-bit coefficients")
a_q.set(ylim=(-100, 5), title="Chebyshev I biquads, coefficient rounding", xlabel="Hz"); a_q.legend(fontsize=8)
fig.tight_layout(); out = os.path.join(os.path.dirname(__file__), "gallery.png"); fig.savefig(out, dpi=110); print("wrote", out)
