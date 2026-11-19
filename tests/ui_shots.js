// Screenshots of every tab in light and dark at desktop (1440) and phone (390) widths, to shots/.
// Exits 1 on any console error or page error.
const { launch, fileUrl } = require('./browser');
const path = require('path');
const SHOTS = path.resolve(__dirname, '..', 'shots');

(async () => {
  const { page: p, close } = await launch();
  const problems = []; let n = 0;
  try {
    for (const [w, h] of [[1440, 1000], [390, 844]])
      for (const scheme of ['light', 'dark']) {
        await p.setViewport(w, h); await p.setScheme(scheme);
        await p.goto(fileUrl('web/index.html')); await p.wait(800);
        for (const tab of ['response', 'time', 'quant', 'signal']) {
          await p.click(`[data-tab=${tab}]`); await p.wait(400);
          await p.screenshot(path.join(SHOTS, `${scheme}-${w}-${tab}.png`)); n++;
          // phone: also what the first screen really looks like (a full-page capture draws the fixed tab bar mid-page)
          if (w < 500) { await p.evaluate(() => window.scrollTo(0, 0)); await p.screenshot(path.join(SHOTS, `${scheme}-${w}-${tab}-viewport.png`), { fullPage: false }); n++; }
        }
      }
  } catch (e) {
    problems.push('script error: ' + e.message);
  } finally {
    problems.push(...p.errors);
    await close();
  }
  console.log(`${n} screenshots in shots/`);
  console.log(problems.length ? 'UI SHOTS FAILED:\n  ' + problems.join('\n  ') : 'no console errors');
  process.exit(problems.length ? 1 : 0);
})().catch(e => { console.error(e.message); process.exit(1); });
