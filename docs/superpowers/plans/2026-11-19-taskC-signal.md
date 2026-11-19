# Task C: time-domain demo — implementation plan

> Stretch task, started at 07:21Z with about 95 minutes left. Executed natively (plan pre-approved).

**Goal:** filter a seeded test signal or an uploaded WAV with the current design, and show input and output spectra, floating point against fixed point, with optional playback.
**Spec:** `docs/superpowers/specs/2026-11-19-filterlab-design.md` (Task C details).

## Interfaces
- Python `dsp/spectrum.py` (new public functions; no existing signature changes):
  `tone_signal(n, fs, tones=((f, amp), ...), noise_rms=0.0, seed=7) -> ndarray` (mulberry32 + Box-Muller, identical to JS);
  `power_spectrum_db(x, fs, nfft=4096) -> (f, db)`: Welch, periodic Hann, 50 % overlap, a full-scale sine on a bin reads 0 dB.
- JS `toneSignal(n, fs, tones, noiseRms, seed)`, `powerSpectrumDb(x, fs, nfft)` (radix-2 FFT), `parseWav(arrayBuffer) -> {fs, x, channels, seconds, format}`; it throws an Error with a plain message for anything it cannot read.

## Review focus
1. Malformed or hostile WAV (truncated chunk, chunk size past the end, 0 channels, absurd rate, 8-bit, A-law, > 10 s) -> a clear error, never a hang or a huge allocation.
2. Odd chunk padding (RIFF pads odd-sized chunks) -> skipped correctly.
3. Signal shorter than nfft -> zero-padded single segment.
4. Playback loudness -> starts muted; gain clamped to 0.5; samples clipped to +/-1; stops on tab change.
5. Long WAV CPU -> 10 s cap; simulation runs once per design/source change, not per frame.

### Steps
- [x] pytest: `test_power_spectrum_matches_scipy_welch`, `test_full_scale_sine_reads_0db`, `test_tone_signal_deterministic_and_calibrated`.
- [x] `dsp/spectrum.py`; export in `dsp/__init__.py`.
- [x] JS port; `export_reference.py` + `cross_check.js` (signal bit-for-bit within 1e-12, spectrum dB with mixed tolerance); WAV parser checks in Node with synthesized buffers (16/24/float32, stereo, errors).
- [x] "Signal" tab: source (test tones / WAV upload), input spectrum, output spectra (float vs fixed point, current Quantization settings), first 400 samples in time, SNR line, play buttons with a volume slider starting at 0.
- [x] `ui_sweep`: the Signal tab renders, the fixed-point SNR is finite, and a synthesized WAV loads through the file input; screenshots light and dark, 1440 and 390.
