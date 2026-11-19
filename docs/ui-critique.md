# UI critique, before the polish pass (2026-11-19)

**Method.** This critique used Impeccable's `critique` in two isolated parts:
- **A:** a design review against Impeccable's rubric, done by reading the screenshots in `shots/`, light and dark, at 1440 and 390 px.
- **B:** `impeccable detect` run on `web/index.html` and on its file URL at 1440×1000 and 390×844, plus mechanical facts read from `style.css`.

There was no PRODUCT.md, so product context came from CLAUDE.md and the brief. Impeccable normally asks one question first; the owner asked for no questions, so that was skipped.

**Verdict: partly specific.** The plots are good, competent instrument work: shaded out-of-spec bands, P and S drag tabs, a unit circle, and a waveform with a cursor. Everything around them is a calm, generic tool UI: identical 12 px-radius cards, a grey-blue page, a book serif for headings and the system sans for everything else. Nothing in the chrome says "lab bench". None of the generic tells the brief warns about appear, such as eyebrows, gradients or cream-and-terracotta.

**Nielsen scores (0-4):**

| Heuristic | Score |
|---|---|
| Status | 3 |
| Real world | 3 |
| Control | 2 |
| Consistency | 3 |
| Error prevention | 3 |
| Recognition | 3 |
| Efficiency | 2 |
| Minimalism | 2 |
| Recovery | 3 |
| Help | 3 |

## Top 10 problems

1. **Readouts are not hero numbers.** `.score .val` and `.slider .big` are a 20 px book serif, with the unit at the same size and weight ("0.826 dB", "36 taps"). On a bench instrument the number is the display.
2. **The Quantization verdict is buried.** "Rounding effects", the tab's actual result (for example a stopband that fails at 49.5 dB), is the last card in the side column, about 2,000 px down, under Hardware export and Simulate hardware.
3. **Walls of text in the side column.** The export and simulator cards carry four or five caption paragraphs each. The honesty wording must stay, but it does not all need to be open at once.
4. **Dead space at 1440 px.** On the Quantization and Time tabs, the left column ends near y = 860 and the right column runs on for another 1,500 px.
5. **Phone: no plot in the first viewport.** At 390 px the whole control stack comes first, and the Magnitude plot starts below the fold. Switching tabs looks like nothing happened, because the top of every tab is the same control stack.
6. **The dark theme is an inversion, not a design.** The plot area is the same surface as the panel. The out-of-spec shading turns into a muddy maroon wash, and the selected segment is a pale-blue fill with dark text.
7. **Every surface is the same card.** Controls, plots and readouts share one radius, border and title style. Nothing marks the plot as the instrument screen.
8. **Chart text is small and muted.** Tick labels are 11 px in `--ink-3`. Light `--ink-3` on `--bg` is **4.09:1, which fails AA**. The P/S tab text is 10 px, and the pole-multiplicity label "35" collides with the × marker.
9. **The pole-zero legend is tiny.** "○ Zero × Pole" is set at 11 px, and the zeros are drawn with nearly the same weight as the circle.
10. **Small hit targets on desktop and tablet.** `.btn` is about 32-36 px, inputs about 32 px, and `summary` has a 24 px min-height. Only the ≤480 px layout raises them to 44 px, so touch laptops and tablets fall below the 40 px floor.

Also noted:
- **Detector:** a heading level is skipped (h1 → h3); there are nested cards at 390 px (`.seg` inside `.card-head`); there is a repeating-stripes gradient (the compare swatch).
- **Motion:** the trace "draw" animation plays on page load, which the brief rules out.
- **Signal tab:** the "First samples" plot is dense at 400 samples.

## What is already right (keep)

- The magnitude plot's draggable P/S tabs and the shaded out-of-spec regions.
- The Spec check that pairs the measured value, the target and a pass/fail mark (icon plus colour, not colour alone).
- Blue = floating point and orange = quantized, used consistently everywhere, including the waveform's `out_data`.
- Visible `:focus-visible`, a reduced-motion guard, and a bottom tab bar on phones.
