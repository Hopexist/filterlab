# Task 0: Windows/VS Code port — implementation plan

> For agentic workers: executed natively (autonomous run, plan pre-approved). Steps use checkboxes.

**Goal:** every command in `CLAUDE.md` runs on Windows/VS Code with no npm packages, and the UI tests can fail.
**Architecture:** a ~150-line zero-dependency DevTools-protocol driver (`tests/browser.js`) replaces Playwright; `run_tests.js` detects the Python launcher and runs the suites; `cross_check.js` gets mixed tolerances and analytic IIR z/p comparison.
**Tech stack:** Node 26 (global `WebSocket`, `fetch`), Edge/Chrome headless, Python 3.12 + numpy/scipy.
**Spec:** `docs/superpowers/specs/2026-11-19-filterlab-design.md` (Task 0 section).

## Global constraints
- No `&&` in scripts or docs; no npm/pip installs; no POSIX-only tools.
- File URLs via `url.pathToFileURL(path.resolve(...))`; forward slashes.
- Browser from `EDGE_PATH`, `CHROME_PATH`, then common install locations, else a clear error.
- No DSP or UI behaviour changes in this task.

## Review focus
1. Browser missing -> clear error naming `EDGE_PATH`/`CHROME_PATH`, exit code non-zero (checked by hand with a bad `EDGE_PATH`).
2. Path with a space (`Code DEV`) -> page loads (the real repo path exercises it).
3. A missed spec or a console error -> `ui_sweep` exits 1 (checked by hand by forcing an impossible spec once).
4. Headless browser left running after a failure -> driver kills the child in `finally` and on exit.
5. Python launcher absent -> `run_tests.js` says which launchers it tried.

### Task 0.1: browser driver + ported UI scripts
**Files:** create `tests/browser.js`; rewrite `tests/ui_sweep.js`, `tests/ui_shots.js`.
**Produces:** `launch({width,height}) -> {page, close}`; `page.goto(url)`, `page.evaluate(fnOrString, ...args)`, `page.click(selector)`, `page.box(selector) -> {x,y,width,height}`, `page.drag(x0,y0,x1,y1,steps)`, `page.setViewport(w,h)`, `page.setScheme('light'|'dark')`, `page.screenshot(path)`, `page.errors` (console errors + page exceptions), `page.wait(ms)`; `fileUrl(rel)`.
- [ ] Driver: spawn with `--headless=new --remote-debugging-port=0 --user-data-dir=<tmp>`; poll `DevToolsActivePort`; `fetch /json/new`? -> use the browser target `Target.createTarget` + `Target.attachToTarget` flat sessions.
- [ ] `ui_sweep`: same checks as before; exit 1 on any MISS, failed drag (edge did not move), missing direct-form banner, or any console/page error.
- [ ] `ui_shots`: light and dark x 1440 and 390, response/time/quant tabs; exit 1 on console errors.
- [ ] Verify: `node tests/ui_sweep.js` prints 20 ok rows and exits 0; `node tests/ui_shots.js` writes 12 PNGs; look at them.

### Task 0.2: package.json + run_tests.js
- [ ] Scripts `test:py`, `test:js`, `test:ui`, `test:all`, `serve`, `build`, all via `node run_tests.js <name>`.
- [ ] Launcher detection: `python`, `py -3`, `python3`; first whose `-c "import numpy"` exits 0.
- [ ] Verify: `npm run test:all` exits 0.

### Task 0.3: cross_check hardening
- [ ] `close(name, js, py, {rtol=1e-9, atol=1e-12})` element-wise mixed tolerance; exact checks stay at 0.
- [ ] `export_reference.py` writes `z`, `p` (and `k`) for each IIR case; `cross_check` compares `designIIR(...).zeros/poles` as multisets sorted by (re, im) after rounding to 1e-9.
- [ ] Verify: `npm run test:js` exits 0 with the new checks listed.

### Task 0.4: README + commit
- [ ] README: launcher, `npm run` commands, no `python3`, no `&&`.
- [ ] Run all four suites; commit "Task 0: Windows/VS Code port and cross-check hardening".
