"""Frequency-domain analysis: Bode data, group delay, pole-zero, spec measurement."""
import numpy as np
from math import pi

def _poly_eval(c, w):
    return np.polyval(np.atleast_1d(np.asarray(c, complex))[::-1], np.exp(-1j * w))

def freqz(b, a=1.0, n=2048, fs=2.0):
    """Returns f (Hz), H (complex). Evaluates on [0, fs/2]."""
    w = np.linspace(0, pi, n)
    return w / pi * fs / 2, _poly_eval(b, w) / _poly_eval(a, w)

def sos_freqz(sos, n=2048, fs=2.0):
    w = np.linspace(0, pi, n); H = np.ones(n, complex)
    for s in sos: H *= _poly_eval(s[:3], w) / _poly_eval(s[3:], w)
    return w / pi * fs / 2, H

def group_delay(b, a=1.0, n=2048, fs=2.0):
    """Group delay in samples. Uses tau = Re[ sum(k c_k e^-jwk) / sum(c_k e^-jwk) ] per polynomial."""
    w = np.linspace(0, pi, n)
    def tau(c):
        c = np.atleast_1d(np.asarray(c, float)); k = np.arange(len(c))
        num = np.exp(-1j * np.outer(w, k)) @ (k * c); den = np.exp(-1j * np.outer(w, k)) @ c
        with np.errstate(all="ignore"): return np.real(num / den)
    return w / pi * fs / 2, tau(b) - tau(np.atleast_1d(a))

def roots_of(c):
    """Zeros of a polynomial in z^-1 (leading coefficient c[0]) as points in the z-plane."""
    c = np.trim_zeros(np.atleast_1d(np.asarray(c, float)), "b")
    return np.roots(c) if len(c) > 1 else np.array([])

def measure_lowpass(f, H, fp, fst):
    """Passband ripple (dB, peak-to-peak) and worst stopband attenuation (dB)."""
    mag = 20 * np.log10(np.maximum(np.abs(H), 1e-12))
    pb, sb = mag[f <= fp], mag[f >= fst]
    return {"passband_ripple_db": float(pb.max() - pb.min()), "stopband_atten_db": float(-sb.max())}
