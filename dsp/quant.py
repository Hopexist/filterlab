"""Fixed-point quantization analysis: coefficient quantization, bit-true simulation, noise theory.

Format convention: signed Qm.n  -> 1 sign bit + m integer bits + n fraction bits.
"""
import numpy as np
from dataclasses import dataclass
from .analysis import freqz, sos_freqz, roots_of
from .iir import sos2tf

@dataclass(frozen=True)
class QFormat:
    int_bits: int
    frac_bits: int
    @property
    def word(self): return 1 + self.int_bits + self.frac_bits
    @property
    def lsb(self): return 2.0 ** -self.frac_bits
    @property
    def lo(self): return -(2.0 ** self.int_bits)
    @property
    def hi(self): return 2.0 ** self.int_bits - self.lsb
    def __str__(self): return f"Q{self.int_bits}.{self.frac_bits} ({self.word}-bit)"

def auto_format(max_abs, word):
    """Smallest integer part that holds max_abs; remaining bits go to the fraction."""
    m = 0 if max_abs < 1 else int(np.floor(np.log2(max_abs))) + 1
    return QFormat(m, word - 1 - m)

def to_int(x, fmt, rounding="nearest", overflow="saturate"):
    s = np.asarray(x, float) * 2.0 ** fmt.frac_bits
    q = np.floor(s + 0.5) if rounding == "nearest" else (np.floor(s) if rounding == "floor" else np.trunc(s))
    lo, hi = -(2 ** (fmt.word - 1)), 2 ** (fmt.word - 1) - 1
    if overflow == "saturate": q = np.clip(q, lo, hi)
    else: q = ((q - lo) % (hi - lo + 1)) + lo       # two's-complement wrap
    return q.astype(np.int64)

def quantize(x, fmt, rounding="nearest", overflow="saturate"):
    return to_int(x, fmt, rounding, overflow) * fmt.lsb

def sqnr_db(ref, test):
    ref, test = np.asarray(ref), np.asarray(test)
    return 10 * np.log10(np.mean(ref ** 2) / max(np.mean((test - ref) ** 2), 1e-300))

# ---------- coefficient quantization ------------------------------------------------
def quantize_fir(h, word, fs=2.0, n=4096):
    fmt = auto_format(np.max(np.abs(h)), word); hq = quantize(h, fmt)
    f, H = freqz(h, 1, n, fs); _, Hq = freqz(hq, 1, n, fs)
    return {"fmt": fmt, "hq": hq, "max_coeff_err": float(np.max(np.abs(hq - h))), "f": f,
            "H": H, "Hq": Hq, "max_resp_err_db": float(20 * np.log10(np.max(np.abs(Hq - H)) + 1e-300))}

def scale_sos(sos, n=1024):
    """Peak-scale a biquad cascade the way fixed-point code does: every section is scaled to unit peak
    gain and the leftover gain is returned separately (applied once, at the output).
    Returns (scaled_sos, gain) with  H = gain * prod(H_scaled_k)."""
    sos = np.array(sos, float); k = sos[0, 0]; sos[0, :3] /= k          # sections are monic; section 0 carried k
    w = np.linspace(0, np.pi, n); z = np.exp(-1j * w); gain = k
    for s in sos:
        pk = np.max(np.abs(np.polyval(s[2::-1], z) / np.polyval(s[5:2:-1], z)))   # B(z^-1) / A(z^-1)
        s[:3] /= pk; gain *= pk
    return sos, gain

def quantize_sos(sos, word):
    """Scale (see scale_sos), then quantize every coefficient (a0 stays 1) to one shared format.
    Returns (fmt, quantized_scaled_sos, gain)."""
    sc, gain = scale_sos(sos)
    fmt = auto_format(np.max(np.abs(sc[:, [0, 1, 2, 4, 5]])), word)
    sq = sc.copy()
    for c in (0, 1, 2, 4, 5): sq[:, c] = quantize(sc[:, c], fmt)
    return fmt, sq, gain

def quantize_direct_form(b, a, word):
    """Quantize a single high-order (b, a) pair - exposes how fragile direct form is."""
    b = np.asarray(b, float); gain = np.max(np.abs(b)); bs = b / gain          # output gain applied separately
    fmt = auto_format(max(np.max(np.abs(bs)), np.max(np.abs(a))), word)
    bq, aq = quantize(bs, fmt), quantize(a, fmt); aq[0] = 1.0
    p = roots_of(aq)
    return {"fmt": fmt, "bq": bq, "aq": aq, "gain": gain, "poles": p,
            "max_pole_radius": float(np.max(np.abs(p))) if len(p) else 0.0,
            "stable": bool(len(p) == 0 or np.max(np.abs(p)) < 1)}

def fir_wordlength_sweep(h, words, passband_hz, stopband_hz, fs=2.0, n=4096):
    """Min stopband attenuation and passband ripple as coefficient word length shrinks."""
    out = []
    for w in words:
        q = quantize_fir(h, w, fs, n); f = q["f"]; mag = 20 * np.log10(np.maximum(np.abs(q["Hq"]), 1e-12))
        out.append({"word": w, "stopband_db": float(-mag[f >= stopband_hz].max()),
                    "ripple_db": float(np.ptp(mag[f <= passband_hz]))})
    return out

# ---------- bit-true simulation -----------------------------------------------------
def simulate_fir_fixed(h, x, coef_fmt, sig_fmt):
    """Direct-form FIR, exact wide accumulator, one rounding at the output.
    Returns (y_fixed, y_float_with_quantized_coefs, y_float_ideal)."""
    hi = to_int(h, coef_fmt); xi = to_int(x, sig_fmt)
    acc = np.convolve(xi, hi)[: len(xi)]
    sh = coef_fmt.frac_bits
    yi = (acc + (1 << (sh - 1))) >> sh if sh > 0 else acc
    lo_, hi_ = -(2 ** (sig_fmt.word - 1)), 2 ** (sig_fmt.word - 1) - 1
    y = np.clip(yi, lo_, hi_) * sig_fmt.lsb
    return y, np.convolve(xi * sig_fmt.lsb, hi * coef_fmt.lsb)[: len(xi)], np.convolve(x, h)[: len(x)]

def simulate_sos_fixed(sos, x, coef_fmt, sig_fmt):
    """Cascade of direct-form-I biquads; each section rounds once (after its accumulator)."""
    xi = [int(v) for v in to_int(x, sig_fmt)]
    cs = [[int(v) for v in to_int(s[[0, 1, 2, 4, 5]], coef_fmt)] for s in sos]
    sh = coef_fmt.frac_bits; half = 1 << (sh - 1) if sh > 0 else 0
    lo_, hi_ = -(2 ** (sig_fmt.word - 1)), 2 ** (sig_fmt.word - 1) - 1
    cur = xi
    for b0, b1, b2, a1, a2 in cs:
        x1 = x2 = y1 = y2 = 0; out = []
        for v in cur:
            acc = b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
            y = max(lo_, min(hi_, (acc + half) >> sh))
            x2, x1, y2, y1 = x1, v, y1, y
            out.append(y)
        cur = out
    return np.array(cur) * sig_fmt.lsb

# ---------- theory ------------------------------------------------------------------
def fir_noise_theory(h, sig_fmt, input_quantized=True):
    """Output round-off noise variance: one rounding at the output (+ input quantization shaped by h)."""
    d2 = sig_fmt.lsb ** 2 / 12
    return d2 * (1 + (np.sum(np.asarray(h) ** 2) if input_quantized else 0))

def _energy(num_secs, den_secs, n=1 << 15):
    """Energy of the impulse response of prod(B_k/A_k) via Parseval on a dense unit-circle grid."""
    w = 2 * np.pi * np.arange(n) / n; z = np.exp(-1j * w); H = np.ones(n, complex)
    for b in num_secs: H = H * np.polyval(np.asarray(b, float)[::-1], z)
    for a in den_secs: H = H / np.polyval(np.asarray(a, float)[::-1], z)
    return float(np.mean(np.abs(H) ** 2))

def sos_noise_theory(sos, sig_fmt, input_quantized=True):
    """Round-off noise variance of a DF-I biquad cascade with one rounding per section.
    Section k's error is shaped by 1/A_k(z) (it re-enters its own recursion) and then by the
    remaining sections; the input quantization error passes through the whole cascade."""
    d2 = sig_fmt.lsb ** 2 / 12
    total = d2 * _energy([s[:3] for s in sos], [s[3:] for s in sos]) if input_quantized else 0.0
    for k in range(len(sos)):
        rest = sos[k + 1:]
        total += d2 * _energy([s[:3] for s in rest], [sos[k, 3:]] + [s[3:] for s in rest])
    return total
