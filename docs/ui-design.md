# UI design plan: "bench instrument" (2026-11-19)

**Scope:** visual design only. No DSP change, no change to any computed number, and no change to any honesty
wording (spec pass/fail, "not run in an HDL simulator", the simulator's plain label).

## Concept

Filterlab should read as one instrument on a bench. Each plot is a **screen**: a recessed surface with a fine
graticule and luminous traces. Everything around the screens is the **front panel**: flat, quiet, square-ish,
labelled in engineering lettering. The **readouts** (taps, ripple, attenuation, SNR, word lengths) are the
display numbers: large, tabular, with small muted units, like the figures on a scope or spectrum-analyzer readout.

All of the boldness goes on the screens. The front panel takes none.

## Palette (named hex)

| Role | Light ("bench daylight") | Dark ("scope at night") |
|---|---|---|
| Page (bench) | `#e6e8e6` graphite-grey paper | `#0e1112` |
| Panel | `#f6f7f5` | `#161a1c` |
| Panel-2 (wells, code) | `#eceeeb` | `#1d2224` |
| **Screen** (plot field) | `#fcfdfc` | `#0a0d0e`, deeper than the panel, so the screen is recessed |
| Graticule | `#dde2df` | `#1d2628` |
| Bezel (screen frame) | `#9aa29e` | `#3a4447` |
| Ink / ink-2 / ink-3 | `#161a1d` / `#454d53` / `#5d666c` | `#e7eaeb` / `#b3bbbf` / `#909a9f` |
| Line (hairlines) | `#cdd2ce` | `#2a3134` |
| Accent (selection, focus) | `#1b5868` deep scope-teal | `#73c4d2` |
| Float / ideal trace | `#2a78d6` (unchanged) | `#3987e5` (unchanged) |
| Quantized trace | `#eb6834` (unchanged) | `#d95926` (unchanged) |
| Pass / fail | `#0b7a3b` / `#c23a39` | `#3fbf72` / `#ee7373` |

The two dark-theme surfaces are chosen separately, not inverted: the panel is a lifted graphite, and the screen
is darker than the panel, the way a CRT sits behind its bezel. The light theme keeps a bright screen on a grey
panel, like an LCD instrument.

Contrast was measured (`docs/ui-contrast.py`, WCAG 2 formula):
- **Light:** ink-3 is 4.76:1 on the page and 5.45:1 on the panel. ink-2 is 6.99:1 or better everywhere.
- **Dark:** ink-3 is 6.10:1 or better.

This fixes the old light ink-3, which was 4.09:1 on the page. The accent is 6.45:1 in light and 8.81:1 in dark.

## Type roles (system fonts; nothing embedded)

FontHound needs the owner to pick fonts by eye, and this run takes no questions. The only freely licensed font
file on disk is matplotlib's DejaVu, which does not suit the concept. So the fonts are a system stack:

- **Display / labels:** `Bahnschrift` (Windows' DIN 1451, i.e. engineering lettering), then `"DIN Alternate"`,
  `"Barlow"`, `"Roboto Condensed"`, `system-ui`. It is used for the h1–h3 headings, the tab labels and the hero
  readouts. The weight is 600 for headings and 400 (semi-condensed) for readouts.
- **Body:** `system-ui` / `"Segoe UI"`, 14 px / 1.45.
- **Data and code:** `"Cascadia Mono"`, `ui-monospace`, `Consolas`, used for signal names, the SV text and Q-formats.
- **Numbers everywhere:** `font-variant-numeric: tabular-nums` on readouts, inputs, ticks, tooltips and tables.

The readout scale is 30 px for the value and 13 px for the unit in ink-3. Labels are 13 px in ink-2. There are no
all-caps eyebrows.

## Layout

- **Front panel:** cards keep their structure, but the radius drops to 4 px (from 12 and 8), with hairline
  borders and no shadow. Card titles are Bahnschrift at 15 px.
- **Plot cards** get the screen surface inside a 1 px bezel. The graticule gets 1 px lines, and the chart text
  rises from 11 px in ink-3 to 12 px in ink-2.
- **Quantization tab:**
  - The result ("Rounding effects") moves to the top of the side column.
  - Hardware export and Simulate hardware move to a full-width row below the plots, side by side on wide screens,
    which removes the 1,500 px dead column.
  - The long "how this was checked" explanations move into a `<details>`. The honesty tags and the plain
    simulator label stay visible.
- **Phone (≤ 480 px):** the stage comes first and the controls follow it, so every tab opens on its plot. The
  bottom tab bar stays.
- **Hit targets:** 40 px minimum height for buttons, inputs, selects and summaries at every width (44 px on phones).

## Principles

1. The screens carry the colour, the controls carry none, and the accent is used only for selection and focus.
2. Numbers are the display: tabular, large, with small muted units.
3. Each theme is designed on its own terms, not inverted.
4. Motion only answers an action: a tab change and a details panel opening, both 120–160 ms and both off under
   `prefers-reduced-motion`. Nothing animates on load (the trace "draw" on load is removed).

## Self-review against generic defaults (revised)

- *First draft:* a near-black dark theme with a cyan accent. That is the "near-black plus one acid accent" tell.
  **Revised:** the teal is desaturated (`#73c4d2`) and used only for selection and focus. The dark surfaces are
  graphite, not black, and the screen gets its own tone.
- *First draft:* a phosphor-green graticule. That is a cliché, and it would fight the validated blue/orange
  traces. **Revised:** the graticule is neutral blue-grey.
- *First draft:* readouts in the monospace. Monospace numerals look like code, not a display. **Revised:** DIN
  (Bahnschrift) with tabular figures.
- *First draft:* square corners everywhere. That reads harsh and is a different template tell. **Revised:** 4 px
  on cards, 3 px on controls, and the screens square inside the bezel.
- *Rejected from ui-ux-pro-max:*
  - its "Biomimetic / Organic 2.0" style and "Enterprise Gateway" pattern (off-topic for a tool);
  - its red primary `#FF4D4D`;
  - its streaming-chart colours (`#00FF00`);
  - Google Fonts imports (no network allowed).

  *Taken from it:* dense spacing (an 8-32 px scale), a mono-for-data plus sans-for-labels pairing, its checklist
  (4.5:1 text, visible focus, reduced motion, 375-1440 px responsiveness), and "do not rely on colour alone" for
  charts. Ideal and quantized traces already differ by line style in compare mode and by legend; the dataviz
  validator re-checks the colours.
