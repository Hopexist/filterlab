"""Window-method FIR design."""
import numpy as np
from math import pi, ceil

def window(name, N, beta=8.6):
    """Symmetric window of length N (matches scipy.signal.windows with sym=True)."""
    n = np.arange(N); m = N - 1
    if N == 1: return np.ones(1)
    name = name.lower()
    if name in ("rect", "rectangular", "boxcar"): return np.ones(N)
    if name == "hann":     return 0.5 - 0.5 * np.cos(2 * pi * n / m)
    if name == "hamming":  return 0.54 - 0.46 * np.cos(2 * pi * n / m)
    if name == "blackman": return 0.42 - 0.5 * np.cos(2 * pi * n / m) + 0.08 * np.cos(4 * pi * n / m)
    if name == "kaiser":
        r = 2 * n / m - 1
        return np.i0(beta * np.sqrt(np.clip(1 - r * r, 0, None))) / np.i0(beta)
    raise ValueError(f"unknown window {name!r}")

def kaiser_params(atten_db, transition_hz, fs=2.0):
    """Kaiser's formulas: returns (odd numtaps, beta) for a given stopband attenuation
    and transition width."""
    A = atten_db
    beta = 0.1102 * (A - 8.7) if A > 50 else (0.5842 * (A - 21) ** 0.4 + 0.07886 * (A - 21) if A >= 21 else 0.0)
    dw = 2 * pi * transition_hz / fs
    N = int(ceil((A - 7.95) / (2.285 * dw) + 1))
    return N | 1, beta   # force odd

def _lp(wc, n_minus_m):
    return (wc / pi) * np.sinc(wc * n_minus_m / pi)

def fir_window(numtaps, edges, kind="lowpass", win="hamming", fs=2.0, beta=8.6):
    """Windowed-sinc FIR. kind: lowpass | highpass | bandpass | bandstop.
    edges: one cutoff (lp/hp) or two (bp/bs), in Hz. Highpass/bandstop need odd length."""
    if kind in ("highpass", "bandstop") and numtaps % 2 == 0:
        numtaps += 1
    M = (numtaps - 1) / 2
    k = np.arange(numtaps) - M
    w = [2 * pi * e / fs for e in np.atleast_1d(edges)]
    delta = np.zeros(numtaps)
    if numtaps % 2: delta[int(M)] = 1.0
    if kind == "lowpass":    h = _lp(w[0], k)
    elif kind == "highpass": h = delta - _lp(w[0], k)
    elif kind == "bandpass": h = _lp(w[1], k) - _lp(w[0], k)
    elif kind == "bandstop": h = delta - (_lp(w[1], k) - _lp(w[0], k))
    else: raise ValueError(kind)
    return h * window(win, numtaps, beta)
