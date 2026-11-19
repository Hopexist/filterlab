"""Task C: test signal and power spectrum (the WAV parser is browser I/O and is tested in tests/cross_check.js)."""
import sys, os; sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
import numpy as np, scipy.signal as ss
from dsp import tone_signal, power_spectrum_db

def test_power_spectrum_matches_scipy_welch():
    x = np.random.default_rng(2).normal(size=20000)
    f, db = power_spectrum_db(x, 8000.0, nfft=1024)
    fw, P = ss.welch(x, fs=8000.0, window="hann", nperseg=1024, noverlap=512, detrend=False, scaling="spectrum")
    assert np.allclose(f, fw)
    # scipy's one-sided spectrum doubles interior bins (A^2/2 for a sine); ours reads A^2 (0 dB at full scale)
    assert np.allclose(db[1:-1], 10 * np.log10(2 * P[1:-1]), atol=1e-9)

def test_full_scale_sine_reads_0db():
    fs, nfft = 8000.0, 2048; f0 = 100 * fs / nfft
    x = np.sin(2 * np.pi * f0 * np.arange(8 * nfft) / fs)
    f, db = power_spectrum_db(x, fs, nfft)
    assert abs(db.max()) < 1e-6 and abs(f[np.argmax(db)] - f0) < 1e-9

def test_short_signal_is_zero_padded():
    f, db = power_spectrum_db(np.ones(100), 1000.0, nfft=256)
    assert len(f) == 129 and np.all(np.isfinite(db))

def test_tone_signal_deterministic_and_calibrated():
    a = tone_signal(40000, 8000.0, ((440, 0.5), (1800, 0.25)), noise_rms=0.01, seed=11)
    b = tone_signal(40000, 8000.0, ((440, 0.5), (1800, 0.25)), noise_rms=0.01, seed=11)
    assert np.array_equal(a, b)
    clean = tone_signal(40000, 8000.0, ((440, 0.5), (1800, 0.25)))
    assert abs(np.std(a - clean) / 0.01 - 1) < 0.03
    f, db = power_spectrum_db(clean, 8000.0, 4096)
    assert abs(db[np.argmin(abs(f - 440))] - 20 * np.log10(0.5)) < 1.5     # Hann scalloping <= 1.42 dB
