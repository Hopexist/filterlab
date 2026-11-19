# Decisions

Format: decision / why / rejected alternative.

## Needs owner approval

(none yet)

## Decisions made during the run

- **Task 0. Browser readiness = DevToolsActivePort file, not the child's exit code.** Edge's Windows launcher exits 0 at once and hands off to the real browser. Rejected: waiting on the child process.
- **Task 0. `ui_shots.js` writes `{scheme}-{width}-{tab}.png` (12 shots).** Covers light and dark at 1440 and 390 for every tab. Rejected: the old 4-shot set, which had no phone width.
- **Task 0. `web/build.py` writes UTF-8 with `\n` explicitly.** On Windows, text mode wrote CRLF and rewrote all of `index.html` on every build. Rejected: a `.gitattributes` rule, which hides the problem instead of fixing it.
- **Task 0. `sos noise theory` cross-check keeps rtol 1e-3.** Python integrates on scipy's 2^15 grid and JS on its own grid, so 1e-3 is the honest bound (same as the baseline). Rejected: forcing 1e-9, which would need identical integration code.
- **Task 0. `*.zip` added to `.gitignore`.** The brief says never commit zip files. Rejected: deleting `filterlab (1).zip`, which is the owner's file.
- **Task 0. Tests run outside the agent's sandbox.** The sandbox blocks spawning a browser; this has no effect on the repo.
