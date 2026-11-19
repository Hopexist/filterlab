"""Test signals and power spectra for the time-domain demo (numpy only; mirrored in web/dsp.js)."""
import numpy as np

def _mulberry32(seed, n):
    """The 32-bit mulberry32 generator, bit-identical to the JS version: n uniforms in [0, 1)."""
    M = 0xFFFFFFFF; a = seed & M; out = np.empty(n)
    imul = lambda x, y: (x * y) & M
    for i in range(n):
        a = (a + 0x6D2B79F5) & M
        t = imul(a ^ (a >> 15), 1 | a)
        t = ((t + imul(t ^ (t >> 7), 61 | t)) & M) ^ t
        out[i] = (t ^ (t >> 14)) / 4294967296
    return out

def tone_signal(n, fs, tones=(), noise_rms=0.0, seed=7):
    """Sum of sines amp * sin(2 pi f k / fs) plus seeded white Gaussian noise (Box-Muller on mulberry32)."""
    k = np.arange(n); x = np.zeros(n)
    for f, amp in tones: x += amp * np.sin(2 * np.pi * f * k / fs)
    if noise_rms > 0:
        u = _mulberry32(seed, 2 * ((n + 1) // 2)).reshape(-1, 2)
        m = np.sqrt(-2 * np.log(np.maximum(u[:, 0], 1e-12))) * noise_rms
        g = np.column_stack([m * np.cos(2 * np.pi * u[:, 1]), m * np.sin(2 * np.pi * u[:, 1])]).ravel()[:n]
        x += g
    return x

def power_spectrum_db(x, fs, nfft=4096):
    """Averaged periodogram (Welch): periodic Hann, 50 % overlap, one-sided, scaled so that a full-scale
    sine centred on a bin reads 0 dB. Signals shorter than nfft are zero-padded to one segment.
    Returns (f, db) with nfft/2 + 1 points."""
    if nfft < 2 or nfft & (nfft - 1): raise ValueError("nfft must be a power of two")
    x = np.asarray(x, float)
    if len(x) < nfft: x = np.pad(x, (0, nfft - len(x)))
    w = 0.5 - 0.5 * np.cos(2 * np.pi * np.arange(nfft) / nfft); hop = nfft // 2
    segs = np.array([x[s:s + nfft] * w for s in range(0, len(x) - nfft + 1, hop)])
    P = 4 * np.mean(np.abs(np.fft.rfft(segs, axis=1)) ** 2, axis=0) / np.sum(w) ** 2
    return np.arange(nfft // 2 + 1) * fs / nfft, 10 * np.log10(P + 1e-30)
