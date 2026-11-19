# Status: autonomous run on `auto/ui-interactive`

Run: 2026-11-19, 21:31Z to about 22:00Z (hard stop was 23:31Z). Branch `auto/ui-interactive` from `master` at
2ec3ddb (after `auto/ui-polish` was merged). Nothing was pushed. Scope was UI/UX only: `dsp/` is untouched, and no
computed number, honesty label or pass/fail rule changed.

**Headline.** Filterlab now has:
- five themes;
- a cursor shared across the Response plots;
- live scrubbing with a faint previous trace;
- transitions that only answer an action (none with reduced motion);
- keyboard shortcuts with a help dialog;
- a six-step guided tour;
- an SVG spec-sheet drawing;
- a pole-zero what-if mode labelled as exploration.

`ui_sweep` covers all of it with real pointer and key events.

**Found, needs your decision (not fixed, outside the allowed scope).** Parks-McClellan breaks for long filters at the default spec:
- at 160 taps and above, `web/dsp.js` `remez` returns all-zero coefficients and `dsp/remez.py` returns NaN;
- the app then shows an empty response, and the Spec check marks it ✓ ("0 dB ripple, 240 dB attenuation"): **a false pass**.

Auto mode (36 taps) is not affected; a manual order of 160 or more is. The new order slider goes up to 256 taps for FIR, which makes the problem easier to reach. The fix belongs in `remez` (Python first, then JS), plus a spec-check guard against an all-zero or non-finite filter. Both need your approval under the run rules.

## Tool inventory (present or absent, and what each influenced)

| Requested | Present? | Influence |
|---|---|---|
| impeccable | present | anti-pattern check on the direction pick; detector at the end (clean except the known 390 px segmented-control false positive) |
| ui-ux-pro-max | present | not re-queried this run; its earlier takeaways (dense spacing, mono for data, not colour alone) still apply |
| fonthound | present | not used: it needs the owner to pick by eye, and this run takes no questions |
| diagram-design | present | its rules (orthogonal dimension lines, a title block, two accents) shaped the spec-sheet drawing; the skill was not invoked |
| dataviz | present | validator run on every theme's trace pair; Phosphor's first pick failed and was corrected |
| frontend-design | **absent** | (ecc's `frontend-design-direction` exists; not used as a substitute) |
| stageshow | **absent** | tour built by hand |
| dimensional-drawing | **absent** | spec sheet built by hand |
| oil-ui | **absent** | 3 directions built by hand as real themes (`docs/ui-directions.md`) |
| emilkowalski skills | **absent** | the brief's fallback motion rules were followed |
| taste-skill | **absent** | dials applied by hand and logged (layout 3, motion 3, density 7) |
| brand-identity | **absent** | current identity kept |
| awwwards MCP | **absent** | no references pulled |

No vendored anime.js or motion.dev: motion is CSS plus the Web Animations API. Nothing was installed or fetched.

## Done

| Step | What landed | Commit |
|---|---|---|
| 0-1 | Tool inventory (`docs/RUNLOG.md`); four directions side by side (`docs/screenshots/directions.png`); Instrument stays the default, with reasons (`docs/ui-directions.md`) | `d445610` |
| 2 | Themes: Instrument light and dark, Swiss, Phosphor, Paper. Header switcher remembered per viewer (try/catch on storage); validator, AA contrast and line-weight encoding in every theme. Neumorphism, Pixel Art, Maximalism and Surrealism were not built (legibility); anything else requested is "later" | `11dc428` |
| 3a-f | Linked cursor (also by arrow keys); scrubbing with the controls kept and the previous trace faint; trace morph and counting readouts; shortcuts and the help `<dialog>`; guided tour (never auto-plays, restores your design); spec sheet SVG | `a24077f` |
| 4 | Verification fixes: spec-sheet label collisions, tour card placement, tour control sync | `0c06725` |
| 3g (stretch) | Pole-zero what-if, labelled "Exploration, not a spec-meeting design" | `086d335` |
| docs | README section on the interactions; this status | (wrap-up commit) |

## Verification

| Check | Result |
|---|---|
| `npm run test:all` | pass: 91 pytest, 204 cross-checks, 22 RTL tests (iverilog not installed, so not simulated), 86 interpreter checks, UI sweep, 36 screenshots, no console errors |
| `ui_sweep` additions | every theme (applies, survives a reload, no sideways scroll at 1440 and 390); linked cursor (same Hz on 3 plots, arrow keys); scrub (slider kept, faint trace, release redraw); motion (0 animations with reduced motion, morph and fade without, readouts settle exactly); shortcuts and help; **keyboard-only tour** (G, arrows, Tab to Finish, Enter, design restored, never on load); spec sheet (valid SVG, dimensions, same wording); what-if (label, trace moves, spec check unchanged) |
| Screenshots | all 36 looked at, plus close-ups of the tour, the spec sheet and every theme on a phone |
| Performance at 256 taps | linked-cursor broadcast 1.1 ms median / 1.6 ms p95; order scrub about 65 ms per frame; word-length scrub 95-145 ms per frame; one redraw of about 1 s when you release a 256-tap scrub (root-finding for the pole-zero plot, now lazy and skipped mid-scrub) |

## Decisions to review (details in `docs/DECISIONS.md`)

- Instrument stays the default. Phosphor and Paper ship as opt-in themes even though the earlier critique called their patterns generic tells, because the brief asked for them.
- FIR zeros are computed lazily (the same function, on first use), and long-FIR pole-zero plots wait until you release a scrub.
- The tour loads a demo design and restores yours at the end.
- The what-if response is normalised to a 0 dB peak.
- I added `press` and `setMotion` helpers to `tests/browser.js`, so the tests send real keys and can turn reduced motion on and off.

## Not verified

- Real touch dragging on a phone: scrub and what-if were driven by mouse events and key presses.
- Firefox and Safari: only headless Edge was run. The trace morph needs `d` to be animatable and silently does nothing where it isn't.
- Screen-reader output for the tour and the what-if handles: ARIA roles and labels are set, but no screen reader was run.
