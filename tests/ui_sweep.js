// Drives the real page: every method x response type (auto order) must meet its spec, then interaction checks.
// Exits 1 on any missed spec, failed interaction check, console error or page error.
const { launch, fileUrl } = require('./browser');
const path = require('path');
const SHOTS = path.resolve(__dirname, '..', 'shots');

const METHODS = ['remez', 'window', 'butter', 'cheby1', 'cheby2', 'ellip'];
const BTYPES = ['lowpass', 'highpass', 'bandpass', 'bandstop'];

(async () => {
  const { page: p, close } = await launch({ width: 1440, height: 1000 });
  const problems = [];
  try {
    await p.goto(fileUrl('web/index.html')); await p.wait(500);
    const rows = await p.evaluate((methods, btypes) => {
      const F = window.__filterlab, out = [];
      for (const method of methods)
        for (const btype of btypes) {
          const st = F.state; Object.assign(st, { method, btype, fs: 8000, rp: 1, rs: method === 'window' ? 50 : 60, win: 'kaiser', orderMode: 'auto', edges: { lowpass: [1000, 1500], highpass: [1000, 1500], bandpass: [500, 1000, 2000, 2500], bandstop: [800, 1200, 2000, 2400] }[btype] });
          const t0 = performance.now(); const d = F.designFilter(st, false);
          out.push({ method, btype, size: d.size, ripple: +d.m.ripple.toFixed(3), atten: +d.m.atten.toFixed(1), ok: !!(d.passRipple && d.stopOk), ms: Math.round(performance.now() - t0) });
        }
      return out;
    }, METHODS, BTYPES);
    for (const r of rows) {
      if (!r.ok) problems.push(`${r.method} ${r.btype} missed spec`);
      console.log(r.ok ? 'ok  ' : 'MISS', r.method.padEnd(8), r.btype.padEnd(9), String(r.size).padEnd(22), `ripple ${r.ripple} dB, atten ${r.atten} dB`, `${r.ms}ms`);
    }
    console.log(`${rows.length - problems.length} of ${rows.length} designs meet spec`);

    // render every tab for an IIR bandpass to catch runtime errors
    await p.evaluate(() => { const s = window.__filterlab.state; Object.assign(s, { method: 'cheby1', btype: 'bandpass', edges: [500, 1000, 2000, 2500], orderMode: 'auto' }); });
    for (const tab of ['response', 'time', 'quant']) { await p.click(`[data-tab=${tab}]`); await p.wait(250); }

    // IIR direct-form instability demo: the banner must appear
    await p.evaluate(() => { const s = window.__filterlab.state; Object.assign(s, { method: 'butter', btype: 'lowpass', edges: [200, 400], rp: 1, rs: 80, orderMode: 'auto' }); s.q.struct = 'direct'; s.q.coef = 12; });
    await p.click('[data-tab=response]'); await p.click('[data-tab=quant]'); await p.wait(500);
    const banner = await p.evaluate(() => (document.querySelector('.banner')?.textContent || '').slice(0, 130));
    console.log('direct form banner:', banner || 'none');
    if (!banner) problems.push('direct-form instability banner missing');
    await p.screenshot(path.join(SHOTS, 'iir-direct-unstable.png'));

    // drag the stopband edge on the magnitude plot: the edge, the input box and the design must follow
    await p.evaluate(() => { const s = window.__filterlab.state; Object.assign(s, { method: 'remez', btype: 'lowpass', edges: [1000, 1500], rp: 1, rs: 60 }); s.q.struct = 'sos'; });
    await p.click('[data-tab=response]'); await p.wait(300);
    const h = await p.box('.handle[data-key="1"] .tab'); const before = await p.evaluate(() => window.__filterlab.state.edges.slice());
    await p.drag(h.x + h.width / 2, h.y + h.height / 2, h.x + h.width / 2 + 60, h.y + 10); await p.wait(500);
    const after = await p.evaluate(() => ({ e: window.__filterlab.state.edges.slice(), size: window.__filterlab.current.size, input: document.getElementById('e1').value }));
    console.log('drag stopband edge', before, '->', after.e, '| input shows', after.input, '|', after.size);
    if (!(after.e[1] > before[1])) problems.push('dragging the stopband edge did not move it');
    if (Math.abs(+after.input - after.e[1]) > 1) problems.push('edge input box does not match the dragged edge');
    await p.screenshot(path.join(SHOTS, 'after-drag.png'));

    // error feedback on a narrow low-pass must lower the measured noise and stay close to theory; wrap mode must render
    await p.evaluate(() => { const s = window.__filterlab.state; Object.assign(s, { method: 'butter', btype: 'lowpass', edges: [80, 160], rp: 1, rs: 40, orderMode: 'auto' }); Object.assign(s.q, { struct: 'sos', coef: 20, sig: 16, ef: false, headroom: 0, overflow: 'saturate' }); });
    await p.click('[data-tab=response]'); await p.click('[data-tab=quant]'); await p.wait(400);
    const noiseRow = () => p.evaluate(() => { const r = [...document.querySelectorAll('.score .row')].find(x => x.querySelector('.lab')?.textContent === 'Round-off noise'); return r ? { db: parseFloat(r.querySelector('.val').textContent), ok: r.querySelector('.ic').classList.contains('ok') } : null; });
    const off = await noiseRow(); await p.click('#qEF'); await p.wait(400); const on = await noiseRow();
    console.log('error feedback: noise', off && off.db, 'dB ->', on && on.db, 'dB; theory agreement', on && on.ok);
    if (!off || !on || !(off.db - on.db >= 6)) problems.push('error feedback did not lower the measured noise by 6 dB in the app');
    if (on && !on.ok) problems.push('error-feedback noise is more than 3 dB from theory in the app');
    await p.evaluate(() => { document.getElementById('qOver').value = 'wrap'; document.getElementById('qOver').dispatchEvent(new Event('change')); });
    await p.wait(300); await p.screenshot(path.join(SHOTS, 'quant-ef-wrap.png'));
    const diagram = await p.evaluate(() => !!document.querySelector('svg.df') && !!document.querySelector('svg.df .df-ef'));
    console.log('DF-I diagram with error-feedback path:', diagram);
    if (!diagram) problems.push('signal-flow diagram (with the error-feedback path) missing on the Quantization tab');

    // compare mode: pin A as B, change the design, B must stay drawn dashed with its own legend entry
    await p.evaluate(() => { const s = window.__filterlab.state; Object.assign(s, { method: 'cheby1', btype: 'lowpass', edges: [1000, 1500], rp: 1, rs: 60, orderMode: 'auto' }); });
    await p.click('[data-tab=response]'); await p.wait(300); await p.click('#pinB'); await p.wait(200);
    await p.evaluate(() => { const s = window.__filterlab.state; s.method = 'ellip'; }); await p.click('[data-tab=time]'); await p.click('[data-tab=response]'); await p.wait(300);
    const cmp = await p.evaluate(() => ({ dashed: document.querySelectorAll('#cMag path.trace[stroke-dasharray]').length, legend: document.querySelector('#view .legend')?.textContent || '' }));
    console.log('compare mode:', cmp.dashed, 'dashed trace,', JSON.stringify(cmp.legend.slice(0, 80)));
    if (cmp.dashed !== 1 || !/B: Chebyshev I/.test(cmp.legend)) problems.push('compare mode did not draw the pinned design B');
    await p.screenshot(path.join(SHOTS, 'compare.png'));
    await p.click('#pinB');

    // phone layout: tab bar fixed to the bottom of the viewport, no horizontal scrolling, 44 px targets
    await p.setViewport(390, 844); await p.wait(400);
    const phone = await p.evaluate(() => {
      const t = document.querySelector('.tabs'), r = t.getBoundingClientRect(), small = [...document.querySelectorAll('.tabs button, .seg button, .controls summary')].filter(b => b.getBoundingClientRect().height > 0 && b.getBoundingClientRect().height < 44).length;
      return { fixed: getComputedStyle(t).position === 'fixed', atBottom: Math.abs(r.bottom - innerHeight) < 2, overflow: document.documentElement.scrollWidth - innerWidth, small };
    });
    console.log('phone 390 px:', JSON.stringify(phone));
    if (!phone.fixed || !phone.atBottom) problems.push('phone tab bar is not fixed to the bottom');
    if (phone.overflow > 0) problems.push(`phone layout scrolls sideways by ${phone.overflow} px`);
    if (phone.small) problems.push(`${phone.small} tab, segment or group controls are under 44 px tall on a phone`);
    await p.setViewport(1440, 1000);
  } catch (e) {
    problems.push('script error: ' + e.message);
  } finally {
    problems.push(...p.errors);
    await close();
  }
  console.log(problems.length ? `\nUI SWEEP FAILED (${problems.length}):\n  ` + problems.join('\n  ') : '\nui sweep passed, no console errors');
  process.exit(problems.length ? 1 : 0);
})().catch(e => { console.error(e.message); process.exit(1); });
