# Task D: docs — implementation plan

> Executed natively in the autonomous run (plan pre-approved).

**Goal:** README with the Python/JS name mapping and launcher choice, `docs/theory.md`, regenerated `examples/gallery.png`.
**Spec:** `docs/superpowers/specs/2026-11-19-filterlab-design.md` (Task D details).

## Review focus
1. README code that does not run -> the Python block is executed (exec of the fenced block) before commit.
2. Theory constants that drift from the code -> Kaiser constant and noise grid sizes checked against `dsp/fir.py`, `dsp/quant.py`, `web/dsp.js`.
3. The scaling definition stated loosely -> stated exactly: max over w of |B_k/A_k| = 1, leftover gain once at the output.
4. Unmeasured claims -> any number in theory.md is from a test or a run in this session, or marked "not measured".
5. Gallery out of date -> regenerated from `examples/demo.py`, with elliptic, types III/IV and error feedback added.

### Steps
- [x] README: features, layout, new Python examples (executed), mapping table, app paragraph, design notes; launcher section kept from task 0.
- [x] `docs/theory.md`: order estimates, FIR types, scaling definition and its cost, noise model, error feedback, overflow and headroom.
- [x] `examples/demo.py` extended; `gallery.png` regenerated and looked at.
- [x] All suites green; commit.
