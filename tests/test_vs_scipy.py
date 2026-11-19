import sys, os; sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
import numpy as np, scipy.signal as ss, pytest
from dsp import *

@pytest.mark.parametrize("name,sw", [("hamming","hamming"),("hann","hann"),("blackman","blackman"),("rect","boxcar")])
def test_window_lowpass(name, sw):
    h = fir_window(51, 0.2, "lowpass", name, fs=1.0)
    assert np.allclose(h, ss.firwin(51, 0.2, window=sw, fs=1.0, scale=False), atol=1e-12)

def test_kaiser_bandpass_highpass():
    assert np.allclose(fir_window(61, [0.1, 0.25], "bandpass", "kaiser", fs=1.0, beta=6.0),
                       ss.firwin(61, [0.1, 0.25], window=("kaiser", 6.0), pass_zero=False, fs=1.0, scale=False), atol=1e-12)
    assert np.allclose(fir_window(61, 0.3, "highpass", "hamming", fs=1.0),
                       ss.firwin(61, 0.3, window="hamming", pass_zero=False, fs=1.0, scale=False), atol=1e-12)

def test_kaiser_params_meets_spec():
    N, beta = kaiser_params(60, 0.05, fs=1.0)
    h = fir_window(N, 0.2, "lowpass", "kaiser", fs=1.0, beta=beta)
    f, H = freqz(h, 1, 8192, 1.0)
    assert measure_lowpass(f, H, 0.175, 0.225)["stopband_atten_db"] > 58

@pytest.mark.parametrize("N,b,d,w", [(41,[0,.2,.3,.5],[1,0],None), (65,[0,.15,.25,.5],[1,0],[1,10]),
                                     (51,[0,.1,.15,.3,.35,.5],[0,1,0],[10,1,10])])
def test_remez_matches_scipy(N, b, d, w):
    assert np.abs(remez(N, b, d, w, fs=1.0) - ss.remez(N, b, d, weight=w, fs=1.0)).max() < 5e-5

def test_remez_equiripple():
    h, info = remez(41, [0,.2,.3,.5], [1,0], fs=1.0, return_info=True)
    f, H = freqz(h, 1, 8192, 1.0); sb = np.abs(H[f >= .3])
    assert abs(sb.max() - info["delta"]) / info["delta"] < 0.02

@pytest.mark.parametrize("kind", ["butter","cheby1","cheby2"])
@pytest.mark.parametrize("bt,edges", [("lowpass",0.2),("highpass",0.3),("bandpass",[0.15,0.3]),("bandstop",[0.15,0.3])])
def test_iir_matches_scipy(kind, bt, edges):
    n = 4
    d = design_iir(kind, bt, n, edges, fs=1.0, rp=1.0, rs=40.0)
    fn = {"butter": lambda: ss.butter(n, edges, bt, fs=1.0, output="zpk"),
          "cheby1": lambda: ss.cheby1(n, 1.0, edges, bt, fs=1.0, output="zpk"),
          "cheby2": lambda: ss.cheby2(n, 40.0, edges, bt, fs=1.0, output="zpk")}[kind]
    z, p, k = fn()
    assert np.isclose(d["k"], k, rtol=1e-6)
    key = lambda v: np.round(np.sort_complex(v), 5)
    assert np.allclose(np.sort_complex(np.round(d["p"], 8)), np.sort_complex(np.round(p, 8)), atol=1e-6)
    f, H = freqz(d["b"], d["a"], 1024, 1.0); _, Hs = sos_freqz(d["sos"], 1024, 1.0)
    w, Href = ss.freqz(*ss.zpk2tf(z, p, k), worN=np.linspace(0, np.pi, 1024))
    assert np.allclose(H, Href, atol=1e-8) and np.allclose(Hs, Href, atol=1e-8)

@pytest.mark.parametrize("kind", ["butter","cheby1","cheby2"])
def test_min_order(kind):
    fn = {"butter": ss.buttord, "cheby1": ss.cheb1ord, "cheby2": ss.cheb2ord}[kind]
    for bt, wp, wst in [("lowpass",0.1,0.15),("highpass",0.3,0.2)]:
        assert min_order(kind, bt, wp, wst, 1, 40, fs=1.0) == fn(wp, wst, 1, 40, fs=1.0)[0]

def test_quantize_error_bounded():
    h = remez(41, [0,.2,.3,.5], [1,0], fs=1.0)
    for w in (8, 12, 16):
        q = quantize_fir(h, w, 1.0)
        assert q["max_coeff_err"] <= q["fmt"].lsb / 2 + 1e-15

def test_fir_fixed_noise_matches_theory():
    rng = np.random.default_rng(0)
    h = remez(41, [0,.2,.3,.5], [1,0], fs=1.0); cf = QFormat(0, 15); sf = QFormat(0, 13)
    x = np.clip(rng.normal(0, .25, 60000), -.99, .99)
    y, y_qc, _ = simulate_fir_fixed(h, x, cf, sf)
    meas = np.var(y - y_qc); th = fir_noise_theory(h, sf, input_quantized=False)
    assert abs(10*np.log10(meas/th)) < 1.0

def test_sos_fixed_noise_matches_theory():
    rng = np.random.default_rng(1)
    d = design_iir("butter", "lowpass", 6, 0.1, fs=1.0); cf = QFormat(2, 24); sf = QFormat(0, 15)
    x = np.clip(rng.normal(0, .2, 20000), -.99, .99)
    y = simulate_sos_fixed(d["sos"], x, cf, sf)
    from scipy.signal import sosfilt
    sq = d["sos"].copy()
    for c in (0,1,2,4,5): sq[:, c] = quantize(sq[:, c], cf)
    yref = sosfilt(sq, quantize(x, sf))
    meas = np.var(y[200:] - yref[200:]); th = sos_noise_theory(d["sos"], sf, input_quantized=False)
    assert abs(10*np.log10(meas/th)) < 2.0

def test_direct_form_unstable_sos_stable():
    d = design_iir("butter", "lowpass", 10, 0.02, fs=1.0)
    df = quantize_direct_form(d["b"], d["a"], 12)
    fmt, sq, gain = quantize_sos(d["sos"], 12)
    assert not df["stable"]
    assert np.max(np.abs(np.concatenate([np.roots(s[3:]) for s in sq]))) < 1


def test_scale_sos_preserves_response_and_unit_peaks():
    d = design_iir("butter", "lowpass", 8, 0.03, fs=1.0)          # narrow band: tiny numerators before scaling
    sc, gain = scale_sos(d["sos"])
    f, H = sos_freqz(d["sos"], 2048, 1.0); _, Hs = sos_freqz(sc, 2048, 1.0)
    assert np.allclose(gain * Hs, H, rtol=1e-9, atol=1e-12)
    for s in sc:
        _, Hk = sos_freqz(s[None, :], 2048, 1.0); assert abs(np.abs(Hk).max() - 1) < 1e-3
    # without scaling, 12-bit coefficients would round the numerators to zero; with scaling the filter survives
    fmt, sq, g = quantize_sos(d["sos"], 12)
    _, Hq = sos_freqz(sq, 2048, 1.0)
    assert 20 * np.log10(np.abs(g * Hq)[0]) > -3

def test_butter_edge_rp_puts_exact_attenuation_at_edge():
    for rp in (0.5, 1.0, 2.0):
        d = design_iir("butter", "lowpass", 5, 0.2, fs=1.0, butter_edge_rp=rp)
        w = np.array([2 * np.pi * 0.2]); Hs = np.polyval(d["b"][::-1], np.exp(-1j * w)) / np.polyval(d["a"][::-1], np.exp(-1j * w))
        assert abs(-20 * np.log10(abs(Hs[0])) - rp) < 1e-9
