"""Task B: even-length / Hilbert / differentiator Remez, elliptic IIR, overflow + headroom, error feedback."""
import sys, os; sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
import numpy as np, scipy.signal as ss, pytest
from dsp import *

# ---- Parks-McClellan types II, III, IV ----
@pytest.mark.parametrize("N,b,d,w", [(40, [0, .2, .3, .5], [1, 0], None), (64, [0, .15, .25, .5], [1, 0], [1, 10]),
                                     (50, [0, .1, .15, .3, .35, .5], [0, 1, 0], [10, 1, 10])])
def test_remez_type2_matches_scipy(N, b, d, w):
    h = remez(N, b, d, w, fs=1.0)
    assert len(h) == N and np.allclose(h, h[::-1], atol=1e-12)
    assert np.abs(h - ss.remez(N, b, d, weight=w, fs=1.0)).max() < 5e-5

def test_remez_type2_rejects_gain_at_nyquist():
    with pytest.raises(ValueError, match="fs/2"):
        remez(40, [0, .2, .3, .5], [0, 1], fs=1.0)

@pytest.mark.parametrize("N", [31, 30])
def test_remez_hilbert_matches_scipy(N):
    h = remez(N, [0.05, 0.45], [1], fs=1.0, kind="hilbert")
    assert np.allclose(h, -h[::-1], atol=1e-12)
    assert np.abs(h - ss.remez(N, [0.05, 0.45], [1], fs=1.0, type="hilbert")).max() < 5e-5

@pytest.mark.parametrize("N", [31, 30])
def test_remez_differentiator_matches_scipy(N):
    h = remez(N, [0, 0.4], [1], fs=1.0, kind="differentiator")
    assert np.allclose(h, -h[::-1], atol=1e-12)
    assert np.abs(h - ss.remez(N, [0, 0.4], [1], fs=1.0, type="differentiator")).max() < 5e-5

def test_remez_type1_unchanged_by_kind_keyword():
    a = remez(41, [0, .2, .3, .5], [1, 0], fs=1.0); b = remez(41, [0, .2, .3, .5], [1, 0], fs=1.0, kind="bandpass")
    assert np.array_equal(a, b)

# ---- elliptic IIR ----
@pytest.mark.parametrize("n", [1, 4, 5])
@pytest.mark.parametrize("bt,edges", [("lowpass", 0.2), ("highpass", 0.3), ("bandpass", [0.15, 0.3]), ("bandstop", [0.15, 0.3])])
def test_ellip_matches_scipy(n, bt, edges):
    d = design_iir("ellip", bt, n, edges, fs=1.0, rp=1.0, rs=40.0)
    z, p, k = ss.ellip(n, 1.0, 40.0, edges, bt, fs=1.0, output="zpk")
    assert np.isclose(d["k"], k, rtol=1e-6)
    srt = lambda v: np.sort_complex(np.round(v, 8))
    assert np.allclose(srt(d["p"]), srt(p), atol=1e-6) and np.allclose(srt(d["z"]), srt(z), atol=1e-6)
    f, H = sos_freqz(d["sos"], 1024, 1.0)
    _, Href = ss.freqz(*ss.zpk2tf(z, p, k), worN=np.linspace(0, np.pi, 1024))
    assert np.allclose(H, Href, atol=1e-8)

@pytest.mark.parametrize("bt,wp,ws", [("lowpass", 0.1, 0.15), ("highpass", 0.3, 0.2), ("lowpass", 0.2, 0.21), ("bandpass", [0.15, 0.3], [0.1, 0.35])])
@pytest.mark.parametrize("gp,gs", [(1, 40), (0.1, 80)])
def test_ellip_min_order(bt, wp, ws, gp, gs):
    assert min_order("ellip", bt, wp, ws, gp, gs, fs=1.0) == ss.ellipord(wp, ws, gp, gs, fs=1.0)[0]

# ---- overflow modes, headroom, error feedback ----
from scipy.signal import sosfilt

def _ef_case():
    d = design_iir("butter", "lowpass", 4, 0.02, fs=1.0)
    fmt, sq, gain = quantize_sos(d["sos"], 24)
    sf = QFormat(0, 15)
    x = np.clip(np.random.default_rng(5).normal(0, .2, 40000), -.99, .99)
    yref = sosfilt(sq, quantize(x, sf))
    return sq, fmt, sf, x, yref

def test_error_feedback_reduces_lowpass_noise():
    sq, fmt, sf, x, yref = _ef_case()
    n0 = np.var(simulate_sos_fixed(sq, x, fmt, sf)[500:] - yref[500:])
    n1 = np.var(simulate_sos_fixed(sq, x, fmt, sf, error_feedback=True)[500:] - yref[500:])
    assert 10 * np.log10(n0 / n1) >= 6

def test_error_feedback_matches_theory():
    # pins the sign: N(z) = 1 + c1 z^-1 + c2 z^-2 with c = round(a); a flipped sign is several dB off
    sq, fmt, sf, x, yref = _ef_case()
    meas = np.var(simulate_sos_fixed(sq, x, fmt, sf, error_feedback=True)[500:] - yref[500:])
    th = sos_noise_theory(sq, sf, input_quantized=False, error_feedback=True)
    assert abs(10 * np.log10(meas / th)) < 1.5
    th0 = sos_noise_theory(sq, sf, input_quantized=False)
    assert th0 / th > 10    # theory itself says error feedback helps here

def test_defaults_unchanged():
    sq, fmt, sf, x, _ = _ef_case()
    assert np.array_equal(simulate_sos_fixed(sq, x[:2000], fmt, sf),
                          simulate_sos_fixed(sq, x[:2000], fmt, sf, overflow="saturate", headroom_bits=0, error_feedback=False))

def test_overflow_saturate_vs_wrap_fir():
    h = np.full(8, 0.24); x = np.full(64, 0.9)          # steady state 1.728: overflows Q0.15
    cf, sf = QFormat(0, 15), QFormat(0, 15)
    ys = simulate_fir_fixed(h, x, cf, sf)[0]; yw = simulate_fir_fixed(h, x, cf, sf, overflow="wrap")[0]
    assert np.isclose(ys[-1], sf.hi)
    assert np.isclose(yw[-1], 8 * quantize(0.24, cf) * quantize(0.9, sf) - 2, atol=sf.lsb)   # wraps by -2
    assert yw[0] == ys[0]                                 # no overflow yet: identical

def test_overflow_wrap_and_headroom_sos():
    d = design_iir("cheby1", "lowpass", 4, 0.1, fs=1.0, rp=1.0)
    sq = d["sos"]; fmt = auto_format(np.abs(sq).max(), 20)  # unscaled cascade: square-wave overshoot reaches 1.27
    sf = QFormat(0, 15); n = np.arange(4000)
    x = 0.98 * np.sign(np.sin(2 * np.pi * 0.01 * n))     # full-scale square wave: Gibbs overshoot overflows
    ideal = sosfilt(sq, x)   # (quantization of sq at 20 bits is far below the tolerances used)
    ys = simulate_sos_fixed(sq, x, fmt, sf); yw = simulate_sos_fixed(sq, x, fmt, sf, overflow="wrap")
    assert np.max(np.abs(ideal)) > 1                     # the case really overflows
    assert np.max(np.abs(yw - ideal)) > 1                # wrap: large errors (sign flips)
    assert np.max(np.abs(ys - ideal)) < np.max(np.abs(yw - ideal))
    # one bit of headroom: no overflow, output (times 2^h) tracks the ideal to within the noise
    yh = simulate_sos_fixed(sq, x, fmt, sf, headroom_bits=1) * 2
    assert np.max(np.abs(yh - ideal)) < 1e-2
    with pytest.raises(ValueError):
        simulate_sos_fixed(sq, x, fmt, sf, overflow="clip")
