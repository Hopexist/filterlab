# Filterlab theory notes

Short derivations behind the choices in `dsp/`. Notation: sample rate `fs`, normalised angular frequency
`w = 2 pi f / fs`, passband ripple `Rp` dB, stopband attenuation `Rs` dB,
`dp = (10^(Rp/20) - 1) / (10^(Rp/20) + 1)` and `ds = 10^(-Rs/20)`.

## 1. Order estimates

Every estimate below is a starting point. In auto mode the app measures the designed response and searches
until the measured ripple and attenuation meet the spec, so an estimate that is off by one costs time, not
correctness.

**Kaiser window** (`kaiser_params`). Kaiser fitted the window's stopband attenuation `A` (dB) and the
transition width `dw` (rad) as

    N - 1 = (A - 7.95) / (2.285 dw)       (rounded up, then forced odd)
    beta  = 0.1102 (A - 8.7)                     for A > 50
            0.5842 (A - 21)^0.4 + 0.07886 (A - 21)   for 21 <= A <= 50,   else 0

The window sets both ripples to the same `delta`, so the binding one is `A = -20 log10(min(dp, ds))`.

**Parks-McClellan** (`remez`, the app's first guess). Kaiser's formula for equiripple filters,

    N ~ (-10 log10(dp ds) - 13) / (14.6 df) + 1,      df = transition width / fs.

It is accurate to a few taps for low-pass designs and optimistic for narrow band-pass ones, which is why the
search follows it. Even lengths (type II) are tried as `N - 1` when the band at fs/2 is a stopband.

**Analog prototypes** (`min_order`). With prewarped edges `W = 2 fs tan(pi f / fs)` and the selectivity
`k = Wp / Ws` (band types map to an equivalent low-pass ratio first), let `gp = 10^(Rp/10) - 1` and
`gs = 10^(Rs/10) - 1`:

    Butterworth:      n >= log10(gs / gp) / (2 log10(1/k))
    Chebyshev I, II:  n >= acosh(sqrt(gs / gp)) / acosh(1/k)
    Elliptic:         n >= K(k^2) K'(k1^2) / (K'(k^2) K(k1^2)),     k1^2 = gp / gs

`K` is the complete elliptic integral of the first kind and `K'(m) = K(1 - m)`. The elliptic line is the
**degree equation**: an order-n elliptic map takes the modulus `k` to `k1` exactly, so the inequality is
tight. All orders are rounded up. `K` is computed with the arithmetic-geometric mean,
`K(m) = pi / (2 AGM(1, sqrt(1 - m)))`, and `K'` as `pi / (2 AGM(1, sqrt(m)))` so that tiny `m1` keeps its
precision.

**Elliptic prototype.** Given `n` and `m1 = gp / gs`, the degree equation is solved for the selectivity
modulus `m` by the nome series (Orfanidis): `q = exp(-pi K'(m1) / (n K(m1)))`, and then
`m = 16 q (sum q^(j(j+1)) / (1 + 2 sum q^(j^2)))^4`. Zeros sit at `j / (sqrt(m) sn(u_i K/n, m))`. Poles come
from Jacobi functions at the shifted argument `v0 = K sc^-1(1/eps, 1 - m1) / (n K(m1))`. `sn`, `cn` and `dn`
use the descending AGM, and the inverse `sc` uses descending Landen transformations. This is the same algorithm as
`scipy.signal.ellipap`, and the tests compare against it.

## 2. Linear-phase FIR types and Parks-McClellan

A linear-phase FIR with amplitude `A(w)` falls into one of four types. Each can be written
`A(w) = Q(w) P(cos w)` with `P` an ordinary polynomial in `x = cos w`:

| Type | Length | Symmetry | Q(w) | Forced zeros | Terms in P |
|---|---|---|---|---|---|
| I   | odd  | symmetric     | 1        | none        | (N+1)/2 |
| II  | even | symmetric     | cos(w/2) | w = pi      | N/2 |
| III | odd  | antisymmetric | sin(w)   | w = 0, pi   | (N-1)/2 |
| IV  | even | antisymmetric | sin(w/2) | w = 0       | N/2 |

The weighted error `W (D - Q P)` equals `(W Q)(D/Q - P)`. So the Remez exchange for `P`, run against the
desired response `D/Q` with weight `W Q`, solves every type with the same code. Grid points at the forced
zeros of `Q` are removed by pulling the band edge in by one grid step, as scipy does. A type II filter
cannot have gain at fs/2, so a band that reaches fs/2 with non-zero desired gain is rejected.
For a differentiator the desired response is `desired * f / fs`, weighted by `1/f`, so the relative error
is equiripple (scipy's convention). The taps come from an inverse DFT of `A(w_k) e^(-j w_k (N-1)/2)`, times
`j` for antisymmetric types, at the `N` DFT frequencies.

## 3. Scaling: the definition used

**Each biquad is scaled to unit peak gain of its own transfer function,**

    max over w of |B_k(e^jw) / A_k(e^jw)| = 1,

**and the leftover gain is applied once, at the output.** `scale_sos` divides each section's numerator by that
section's peak magnitude (on a 1024-point grid from 0 to pi) and returns the product of the peaks, together
with the original first-section gain, as one scalar. So `H(z) = gain * prod_k H_k_scaled(z)`.

Why this choice (per-section L-infinity), and not the other common ones:

- **It is what keeps narrow-band designs alive.** An unscaled narrow low-pass has numerator coefficients near
  1e-4, which a shared fixed-point format rounds to zero. Unit-peak sections bring every numerator to order 1.
- **It bounds each section's steady-state sinusoidal gain by 1.** A full-scale sine in any section cannot
  overflow that section's output. Transient overshoot (Gibbs) can still exceed 1, which is what the overflow
  modes and the headroom control are for.
- **It is local.** Each section's scaling depends only on that section, so it is easy to reason about and to
  reproduce in C.

- **Its cost: the leftover gain can be large.** Each section is scaled by its own resonant peak, so where
  that section is not resonating the in-band signal sits well below full scale inside the cascade. For the
  README's order-8 Chebyshev I low-pass (1 dB ripple, 1000 Hz at 8 kHz), the leftover gain is about 111
  (41 dB). Round-off noise inside the cascade is multiplied by that factor at the output. Watch the
  Quantization tab's signal-to-noise figure, not only the noise figure.

Rejected: cumulative L2 scaling (scale so that the energy at each section output is at most 1). It usually
gives more signal-to-noise on noise-like inputs (not measured here), but it lets sinusoids overflow, and the
scale factors depend on the section order. That choice belongs to the user, via headroom, not to the default.

## 4. Round-off noise model

Fixed point here means a signed Qm.n word (1 sign bit, m integer bits, n fraction bits), with step `q = 2^-n`.
Rounding to nearest makes an error that is uniform on `[-q/2, q/2)`, white, and independent of the signal
when the signal is busy. Its variance is

    sigma_e^2 = q^2 / 12.

**FIR** (`fir_noise_theory`). The accumulator is exact and the output is rounded once, so the output noise
is `q^2/12`, plus `q^2/12 * sum h^2` if the input quantisation is counted.

**Biquad cascade, direct form I** (`sos_noise_theory`). Section k rounds once, after its accumulator and
before its output delays (the point marked Q in the app's diagram). Its error `e_k[n]` enters at the output
node, so it re-circulates through that section's own feedback. It sees `1 / A_k(z)`, and then every
later section `H_{k+1} ... H_L`. Summing the independent contributions with Parseval:

    sigma_y^2 = (q^2/12) * sum_k || 1/A_k * prod_{j>k} H_j ||_2^2      (+ input term through the whole cascade)

`||G||_2^2` is computed as the mean of `|G(e^jw)|^2` on a dense grid (`2^15` points in Python, `2^14` in JS,
which is why the cross-check allows 1e-3 relative here). The tests require measured noise within 1 to 2 dB of
this prediction.

**Error feedback** (`simulate_sos_fixed(..., error_feedback=True)`). Keep the part of the accumulator that
rounding threw away, `r[n] = acc'[n] - y[n] 2^sh`, and subtract a filtered copy of it before the next
rounding:

    acc'[n] = acc[n] - c1 r[n-1] - c2 r[n-2],     c1 = round(a1), c2 = round(a2)
    y[n]    = (acc'[n] + half) >> sh

With `e = r / 2^sh`, the output is `y = acc'/2^sh - e`. Substituting `acc'` gives
`A(z) Y = B(z) X - N(z) E` with

    N(z) = 1 + c1 z^-1 + c2 z^-2,

so the section's own error is shaped by `N(z) / A(z)` instead of `1 / A(z)`. For poles near z = 1
(narrow low-pass), `a1 ~ -2` and `a2 ~ 1`, so `N(z) ~ (1 - z^-1)^2`. That puts a double zero exactly where
`1/A` has its peak. The theory is the formula above with `1/A_k` replaced by `N_k/A_k`. On the test case
(order-4 Butterworth at 0.02 fs, 24-bit coefficients, Q0.15 signal), error feedback lowers the output noise by
26 dB, and measurement matches theory to 0.06 dB. A flipped sign gives `1 - c1 z^-1 - c2 z^-2`, which
amplifies the noise instead; the test fails in that case, which pins the convention.

**Overflow and headroom.** `"saturate"` clamps each section output to the word's range; `"wrap"` keeps the low
bits (two's-complement wrap-around), which turns a small overflow into a full-scale sign flip.
`headroom_bits = h` scales the input by `2^-h` before it is quantised. That gives h bits of margin against
overshoot, and costs `6.02 h` dB of signal-to-noise, because the noise floor stays put while the signal
shrinks. The caller multiplies the output by `gain * 2^h`, and the app reports noise referred back to that
output scale.
