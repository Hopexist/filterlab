// Landing page (docs/index.html) and the deep links into the app (docs/app/). Exits 1 on any problem or console error.
const { launch } = require('./browser');
const path = require('path'), url = require('url'), fs = require('fs');
const DOCS = path.resolve(__dirname, '..', 'docs'), page = f => url.pathToFileURL(path.join(DOCS, f)).href;

(async () => {
  const { page: p, close } = await launch(); const problems = [];
  try {
    for (const [w, h] of [[1440, 900], [390, 844]]) {
      await p.setViewport(w, h); await p.setMotion('reduce'); await p.goto(page('index.html')); await p.wait(500);
      const r = await p.evaluate(async () => {
        document.querySelectorAll('img[loading=lazy]').forEach(i => i.removeAttribute('loading'));   // load everything, then check it all arrived
        await Promise.all([...document.images].map(i => i.complete ? 0 : new Promise(res => { i.onload = i.onerror = res; })));
        return { over: document.documentElement.scrollWidth - innerWidth, broken: [...document.images].filter(i => !i.naturalWidth).map(i => i.getAttribute('src')),
          anchors: [...document.querySelectorAll('a[href^="#"]')].map(a => a.getAttribute('href')).filter(h => h.length > 1 && !document.querySelector(h)),
          running: document.getAnimations().filter(a => a.playState === 'running').length, playing: document.getElementById('play').getAttribute('aria-pressed') };
      });
      if (r.over > 0) problems.push(`landing scrolls sideways by ${r.over} px at ${w} px`);
      if (r.broken.length) problems.push(`landing images failed to load: ${r.broken.join(', ')}`);
      if (r.anchors.length) problems.push(`landing links to missing sections: ${r.anchors.join(', ')}`);
      if (r.running || r.playing !== 'false') problems.push(`with reduced motion the landing still animates (${r.running} running, demo playing ${r.playing})`);
    }
    // demo stage: the step buttons switch the screen and the caption; Play toggles to Pause
    const st = await p.evaluate(async () => { const dots = [...document.querySelectorAll('.dots button')], out = [];
      for (const k of [2, 3, 0]) { dots[k].click(); await new Promise(r => setTimeout(r, 250)); out.push([[...document.querySelectorAll('.scene')].findIndex(s => s.classList.contains('on')), document.querySelector('.chip b').textContent]); }
      document.getElementById('play').click(); const label = document.getElementById('play').textContent; document.getElementById('play').click(); return { out, label }; });
    if (JSON.stringify(st.out) !== JSON.stringify([[2, '3 · Export'], [3, '4 · Simulate'], [0, '1 · Design']]) || st.label !== 'Pause') problems.push(`demo stage controls misbehave (${JSON.stringify(st)})`);
    // theme gallery: one link per app theme, each with a thumbnail on disk; a deep link opens the app in that theme and tab
    const gal = await p.evaluate(() => [...document.querySelectorAll('#gallery a')].map(a => new URL(a.href).searchParams.get('theme')));
    await p.goto(page('app/index.html')); await p.wait(400);
    const appThemes = await p.evaluate(() => [...document.getElementById('theme').options].map(o => o.value));
    if (JSON.stringify([...gal].sort()) !== JSON.stringify([...appThemes].sort())) problems.push(`gallery themes ${gal.join(',')} do not match the app's ${appThemes.join(',')}`);
    for (const t of gal) if (!fs.existsSync(path.join(DOCS, 'assets', `theme-${t}.jpg`))) problems.push(`missing thumbnail docs/assets/theme-${t}.jpg`);
    await p.goto(page('app/index.html') + '?theme=synthwave&tab=quant'); await p.wait(600);
    const deep = await p.evaluate(() => [document.documentElement.dataset.theme, window.__filterlab.state.tab, !!document.getElementById('qctlCard')]);
    if (deep.join() !== 'synthwave,quant,true') problems.push(`deep link ?theme=synthwave&tab=quant gave ${deep.join()}`);
    console.log('landing: 1440 and 390 px, images, anchors, reduced motion, demo controls, gallery', gal.length, 'themes, deep link', deep.join());
  } catch (e) { problems.push('script error: ' + e.message); } finally { problems.push(...p.errors); await close(); }
  console.log(problems.length ? `\nSITE CHECK FAILED (${problems.length}):\n  ` + problems.join('\n  ') : 'site check passed, no console errors');
  process.exit(problems.length ? 1 : 0);
})().catch(e => { console.error(e.message); process.exit(1); });
