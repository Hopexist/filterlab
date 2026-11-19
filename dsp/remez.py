"""Parks-McClellan (Remez exchange) for linear-phase FIR filters of types I-IV.

Every type is written A(w) = Q(w) P(cos w) with P a polynomial: Q = 1 (type I), cos(w/2) (II),
sin(w) (III), sin(w/2) (IV). The exchange fits P to D/Q with weight W*Q (Parks & McClellan, 1972)."""
import numpy as np
from math import pi

def _bary(xg, xs, C, bs):
    d = xg[:, None] - xs[None, :]
    hit = np.abs(d) < 1e-13
    d[hit] = 1.0
    t = bs / d
    A = (t @ C) / t.sum(axis=1)
    rows, cols = np.nonzero(hit)
    A[rows] = C[cols]
    return A

def _weights(x):
    diff = x[:, None] - x[None, :]
    np.fill_diagonal(diff, 1.0)
    return 1.0 / np.prod(diff, axis=1)

def remez(numtaps, bands, desired, weight=None, fs=2.0, grid_density=20, maxiter=80, tol=1e-9,
          return_info=False, *, kind="bandpass"):
    """bands: flat edge list [0, .2, .3, .5]; desired: gain per band; weight: per band.
    kind: "bandpass" (symmetric: type I for odd numtaps, II for even), "hilbert" or "differentiator"
    (antisymmetric: type III for odd, IV for even). For "differentiator", desired is the slope:
    D(f) = desired * f / fs, weighted by 1/f, as in scipy.signal.remez."""
    if kind not in ("bandpass", "hilbert", "differentiator"):
        raise ValueError(f"kind must be 'bandpass', 'hilbert' or 'differentiator', not {kind!r}")
    odd, anti = numtaps % 2 == 1, kind != "bandpass"
    edges = np.asarray(bands, float) / (fs / 2.0) * pi
    nb = len(edges) // 2
    desired = np.asarray(desired, float)
    weight = np.ones(nb) if weight is None else np.asarray(weight, float)
    if not odd and not anti and any(abs(edges[2 * b + 1] - pi) < 1e-12 and desired[b] != 0 for b in range(nb)):
        raise ValueError("even numtaps gives a type II filter, which has a forced zero at fs/2; "
                         "a band ending at fs/2 must have desired gain 0, or use an odd numtaps")
    L = numtaps // 2 + (1 if odd and not anti else 0)  # terms in P: (N+1)/2 for type I, else floor(N/2)
    Qf = (lambda w: np.ones_like(w)) if odd and not anti else (lambda w: np.cos(w / 2)) if not anti         else (lambda w: np.sin(w)) if odd else (lambda w: np.sin(w / 2))
    M = L - 1; R = M + 2
    # keep the grid off the forced zeros of Q (as scipy does): w = 0 for III/IV, w = pi for II/III
    delf = pi / (grid_density * L)
    if anti and edges[0] < delf: edges[0] = delf
    if (anti == odd) and edges[-1] > pi - delf: edges[-1] = pi - delf
    widths = edges[1::2] - edges[0::2]
    total = grid_density * (M + 1)
    w, D, W, starts = [], [], [], []
    pos = 0
    for b in range(nb):
        n = max(int(round(total * widths[b] / widths.sum())), 8)
        w.append(np.linspace(edges[2 * b], edges[2 * b + 1], n))
        wb = w[-1]
        if kind == "differentiator":
            f = wb / (2 * pi)
            D.append(desired[b] * f); W.append(weight[b] / f if desired[b] >= 1e-4 else np.full(n, weight[b]))
        else:
            D.append(np.full(n, desired[b])); W.append(np.full(n, weight[b]))
        starts.append((pos, pos + n)); pos += n
    w, D, W = map(np.concatenate, (w, D, W))
    q = Qf(w); D = D / q; W = W * q
    xg = np.cos(w)
    ext = np.unique(np.round(np.linspace(0, len(w) - 1, R)).astype(int))
    while len(ext) < R:  # extremely coarse grid fallback
        ext = np.unique(np.concatenate([ext, np.random.randint(0, len(w), R - len(ext))]))
    delta = 0.0
    for it in range(maxiter):
        x = xg[ext]; b = _weights(x)
        sign = (-1.0) ** np.arange(R)
        delta = np.sum(b * D[ext]) / np.sum(b * sign / W[ext])
        C = D[ext] - sign * delta / W[ext]
        xs, Cs = x[:-1], C[:-1]
        bs = _weights(xs)
        A = _bary(xg, xs, Cs, bs)
        E = W * (D - A)
        # candidate extrema, band by band (band edges are always candidates)
        cand = []
        for s, t in starts:
            Eb = E[s:t]; e = np.abs(Eb); sg = np.sign(Eb); last = t - s - 1
            for i in range(t - s):
                # a lobe boundary (sign change) counts as a lobe edge, so single-point lobes survive
                left = i == 0 or e[i] >= e[i - 1] or sg[i] != sg[i - 1]
                right = i == last or e[i] >= e[i + 1] or sg[i] != sg[i + 1]
                if left and right: cand.append(s + i)
        # enforce alternation of sign
        keep = []
        for i in cand:
            if keep and np.sign(E[i]) == np.sign(E[keep[-1]]):
                if abs(E[i]) > abs(E[keep[-1]]): keep[-1] = i
            else:
                keep.append(i)
        while len(keep) > R:
            if abs(E[keep[0]]) < abs(E[keep[-1]]): keep.pop(0)
            else: keep.pop()
        if len(keep) < R:
            break  # cannot refine further; use current solution
        new = np.array(keep)
        Q = np.max(np.abs(E))
        if np.array_equal(new, ext) or (Q - abs(delta)) / Q < tol:
            ext = new; break
        ext = new
    # recompute interpolant for final extremal set
    x = xg[ext]; b = _weights(x); sign = (-1.0) ** np.arange(R)
    delta = np.sum(b * D[ext]) / np.sum(b * sign / W[ext])
    C = D[ext] - sign * delta / W[ext]
    xs, Cs = x[:-1], C[:-1]; bs = _weights(xs)
    if odd and not anti:   # type I: unchanged closed form
        wk = 2 * pi * np.arange(M + 1) / numtaps
        Ak = _bary(np.cos(wk), xs, Cs, bs)
        n = np.arange(numtaps)
        h = (Ak[0] + 2 * (np.cos(np.outer(n - M, wk[1:])) @ Ak[1:])) / numtaps
    else:                  # inverse DFT of the amplitude at the N DFT frequencies (Qf carries the sign past pi)
        wk = 2 * pi * np.arange(numtaps) / numtaps
        Ak = Qf(wk) * _bary(np.cos(wk), xs, Cs, bs)
        t = np.outer(wk, np.arange(numtaps) - (numtaps - 1) / 2)
        h = (Ak @ (-np.sin(t) if anti else np.cos(t))) / numtaps  # H = j A e^{-jw(N-1)/2} for antisymmetric
    if return_info:
        return h, {"delta": abs(delta), "iterations": it + 1, "extremal_freqs": w[ext] / pi * fs / 2}
    return h
