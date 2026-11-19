// Drives the real page: every method x response type (auto order) must meet its spec, then interaction checks.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 1440, height: 1000 } }); const errs = [];
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); p.on('pageerror', e => errs.push('PAGEERR ' + e.message));
  await p.goto('file://' + process.cwd() + '/web/index.html'); await p.waitForTimeout(500);
  const rows = await p.evaluate(() => {
    const F = window.__filterlab, out = [];
    for (const method of ['remez', 'window', 'butter', 'cheby1', 'cheby2'])
      for (const btype of ['lowpass', 'highpass', 'bandpass', 'bandstop']) {
        const st = F.state; Object.assign(st, { method, btype, fs: 8000, rp: 1, rs: method === 'window' ? 50 : 60, win: 'kaiser', orderMode: 'auto', edges: { lowpass: [1000, 1500], highpass: [1000, 1500], bandpass: [500, 1000, 2000, 2500], bandstop: [800, 1200, 2000, 2400] }[btype] });
        const t0 = performance.now(); const d = F.designFilter(st, false);
        out.push({ method, btype, size: d.size, ripple: +d.m.ripple.toFixed(3), atten: +d.m.atten.toFixed(1), ok: d.passRipple && d.stopOk, ms: Math.round(performance.now() - t0), poles: d.poles.length, zeros: d.zeros.length });
      }
    return out;
  });
  let bad = 0; for (const r of rows) { if (!r.ok) bad++; console.log((r.ok ? 'ok  ' : 'MISS'), r.method.padEnd(8), r.btype.padEnd(9), r.size.padEnd(22), `ripple ${r.ripple} dB, atten ${r.atten} dB`, `${r.ms}ms`); }
  console.log(bad ? `${bad} designs missed spec` : 'all 20 designs meet spec');
  // render every tab for an IIR bandpass to catch runtime errors
  await p.evaluate(() => { const s = window.__filterlab.state; Object.assign(s, { method: 'cheby1', btype: 'bandpass', edges: [500, 1000, 2000, 2500], orderMode: 'auto' }); });
  for (const tab of ['response', 'time', 'quant']) { await p.click(`[data-tab=${tab}]`); await p.waitForTimeout(250); }
  // IIR direct form instability demo
  await p.evaluate(() => { const s = window.__filterlab.state; Object.assign(s, { method: 'butter', btype: 'lowpass', edges: [200, 400], rp: 1, rs: 80, orderMode: 'auto' }); s.q.struct = 'direct'; s.q.coef = 12; });
  await p.click('[data-tab=response]'); await p.click('[data-tab=quant]'); await p.waitForTimeout(500);
  console.log('direct form banner:', await p.evaluate(() => (document.querySelector('.banner')?.textContent || 'none').slice(0, 130)));
  await p.screenshot({ path: 'shots/iir-direct-unstable.png', fullPage: true });
  // drag a band edge on the magnitude plot
  await p.evaluate(() => { const s = window.__filterlab.state; Object.assign(s, { method: 'remez', btype: 'lowpass', edges: [1000, 1500], rp: 1, rs: 60 }); s.q.struct = 'sos'; });
  await p.click('[data-tab=response]'); await p.waitForTimeout(300);
  const h = await p.locator('.handle[data-key="1"] .tab').boundingBox(); const before = await p.evaluate(() => window.__filterlab.state.edges.slice());
  await p.mouse.move(h.x + h.width / 2, h.y + h.height / 2); await p.mouse.down(); await p.mouse.move(h.x + h.width / 2 + 60, h.y + 10, { steps: 6 }); await p.mouse.up(); await p.waitForTimeout(500);
  const after = await p.evaluate(() => ({ e: window.__filterlab.state.edges.slice(), size: window.__filterlab.current.size, input: document.getElementById('e1').value }));
  console.log('drag stopband edge', before, '->', after.e, '| input shows', after.input, '|', after.size);
  await p.screenshot({ path: 'shots/after-drag.png', fullPage: true });
  await b.close(); console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'no console errors');
})();
