// Real product screenshots for the landing page (docs/assets). Run: node web/site/capture.js (after python web/build.py).
const { launch, fileUrl } = require('../../tests/browser');
const path = require('path'), fs = require('fs');
const OUT = path.resolve(__dirname, '..', '..', 'docs', 'assets');

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { page: p, close } = await launch(); const errors = [];
  const theme = async t => p.evaluate(t => { const s = document.getElementById('theme'); s.value = t; s.dispatchEvent(new Event('change')); }, t);
  const set = async (st, tab) => { await p.evaluate((st, tab) => { const F = window.__filterlab; Object.assign(F.state, st); F.state.tab = tab === 'time' ? 'response' : 'time'; document.querySelector(`[data-tab=${tab}]`).click(); }, st, tab); await p.wait(500); };
  const iir = { method: 'cheby1', btype: 'lowpass', fs: 8000, edges: [1000, 1500], rp: 1, rs: 60, orderMode: 'auto' };
  try {
    // demo stage frames (Instrument dark, 1280x800): design, quantize, export, simulate
    await p.setViewport(1280, 800); await p.goto(fileUrl('web/index.html')); await p.wait(500); await theme('dark');
    await set(iir, 'response'); await p.screenshot(path.join(OUT, 'stage-1-design.png'), { fullPage: false });
    await p.evaluate(() => { const q = window.__filterlab.state.q; Object.assign(q, { coef: 10, sig: 16, ef: true, headroom: 1 }); });
    await set(iir, 'quant'); await p.screenshot(path.join(OUT, 'stage-2-quantize.png'), { fullPage: false });
    const shot = async (sel, name) => { const y = await p.evaluate(s => { const e = document.querySelector(s); e.scrollIntoView({ block: 'start' }); return scrollY; }, sel); await p.wait(200); await p.screenshot(path.join(OUT, name), { fullPage: false }); };
    await shot('#rtlCard', 'stage-3-export.png');
    await p.evaluate(() => { document.getElementById('rsimReset').click(); for (let i = 0; i < 20; i++) document.getElementById('rsimStep').click(); });
    await shot('#rsimCard', 'stage-4-simulate.png');
    // the spec-sheet drawing, exactly as the app exports it
    await theme('dark'); await set(iir, 'response'); fs.writeFileSync(path.join(OUT, 'spec-sheet.svg'), await p.evaluate(() => window.__filterlab.specSheetSvg(window.__filterlab.current, window.__filterlab.state)));
    // theme gallery thumbnails (Response tab, 1280x800, scaled down by the page)
    const themes = await p.evaluate(() => [...document.getElementById('theme').options].map(o => o.value));
    for (const t of themes) { await p.goto(fileUrl('web/index.html')); await p.wait(400); await theme(t); await set(iir, 'response'); await p.screenshot(path.join(OUT, `theme-${t}.png`), { fullPage: false }); }
    errors.push(...p.errors);
  } catch (e) { errors.push(e.message); } finally { await close(); }
  if (errors.length) { console.error('capture failed:\n  ' + errors.join('\n  ')); process.exit(1); }
  // shrink to JPEG with ffmpeg (theme thumbnails at 800 px wide); without ffmpeg the PNGs stay and the page will not find them
  const { spawnSync } = require('child_process');
  for (const f of fs.readdirSync(OUT).filter(f => f.endsWith('.png'))) {
    const src = path.join(OUT, f), dst = src.replace(/\.png$/, '.jpg'), args = ['-loglevel', 'error', '-y', '-i', src, ...(f.startsWith('theme-') ? ['-vf', 'crop=930:582:330:88,scale=800:-1', '-q:v', '4'] : ['-q:v', '3']), dst];
    const r = spawnSync('ffmpeg', args); if (r.status !== 0) { console.error('ffmpeg is needed to write docs/assets/*.jpg'); process.exit(1); } fs.unlinkSync(src);
  }
  console.log('wrote', fs.readdirSync(OUT).length, 'files to docs/assets');
})();
