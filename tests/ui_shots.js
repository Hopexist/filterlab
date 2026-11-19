const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const errs = [];
  for (const scheme of ['light', 'dark']) {
    const p = await b.newPage({ viewport: { width: 1440, height: 1000 }, colorScheme: scheme });
    p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); p.on('pageerror', e => errs.push('PAGEERR ' + e.message));
    await p.goto('file://' + process.cwd() + '/web/index.html'); await p.waitForTimeout(1400);
    await p.screenshot({ path: `shots/${scheme}-response.png`, fullPage: true });
    if (scheme === 'light') {
      await p.click('[data-tab=time]'); await p.waitForTimeout(300); await p.screenshot({ path: 'shots/light-time.png', fullPage: true });
      await p.click('[data-tab=quant]'); await p.waitForTimeout(500); await p.screenshot({ path: 'shots/light-quant.png', fullPage: true });
    }
    await p.close();
  }
  await b.close(); console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'no console errors');
})();
