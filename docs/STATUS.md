# Status: autonomous run on `auto/2h-run`

Run: 2026-11-19, 06:55Z to about 07:40Z, well inside the 2-hour budget. Branch `auto/2h-run`, from `b06142e`.
Nothing was pushed and no remote was added; `main` is untouched.

## Done

| Task | What landed | Commit |
|---|---|---|
| 0 | Windows/VS Code port: zero-dependency Edge/Chrome DevTools driver (`tests/browser.js`); `ui_sweep`/`ui_shots` ported and able to fail; `package.json` + `run_tests.js` (launcher detection, `test:py/js/ui/all`, `build`, `serve`); `cross_check` with mixed tolerance and analytic IIR zeros/poles/gain; `build.py` writes UTF-8 + LF; README commands | `5e3c9ca` |
| B | Parks-McClellan types II-IV (`remez(..., kind=)`), elliptic IIR + `min_order`, overflow saturate/wrap, input headroom, error feedback with theory; JS drift fixed; app: elliptic method, type II in auto mode, overflow/headroom/EF controls | `2a5955a` |
| A | Critique (ui-ux-pro-max, impeccable), then grouped collapsible controls, phone layout (bottom tab bar, 44 px targets), compare mode (pin B, dashed neutral ink), captions on the Quantization tab, DF-I signal-flow diagram with the rounding point and EF path | `b0a8b18` |
| D | README (Python/JS mapping table, launcher, new features), `docs/theory.md` (order estimates, FIR types, exact scaling definition and its cost, noise model, error feedback), `examples/gallery.png` regenerated | `568a54c` |
| C (stretch) | Signal tab: seeded tones or WAV upload, input/output spectra, float vs fixed point, first samples, SNR, playback (muted by default, capped); `tone_signal`/`power_spectrum_db` in Python + JS; bounds-checked `parseWav` | `fdbb0f5` |

Each task has its plan in `docs/superpowers/plans/` (committed separately), and every decision is in
`docs/DECISIONS.md`. Nothing was cut. The order was 0, B, A, D, C, as the brief asked.

## Final test results (all run on the final commit)

| Command | Result |
|---|---|
| `npm run test:py` (`python -m pytest tests -q`) | pass, 69 tests (31 baseline + 34 task B + 4 task C) |
| `npm run test:js` (`python tests/export_reference.py`, then `node tests/cross_check.js`) | pass, 181 checks (56 at baseline) |
| `node tests/ui_sweep.js` (inside `npm run test:ui`) | pass: 24/24 designs meet spec; direct-form banner; edge drag; error feedback in the app (-53.8 to -100.6 dB, agrees with theory); DF-I diagram; compare mode; phone layout (fixed bottom tab bar, no sideways scroll, no target under 44 px); Signal tab SNR 88 dB; WAV upload; clear error for a non-WAV file; no console errors |
| `node tests/ui_shots.js` | pass: 24 screenshots (4 tabs x light/dark x 1440/390, plus 390 viewport shots), no console errors |
| `npm run test:all` | pass (runs all of the above in order) |

Checks that the tests can fail: `ui_sweep` exits 1 for a bad `EDGE_PATH`, and the driver records injected
console and page errors. The error-feedback theory test fails when the sign is flipped (mutation-checked
by hand).

## Needs your review

- **Signature changes:** only the five approved ones were made. New public functions were added (allowed, not
  signature changes): `tone_signal`, `power_spectrum_db` (Python); `toneSignal`, `powerSpectrumDb`,
  `parseWav` (JS). Nothing is under "Needs owner approval" in DECISIONS.md.
- **JS default changed:** `firNoiseTheory`/`sosNoiseTheory` now default `inputQuantized = true`, matching
  Python (the approved drift fix); the app passes `false` explicitly, so the UI numbers are unchanged.
- **CLAUDE.md:** one stale line updated (Remez "type I only"). Please check you are happy with that.
- **App behaviour change:** in auto mode the equiripple low-pass/band-pass may now use an even length (one tap
  fewer, type II) when the measured response still meets spec. The default design is now 36 taps, not 37.
- **Hilbert and differentiator** are library + JS only; the app has no UI for them (DECISIONS.md says why).
- **Browser tests need to run outside the agent sandbox** (the sandbox blocks spawning Edge). They run
  normally from a VS Code terminal.

## Independent review

An agent-skills code-reviewer pass over the branch diff approved the DSP. It reproduced 69 pytest and
181 cross-checks, and its own extra Python/JS/scipy checks (remez types II-IV at N = 16-64, elliptic orders 1-10)
agreed to 5e-13 or better. It found four robustness issues in the test driver and app, all fixed and
re-verified before the final commit:
- the port wait could spin without sleeping;
- a dropped DevTools socket could hang a test forever;
- a failed launch could leak the browser and its temp profile;
- the Signal tab could show a stale result for a second WAV with the same name and length.

A fifth item, a type II band edge just below fs/2, is left as is, because scipy behaves the same way. See
DECISIONS.md.

Two `filterlab-cdp-*` profile folders remain in `%TEMP%`, left by the first sandboxed launch attempts
(before the cleanup fix). They are outside the repo, so they were not deleted.

## Known limits

- Per-section peak scaling can leave a large output gain (111, or 41 dB, for the README's order-8
  Chebyshev I), which multiplies the round-off noise at the output. This is documented in `docs/theory.md`;
  the scaling itself was not changed.
- The JS noise theory integrates on a 2^14 grid (Python: 2^15), so `sos_noise_theory` cross-checks at 1e-3
  relative, not machine precision.
- Elliptic `min_order` for band-stop uses the same selectivity formula as the other kinds. scipy's
  band-stop order functions also optimise the passband edges, so band-stop orders can differ from
  `ellipord`. Only lowpass, highpass and bandpass are tested against scipy.
- The Signal tab simulates up to 10 s of audio in the main thread; long FIR designs on 48 kHz files take a
  noticeable fraction of a second (not measured).
- The Signal tab charts show at most 140 dB of range; a quieter floor is clipped at the bottom.

## Not verified

- **Audio playback** was not heard. Headless Edge has no audio output. The code path (muted start, gain cap,
  clipping, stop on tab change) is implemented, but no test exercises it.
- **Real phones and touch input.** The 390 px layout was checked in headless Edge with a desktop pointer, not
  on a touch device. Drag handles have 44 px hit areas, but touch dragging was not tested.
- **macOS and Linux:** the browser lookup paths for those systems are written but were not run there.
- **`npm run serve`** was smoke-tested only through `node run_tests.js serve` with `PORT=8765` (HTTP 200,
  full page), not inside VS Code's Simple Browser.
- **Screen readers:** the ARIA roles and labels were reviewed in code, not with a screen reader.
- **The impeccable critique ran without a PRODUCT.md** (no questions allowed), using CLAUDE.md as product
  context.

## Plugins used

superpowers (writing-plans; TDD with failing tests first; verification before each commit), ui-ux-pro-max
(UX guideline searches for the critique), impeccable (critique context and the design detector: no findings),
diagram-design (connector, label and accessibility rules for the DF-I diagram), agent-skills (independent
code review of the branch), claude-security-style pass done in-thread over HTML sinks, exported-code
strings and clipboard handling (no issues found; the claude-security orchestrator was not launched).
