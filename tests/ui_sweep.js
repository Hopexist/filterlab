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

    // desktop: no tab of an FIR or IIR design may scroll sideways at 1440 px
    for (const method of ['remez', 'cheby1']) {
      await p.evaluate(m => { const s = window.__filterlab.state; Object.assign(s, { method: m, btype: 'lowpass', fs: 8000, edges: [1000, 1500], rp: 1, rs: 60, orderMode: 'auto' }); Object.assign(s.q, { struct: 'sos', ef: true }); }, method);
      for (const tab of ['response', 'time', 'quant', 'signal']) {
        await p.click(`[data-tab=${tab}]`); await p.wait(300);
        const over = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
        if (over > 0) problems.push(`${method} ${tab} tab scrolls sideways by ${over} px at 1440 px`);
      }
    }
    console.log('desktop overflow check done (remez, cheby1 x 4 tabs)');

    // themes: each applies, is remembered across a reload, keeps every tab free of sideways scroll at 1440 and 390 px
    for (const t of ['swiss', 'phosphor', 'paper', 'dark', 'light']) {
      await p.evaluate(t => { const s = document.getElementById('theme'); s.value = t; s.dispatchEvent(new Event('change')); }, t);
      await p.goto(fileUrl('web/index.html')); await p.wait(500);
      const got = await p.evaluate(() => document.documentElement.dataset.theme);
      if (got !== t) problems.push(`theme ${t} was not remembered across a reload (got ${got})`);
      for (const [w, h] of [[1440, 1000], [390, 844]]) {
        await p.setViewport(w, h);
        for (const tab of ['response', 'quant']) {
          await p.click(`[data-tab=${tab}]`); await p.wait(250);
          const over = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
          if (over > 0) problems.push(`theme ${t}: ${tab} tab scrolls sideways by ${over} px at ${w} px`);
        }
      }
      await p.setViewport(1440, 1000);
    }
    console.log('themes: 5 applied, remembered, no sideways scroll');

    // hardware export card: present for FIR and IIR, honest label, text matches web/rtl.js for the shown settings
    for (const method of ['remez', 'cheby1']) {
      await p.evaluate(m => { const s = window.__filterlab.state; s.method = m; Object.assign(s.q, { ef: false, headroom: 0, coef: 16 }); }, method);
      await p.click('[data-tab=response]'); await p.click('[data-tab=quant]'); await p.wait(400);
      const ex = await p.evaluate(() => ({ tag: document.querySelector('#rtlCard .tag')?.textContent || '', text: document.getElementById('rtlText')?.textContent || '' }));
      console.log(`hardware export (${method}):`, ex.tag, '|', ex.text.split('\n')[0]);
      if (ex.tag !== 'Generated, not synthesized, not run in an HDL simulator') problems.push(`${method}: export card missing or not labelled honestly`);
      if (!/^\/\/ filterlab_(fir|sos): /.test(ex.text) || !/endmodule\n$/.test(ex.text)) problems.push(`${method}: export text missing or incomplete`);
    }

    // Simulate hardware: the interpreter runs the shown text; live comparison, stepping, cursor, a forced mismatch is reported
    const SIMLABEL = "Simulated in your browser by Filterlab's interpreter of the generated SystemVerilog. Not run in a standard HDL simulator, not synthesized.";
    const simState = () => p.evaluate(() => ({ cmp: document.getElementById('rsimCmp')?.textContent || '', read: document.getElementById('rsimRead')?.textContent || '',
      label: [...document.querySelectorAll('#rsimCard .caption')].map(c => c.textContent), rows: document.querySelectorAll('#rsimWave .wl').length }));
    for (const method of ['remez', 'cheby1']) {
      await p.evaluate(m => { const s = window.__filterlab.state; s.method = m; Object.assign(s.q, { ef: m === 'cheby1', headroom: m === 'cheby1' ? 1 : 0, coef: 16, sig: 16 }); window.__filterlab.rsim.input = 'impulse'; window.__filterlab.rsim.len = 64; }, method);
      await p.click('[data-tab=response]'); await p.click('[data-tab=quant]'); await p.wait(400);
      let st = await simState();
      console.log(`simulate hardware (${method}):`, st.cmp, '|', st.rows, 'rows');
      if (!/: 64 of 64 samples identical\.$/.test(st.cmp)) problems.push(`${method}: simulation comparison missing or not 64 of 64 (${st.cmp})`);
      if (!st.label.includes(SIMLABEL)) problems.push(`${method}: simulation panel missing its plain label`);
      if (st.rows < 4) problems.push(`${method}: waveform shows fewer than 4 signals`);
      await p.click('#rsimReset'); st = await simState();
      if (!/nothing simulated yet \(64 clocks to go\)/.test(st.cmp)) problems.push(`${method}: reset did not clear the run (${st.cmp})`);
      await p.click('#rsimStep'); await p.click('#rsimStep'); await p.click('#rsimStep'); st = await simState();
      if (!/3 of 3 samples identical so far \(clock 3 of 64\)/.test(st.cmp) || !/^Clock 2/.test(st.read)) problems.push(`${method}: stepping one clock at a time failed (${st.cmp} / ${st.read.slice(0, 20)})`);
      await p.click('#rsimRun');
      await p.evaluate(() => { const el = document.getElementById('rsimWave'); el.focus(); for (let i = 0; i < 5; i++) el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })); });
      st = await simState(); if (!/^Clock 58/.test(st.read)) problems.push(`${method}: arrow keys do not move the waveform cursor (${st.read.slice(0, 20)})`);
      const b = await p.box('#rsimWave'); await p.mouse('mouseMoved', b.x + b.width * 0.5, b.y + 30); st = await simState();
      if (!/^Clock [1-4][0-9] /.test(st.read) || !/out_data takes -?\d+; the bit-true model says -?\d+ identical/.test(st.read)) problems.push(`${method}: hover readout missing exact values (${JSON.stringify(st.read)})`);
      for (const [inp, len] of [['sine', 200], ['noise', 256], ['square', 16], ['step', 40]]) {
        await p.evaluate((i, l) => { const a = document.getElementById('rsimIn'); a.value = i; a.dispatchEvent(new Event('change')); const n = document.getElementById('rsimLen'); n.value = l; n.dispatchEvent(new Event('change')); }, inp, len);
        st = await simState(); if (!new RegExp(`: ${len} of ${len} samples identical\\.$`).test(st.cmp)) problems.push(`${method} ${inp} x${len}: ${st.cmp}`);
      }
      if (method === 'cheby1') await p.screenshot(path.join(SHOTS, 'rtlsim-iir.png'));
      await p.evaluate(() => { const rsim = window.__filterlab.rsim; rsim.run.model[5] += 1; document.getElementById('rsimRun').click(); });
      st = await simState(); console.log('forced mismatch:', st.cmp);
      if (!/: 39 of 40 samples identical\. First mismatch at clock 5: RTL out_data = -?\d+, model = -?\d+\.$/.test(st.cmp)) problems.push(`${method}: a mismatch is not reported with its first cycle and values (${st.cmp})`);
      await p.evaluate(() => { const rsim = window.__filterlab.rsim; rsim.run = null; rsim.input = 'impulse'; rsim.len = 64; });
    }

    // ---- interaction (auto/ui-interactive): every check drives the real page; a console error anywhere fails the sweep ----
    await p.goto(fileUrl('web/index.html')); await p.wait(500);
    await p.evaluate(() => { const s = window.__filterlab.state; Object.assign(s, { method: 'cheby1', btype: 'lowpass', fs: 8000, edges: [1000, 1500], rp: 1, rs: 60, orderMode: 'auto', tab: 'response' }); Object.assign(s.q, { coef: 16, sig: 16, ef: false, headroom: 0, overflow: 'saturate' }); });
    await p.click('[data-tab=time]'); await p.click('[data-tab=response]'); await p.wait(300);
    // a. linked cursor: hovering the magnitude plot shows the same frequency on phase and on the pole-zero plot
    { const b = await p.box('#cMag svg'); await p.mouse('mouseMoved', b.x + b.width * 0.75, b.y + b.height * 0.55); await p.wait(80);
      const lc = await p.evaluate(() => { const hz = id => (document.querySelector(id + ' .tip')?.textContent.match(/^([\d.]+) Hz/) || [])[1];
        return { mag: hz('#cMag'), ph: hz('#cPh'), pz: hz('#cPZ'), pzShown: document.querySelector('#cPZ .fcur')?.getAttribute('visibility') }; });
      console.log('linked cursor:', JSON.stringify(lc));
      if (!lc.mag || lc.mag !== lc.ph || lc.mag !== lc.pz || lc.pzShown !== 'visible') problems.push(`linked cursor: magnitude, phase and pole-zero disagree or are missing (${JSON.stringify(lc)})`);
      await p.evaluate(() => document.querySelector('#cPh svg').focus()); await p.press('ArrowLeft'); await p.press('ArrowLeft');
      const kb = await p.evaluate(() => [document.querySelector('#cMag .tip').hidden, document.querySelector('#cPh .tip').textContent.match(/^([\d.]+) Hz/)?.[1], document.querySelector('#cMag .tip').textContent.match(/^([\d.]+) Hz/)?.[1]]);
      if (kb[0] || !kb[1] || kb[1] !== kb[2]) problems.push(`linked cursor: arrow keys on a focused plot do not move the shared cursor (${JSON.stringify(kb)})`); }
    // b. scrub: the dragged slider survives, the previous trace is drawn faint, and release redraws the pole-zero plot
    await p.click('[data-tab=quant]'); await p.wait(300);
    { const sc = await p.evaluate(async () => { const el = document.getElementById('qCoef'), frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        for (const v of [14, 12, 10]) { el.value = v; el.dispatchEvent(new Event('input')); await frame(); }
        const out = { same: document.getElementById('qCoef') === el, ghost: document.querySelectorAll('#qMag path.trace.ghost').length, big: document.getElementById('qCoefBig').textContent.trim(), legend: document.querySelector('#qBody .legend').textContent };
        el.dispatchEvent(new Event('change')); await frame(); out.afterRelease = { same: document.getElementById('qCoef') === el, pz: !!document.querySelector('#qPZ svg') }; return out; });
      console.log('scrub:', JSON.stringify(sc));
      if (!sc.same || sc.ghost !== 1 || !/^10 bits/.test(sc.big) || !/Previous setting \(faint\)/.test(sc.legend) || !sc.afterRelease.same || !sc.afterRelease.pz) problems.push(`scrub: slider kept / faint previous trace / live readout / release redraw failed (${JSON.stringify(sc)})`); }
    // c. transitions: none at all under reduced motion (the headless default); all of them with motion allowed
    { await p.setMotion('reduce'); await p.evaluate(() => { window.__filterlab.state.rs = 55; document.querySelector('[data-tab=time]').click(); document.querySelector('[data-tab=response]').click(); });
      const still = await p.evaluate(() => document.getAnimations().length);
      await p.setMotion('no-preference'); await p.evaluate(() => { window.__filterlab.state.method = 'butter'; document.querySelector('[data-tab=time]').click(); document.querySelector('[data-tab=response]').click(); });
      const moving = await p.evaluate(() => document.getAnimations().map(a => a.effect.target.tagName.toLowerCase()));
      await p.wait(400); const settled = await p.evaluate(() => [...document.querySelectorAll('#view .score .val')].map(v => v.textContent.trim()));
      const exact = await p.evaluate(() => { const d = window.__filterlab.current; return [d.m.ripple, d.m.atten]; });
      console.log('motion: reduced', still, 'animations; allowed', JSON.stringify(moving), '; readouts after', JSON.stringify(settled));
      if (still !== 0) problems.push(`reduced motion still ran ${still} animation(s)`);
      if (!moving.includes('path') || !moving.includes('div')) problems.push(`transitions missing with motion allowed (${JSON.stringify(moving)})`);
      if (parseFloat(settled[0]) !== +exact[0].toFixed(3) || parseFloat(settled[1]) !== +exact[1].toFixed(1)) problems.push(`readouts did not settle on the exact values (${JSON.stringify(settled)} vs ${JSON.stringify(exact)})`);
      await p.setMotion('reduce'); }
    // d. keyboard: shortcuts and the help dialog, with real key presses
    { await p.evaluate(() => document.activeElement && document.activeElement.blur());
      await p.press('3'); await p.wait(250); const tab3 = await p.evaluate(() => window.__filterlab.state.tab);
      await p.evaluate(() => document.getElementById('rsimReset').click()); await p.evaluate(() => document.activeElement.blur()); await p.press('s'); await p.press('s');
      const cmp = await p.evaluate(() => document.getElementById('rsimCmp').textContent);
      const th0 = await p.evaluate(() => document.documentElement.dataset.theme); await p.press('t'); const th1 = await p.evaluate(() => document.documentElement.dataset.theme);
      await p.evaluate(() => document.getElementById('theme').value = 'light'); await p.evaluate(() => { const s = document.getElementById('theme'); s.dispatchEvent(new Event('change')); document.activeElement.blur(); });
      await p.press('?'); const helpOpen = await p.evaluate(() => document.getElementById('help').open); await p.press('Escape'); const helpClosed = !(await p.evaluate(() => document.getElementById('help').open));
      await p.evaluate(() => { const i = document.getElementById('sigF') || document.querySelector('#controls input[type=number]'); i.focus(); }); await p.press('2'); const typingSafe = await p.evaluate(() => window.__filterlab.state.tab);
      console.log('shortcuts:', JSON.stringify({ tab3, cmp, th0, th1, helpOpen, helpClosed, typingSafe }));
      if (tab3 !== 'quant') problems.push('shortcut 3 did not open the Quantization tab');
      if (!/2 of 2 samples identical so far/.test(cmp)) problems.push(`shortcut S did not step the simulator one clock at a time (${cmp})`);
      if (th0 === th1) problems.push('shortcut T did not change the theme');
      if (!helpOpen || !helpClosed) problems.push('? did not open the shortcuts dialog, or Escape did not close it');
      if (typingSafe !== 'quant') problems.push('a shortcut fired while typing in a field'); }
    // e. guided tour, keyboard only: G opens it, arrow keys walk it, Tab reaches Finish, Enter ends it and restores the design
    { await p.evaluate(() => { const s = window.__filterlab.state; Object.assign(s, { method: 'remez', rs: 55 }); document.querySelector('[data-tab=time]').click(); document.activeElement.blur(); });
      await p.press('g'); await p.wait(200);
      const t1 = await p.evaluate(() => ({ at: window.__filterlab.tourAt, focus: document.activeElement.id, method: window.__filterlab.state.method }));
      for (let i = 0; i < 5; i++) { await p.press('ArrowRight'); await p.wait(120); }
      const t6 = await p.evaluate(() => ({ at: window.__filterlab.tourAt, tab: window.__filterlab.state.tab, step: document.getElementById('tourStep').textContent, ring: getComputedStyle(document.querySelector('.tour-ring')).opacity }));
      await p.screenshot(path.join(SHOTS, 'tour-step6.png'), { fullPage: false });
      await p.press('Tab'); await p.press('Tab'); await p.press('Tab'); const onFinish = await p.evaluate(() => document.activeElement.id + ':' + document.activeElement.textContent);
      await p.press('Enter'); await p.wait(250);
      const end = await p.evaluate(() => ({ at: window.__filterlab.tourAt, hidden: document.getElementById('tour').hidden, method: window.__filterlab.state.method, rs: window.__filterlab.state.rs, tab: window.__filterlab.state.tab }));
      console.log('tour (keyboard only):', JSON.stringify({ t1, t6, onFinish, end }));
      if (t1.at !== 0 || t1.focus !== 'tourTitle' || t1.method !== 'cheby1') problems.push(`tour: G did not open step 1 with focus on its title (${JSON.stringify(t1)})`);
      if (t6.at !== 5 || t6.tab !== 'quant' || t6.step !== 'Step 6 of 6' || t6.ring !== '1') problems.push(`tour: arrow keys did not reach step 6 on the simulator (${JSON.stringify(t6)})`);
      if (onFinish !== 'tourNext:Finish') problems.push(`tour: Tab did not reach the Finish button (${onFinish})`);
      if (!end.hidden || end.at !== -1 || end.method !== 'remez' || end.rs !== 55 || end.tab !== 'time') problems.push(`tour: Finish did not close it and restore the design (${JSON.stringify(end)})`);
      const auto = await p.evaluate(() => { location.reload(); return true; }); await p.wait(600);
      if (!(await p.evaluate(() => document.getElementById('tour').hidden))) problems.push('tour: it opened on page load (it must never auto-play)'); }
    // f. spec sheet: valid SVG with dimension lines, the title block, and the same pass/fail wording as the app
    { await p.evaluate(() => { const s = window.__filterlab.state; Object.assign(s, { method: 'cheby1', btype: 'lowpass', fs: 8000, edges: [1000, 1500], rp: 1, rs: 60, orderMode: 'auto' }); document.querySelector('[data-tab=time]').click(); document.querySelector('[data-tab=response]').click(); });
      const ss = await p.evaluate(() => { const F = window.__filterlab, d = F.current, svg = F.specSheetSvg(d, F.state), doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
        const okWord = (ok) => ok ? '✓ meets' : '✕ misses';
        return { xml: !doc.querySelector('parsererror'), dims: doc.querySelectorAll('line.dim').length, texts: doc.documentElement.textContent, rip: String(+d.m.ripple.toFixed(3)), att: String(+d.m.atten.toFixed(1)), want: [okWord(d.passRipple), okWord(d.stopOk)], button: !!document.getElementById('specSheet') }; });
      const has = t => ss.texts.includes(t);
      console.log('spec sheet:', JSON.stringify({ xml: ss.xml, dims: ss.dims, ripple: ss.rip, atten: ss.att, button: ss.button }));
      if (!ss.xml || ss.dims < 4 || !ss.button) problems.push('spec sheet: not valid SVG, too few dimension lines, or no download button');
      if (!has(`passband ripple ${ss.rip} dB`) || !has(`attenuation ${ss.att} dB`) || !has('Target 1 dB or less') || !has('Target 60 dB or more') || !ss.want.every(has)) problems.push('spec sheet: measured values or the pass/fail wording do not match the app');
      if (!has("Measured by Filterlab's spec check")) problems.push('spec sheet: missing its provenance line'); }

    // Signal tab: test tones render with a finite fixed-point SNR; a WAV loads through the file input; a bad file says why
    await p.evaluate(() => { const s = window.__filterlab.state; Object.assign(s, { method: 'remez', btype: 'lowpass', fs: 8000, edges: [1000, 1500], rp: 1, rs: 60, orderMode: 'auto' }); Object.assign(s.q, { coef: 16, sig: 16, ef: false, headroom: 0, overflow: 'saturate' }); });
    await p.click('[data-tab=signal]'); await p.wait(600);
    const snr = await p.evaluate(() => { const b = [...document.querySelectorAll('.caption b')].find(x => /dB/.test(x.textContent)); return b ? parseFloat(b.textContent) : NaN; });
    console.log('signal tab, test tones: fixed vs float SNR', snr, 'dB');
    if (!(snr > 40)) problems.push(`signal tab SNR missing or implausible (${snr})`);
    await p.screenshot(path.join(SHOTS, 'signal-tones.png'));
    const load = (bytes, name) => p.evaluate((b, n) => { const inp = document.getElementById('wavIn'), dt = new DataTransfer(); dt.items.add(new File([new Uint8Array(b)], n, { type: 'audio/wav' })); inp.files = dt.files; inp.dispatchEvent(new Event('change')); }, bytes, name);
    const mkWav = (fs, frames) => { const b = Buffer.alloc(44 + frames * 2); b.write('RIFF', 0); b.writeUInt32LE(36 + frames * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(fs, 24); b.writeUInt32LE(fs * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(frames * 2, 40); for (let i = 0; i < frames; i++) b.writeInt16LE(Math.round(12000 * Math.sin(2 * Math.PI * 440 * i / fs) + 6000 * Math.sin(2 * Math.PI * 5000 * i / fs)), 44 + 2 * i); return Array.from(b); };
    await load(mkWav(16000, 16000), 'tone.wav'); await p.wait(800);
    const w = await p.evaluate(() => ({ fs: window.__filterlab.state.fs, info: document.getElementById('srcInfo').textContent, err: document.querySelector('[role=alert]')?.textContent || '' }));
    console.log('WAV upload:', JSON.stringify(w));
    if (w.fs !== 16000 || !/PCM 16-bit/.test(w.info) || w.err) problems.push('a valid 16-bit WAV did not load through the file input');
    await p.screenshot(path.join(SHOTS, 'signal-wav.png'));
    await load(Array.from(Buffer.from('definitely not a wav file')), 'notes.txt'); await p.wait(400);
    const bad = await p.evaluate(() => document.querySelector('[role=alert]')?.textContent || '');
    console.log('bad file message:', bad);
    if (!/Could not read notes\.txt\. This is not a WAV file/.test(bad)) problems.push('a non-WAV file did not produce a clear error');
    await p.evaluate(() => { window.__filterlab.sig.source = 'tones'; window.__filterlab.sig.error = ''; window.__filterlab.state.fs = 8000; window.__filterlab.state.edges = [1000, 1500]; });
    await p.click('[data-tab=response]');
  } catch (e) {
    problems.push('script error: ' + e.message);
  } finally {
    problems.push(...p.errors);
    await close();
  }
  console.log(problems.length ? `\nUI SWEEP FAILED (${problems.length}):\n  ` + problems.join('\n  ') : '\nui sweep passed, no console errors');
  process.exit(problems.length ? 1 : 0);
})().catch(e => { console.error(e.message); process.exit(1); });
