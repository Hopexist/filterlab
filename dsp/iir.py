"""IIR design: analog prototypes (Butterworth, Chebyshev I/II) -> band transform -> bilinear."""
import numpy as np
from math import pi, ceil

def _buttap(N):
    m = np.arange(-N + 1, N, 2)
    return np.array([]), -np.exp(1j * pi * m / (2 * N)), 1.0

def _cheb1ap(N, rp):
    eps = np.sqrt(10 ** (rp / 10) - 1); mu = np.arcsinh(1 / eps) / N
    th = pi * np.arange(-N + 1, N, 2) / (2 * N)
    p = -np.sinh(mu + 1j * th)
    k = np.prod(-p).real
    if N % 2 == 0: k /= np.sqrt(1 + eps ** 2)
    return np.array([]), p, k

def _cheb2ap(N, rs):
    de = 1 / np.sqrt(10 ** (rs / 10) - 1); mu = np.arcsinh(1 / de) / N
    m = np.arange(-N + 1, N, 2)
    z = -np.conj(1j / np.sin(m[m != 0] * pi / (2 * N)))
    p = -np.exp(1j * pi * m / (2 * N))
    p = np.sinh(mu) * p.real + 1j * np.cosh(mu) * p.imag
    p = 1 / p
    return z, p, (np.prod(-p) / np.prod(-z)).real

def _deg(z, p): return len(p) - len(z)

def _lp2lp(zpk, wo):
    z, p, k = zpk
    return z * wo, p * wo, k * wo ** _deg(z, p)
def _lp2hp(z, p, k, wo):
    d = _deg(z, p)
    kn = k * (np.prod(-z) / np.prod(-p)).real
    return np.concatenate([wo / z, np.zeros(d)]), wo / p, kn
def _lp2bp(z, p, k, wo, bw):
    d = _deg(z, p); zl, pl = z * bw / 2, p * bw / 2
    zb = np.concatenate([zl + np.sqrt(zl ** 2 - wo ** 2 + 0j), zl - np.sqrt(zl ** 2 - wo ** 2 + 0j)])
    pb = np.concatenate([pl + np.sqrt(pl ** 2 - wo ** 2 + 0j), pl - np.sqrt(pl ** 2 - wo ** 2 + 0j)])
    return np.concatenate([zb, np.zeros(d)]), pb, k * bw ** d
def _lp2bs(z, p, k, wo, bw):
    d = _deg(z, p); kn = k * (np.prod(-z) / np.prod(-p)).real
    zh, ph = (bw / 2) / z, (bw / 2) / p
    zb = np.concatenate([zh + np.sqrt(zh ** 2 - wo ** 2 + 0j), zh - np.sqrt(zh ** 2 - wo ** 2 + 0j)])
    pb = np.concatenate([ph + np.sqrt(ph ** 2 - wo ** 2 + 0j), ph - np.sqrt(ph ** 2 - wo ** 2 + 0j)])
    zb = np.concatenate([zb, 1j * wo * np.ones(d), -1j * wo * np.ones(d)])
    return zb, pb, kn

def _bilinear(z, p, k, fs):
    f2 = 2 * fs; d = _deg(z, p)
    zz = np.concatenate([(f2 + z) / (f2 - z), -np.ones(d)])
    pz = (f2 + p) / (f2 - p)
    return zz, pz, k * (np.prod(f2 - z) / np.prod(f2 - p)).real

def _prewarp(f, fs): return 2 * fs * np.tan(pi * np.asarray(f, float) / fs)

def design_iir(kind, btype, order, edges, fs=2.0, rp=1.0, rs=40.0, butter_edge_rp=None):
    """kind: butter|cheby1|cheby2. btype: lowpass|highpass|bandpass|bandstop.
    edges: cutoff (lp/hp) or [low, high] (bp/bs) in Hz. For cheby1 the edge is the
    end of the ripple band; for cheby2 it is the start of the stopband.
    butter_edge_rp: for Butterworth, put -butter_edge_rp dB at the edge(s) instead of -3 dB.
    Returns dict(z, p, k, sos, b, a)."""
    z, p, k = {"butter": lambda: _buttap(order), "cheby1": lambda: _cheb1ap(order, rp),
               "cheby2": lambda: _cheb2ap(order, rs)}[kind]()
    if kind == "butter" and butter_edge_rp is not None:
        # scale the prototype so the response is exactly -butter_edge_rp dB at the (passband) edge(s)
        z, p, k = _lp2lp((z, p, k), (10 ** (butter_edge_rp / 10) - 1) ** (-1 / (2 * order)))
    wa = _prewarp(edges, fs)
    if btype == "lowpass":    z, p, k = _lp2lp((z, p, k), wa[()] if wa.ndim == 0 else wa[0])
    elif btype == "highpass": z, p, k = _lp2hp(z, p, k, wa[()] if wa.ndim == 0 else wa[0])
    elif btype == "bandpass": z, p, k = _lp2bp(z, p, k, np.sqrt(wa[0] * wa[1]), wa[1] - wa[0])
    elif btype == "bandstop": z, p, k = _lp2bs(z, p, k, np.sqrt(wa[0] * wa[1]), wa[1] - wa[0])
    else: raise ValueError(btype)
    z, p, k = _bilinear(z, p, k, fs)
    sos = zpk2sos(z, p, k)
    b, a = sos2tf(sos)
    return {"z": z, "p": p, "k": k, "sos": sos, "b": b, "a": a}

def min_order(kind, btype, passband, stopband, gpass_db, gstop_db, fs=2.0):
    """Minimum order meeting the spec (lowpass/highpass: scalar edges; bandpass/bandstop: pairs)."""
    wp, ws = np.atleast_1d(_prewarp(passband, fs)), np.atleast_1d(_prewarp(stopband, fs))
    if btype == "lowpass":    nat = ws[0] / wp[0]
    elif btype == "highpass": nat = wp[0] / ws[0]
    elif btype == "bandpass": nat = np.min(np.abs((ws ** 2 - wp[0] * wp[1]) / (ws * (wp[1] - wp[0]))))
    elif btype == "bandstop": nat = np.min(np.abs(ws * (wp[1] - wp[0]) / (ws ** 2 - wp[0] * wp[1])))
    else: raise ValueError(btype)
    nat = 1 / nat if btype == "bandstop" and nat < 1 else nat
    gp, gs = 10 ** (gpass_db / 10) - 1, 10 ** (gstop_db / 10) - 1
    if kind == "butter":
        n = np.log10(gs / gp) / (2 * np.log10(nat))
    else:
        n = np.arccosh(np.sqrt(gs / gp)) / np.arccosh(nat)
    return int(ceil(n - 1e-12))

def _pair_roots(r, tol=1e-9):
    """Group roots into conjugate pairs / real singles; returns list of root-lists."""
    r = list(r); cplx = [x for x in r if x.imag > tol]
    real = sorted([x.real for x in r if abs(x.imag) <= tol])
    groups = [[c, np.conj(c)] for c in cplx]
    while len(real) >= 2: groups.append([real.pop(0), real.pop(0)])
    if real: groups.append([real.pop()])
    return groups

def zpk2sos(z, p, k):
    """Pair poles (closest to unit circle last) with nearest zeros; returns (n,6) [b0 b1 b2 1 a1 a2]."""
    pg = sorted(_pair_roots(p), key=lambda g: np.max(np.abs(g)))     # least resonant first
    zg = _pair_roots(z)
    sections = []
    for g in pg:
        if zg:
            c = np.mean(g); j = int(np.argmin([np.min(np.abs(np.array(q) - c)) for q in zg]))
            zz = zg.pop(j)
        else: zz = []
        bb = np.real(np.poly(zz)) if zz else np.array([1.0])
        aa = np.real(np.poly(g))
        sections.append([np.pad(bb, (0, 3 - len(bb))), np.pad(aa, (0, 3 - len(aa)))])
    sos = np.array([np.concatenate([s[0], s[1]]) for s in sections])
    sos[0, :3] *= k
    return sos

def sos2tf(sos):
    b, a = np.array([1.0]), np.array([1.0])
    for s in sos:
        b = np.convolve(b, s[:3]); a = np.convolve(a, s[3:])
    return np.trim_zeros(b, "b") if False else b, a
