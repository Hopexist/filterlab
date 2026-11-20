// Zero-dependency headless Edge/Chrome driver over the DevTools protocol (Node >= 22: global WebSocket).
// Exposes only what tests/ui_sweep.js and tests/ui_shots.js need.
const fs = require('fs'), os = require('os'), path = require('path'), url = require('url');
const { spawn } = require('child_process');

const CANDIDATES = {
  win32: [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
  ],
  darwin: [
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ],
  linux: ['/usr/bin/microsoft-edge', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium'],
};

function findBrowser() {
  for (const v of ['EDGE_PATH', 'CHROME_PATH']) {
    const p = process.env[v];
    if (p) { if (fs.existsSync(p)) return p; throw new Error(`${v} is set to "${p}", but no file exists there. Fix the path or unset it.`); }
  }
  const list = CANDIDATES[process.platform] || CANDIDATES.linux;
  const hit = list.find(p => p && fs.existsSync(p));
  if (hit) return hit;
  throw new Error('No Edge or Chrome found. Install one, or set EDGE_PATH or CHROME_PATH to the browser executable. Looked in:\n  ' + list.join('\n  '));
}

const fileUrl = rel => url.pathToFileURL(path.resolve(__dirname, '..', rel)).href;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function launch({ width = 1440, height = 1000 } = {}) {
  const exe = findBrowser();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'filterlab-cdp-'));
  const child = spawn(exe, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${dir}`, '--no-first-run',
    '--no-default-browser-check', '--disable-extensions', '--hide-scrollbars', '--force-color-profile=srgb', 'about:blank'], { stdio: 'ignore' });
  const kill = () => { try { child.kill(); } catch (_) { /* already gone */ } };
  process.on('exit', kill);
  const cleanupDir = async () => { for (let i = 0; i < 10; i++) { try { fs.rmSync(dir, { recursive: true, force: true }); return; } catch (_) { await sleep(100); } } };
  const fail = async err => { process.off('exit', kill); kill(); await cleanupDir(); throw err; };

  // DevToolsActivePort: line 1 = port, line 2 = browser websocket path
  const portFile = path.join(dir, 'DevToolsActivePort'); let wsUrl = null;
  // the Windows launcher process may exit 0 at once and hand off to the real browser, so only the file counts
  for (let i = 0; i < 300 && !wsUrl; i++) {
    try { const [port, p] = fs.readFileSync(portFile, 'utf8').trim().split('\n'); if (port && p) wsUrl = `ws://127.0.0.1:${port}${p}`; } catch (_) { /* not written yet */ }
    if (!wsUrl) await sleep(50);   // also when the file exists but is still half-written
  }
  if (!wsUrl) return fail(new Error(`Browser did not open a DevTools port within 15 s (${exe}). Set EDGE_PATH or CHROME_PATH to a working Edge/Chrome.`));

  const ws = new WebSocket(wsUrl);
  try { await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('Could not connect to the browser DevTools socket.')); }); }
  catch (e) { return fail(e); }
  let nextId = 1, closed = false; const pending = new Map(), listeners = [];
  ws.onclose = () => { closed = true; for (const { rej } of pending.values()) rej(new Error('The browser closed the DevTools connection (did it crash?).')); pending.clear(); };
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); }
    else for (const l of listeners) l(m);
  };
  const send = (method, params = {}, sessionId, ms = 30000) => new Promise((res, rej) => {
    if (closed) return rej(new Error('The DevTools connection is closed.'));
    const id = nextId++, t = setTimeout(() => { pending.delete(id); rej(new Error(`DevTools call ${method} timed out after ${ms / 1000} s`)); }, ms);
    pending.set(id, { res: v => { clearTimeout(t); res(v); }, rej: e => { clearTimeout(t); rej(e); } });
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });
  const waitFor = (sid, method, ms = 15000) => new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(`timeout waiting for ${method}`)), ms);
    const l = m => { if (m.sessionId === sid && m.method === method) { clearTimeout(t); listeners.splice(listeners.indexOf(l), 1); res(m.params); } };
    listeners.push(l);
  });

  let sid;
  try {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    ({ sessionId: sid } = await send('Target.attachToTarget', { targetId, flatten: true }));
  } catch (e) { try { ws.close(); } catch (_) { /* ignore */ } return fail(e); }
  const s = (m, p) => send(m, p, sid);
  const errors = [];
  listeners.push(m => {
    if (m.sessionId !== sid) return;
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push('console: ' + m.params.args.map(a => a.value ?? a.description).join(' '));
    if (m.method === 'Runtime.exceptionThrown') { const d = m.params.exceptionDetails; errors.push('page error: ' + (d.exception?.description || d.text)); }
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errors.push('log: ' + m.params.entry.text);
  });
  await Promise.all([s('Page.enable'), s('Runtime.enable'), s('Log.enable')]);

  const page = {
    errors,
    wait: sleep,
    async setViewport(w, h) { await s('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false }); },
    async setScheme(scheme) { await s('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] }); },
    async press(key, { shift = false } = {}) {   // a real key press through the DevTools input pipeline (keyDown + keyUp)
      const codes = { Enter: 13, Escape: 27, Tab: 9, ArrowLeft: 37, ArrowRight: 39, ' ': 32, '?': 191 }, vk = codes[key] || key.toUpperCase().charCodeAt(0);
      const text = key === 'Enter' ? String.fromCharCode(13) : key.length === 1 ? key : undefined, base = { key, windowsVirtualKeyCode: vk, modifiers: shift ? 8 : 0 };
      await s('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', text, ...base }); await s('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
    },
    async setMotion(value) { await s('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value }] }); },   // 'reduce' or 'no-preference'
    async goto(u) { const load = waitFor(sid, 'Page.loadEventFired'); await s('Page.navigate', { url: u }); await load; },
    async evaluate(fn, ...args) {
      const expression = typeof fn === 'function' ? `(${fn})(...${JSON.stringify(args)})` : fn;
      const r = await s('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error('evaluate failed: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
      return r.result.value;
    },
    async box(selector) {
      const b = await page.evaluate(sel => {
        const el = document.querySelector(sel); if (!el) return null;
        el.scrollIntoView({ block: 'center', inline: 'center' }); const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      }, selector);
      if (!b) throw new Error(`no element matches ${selector}`);
      return b;
    },
    async mouse(type, x, y) { await s('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 }); },
    async click(selector) {
      const b = await page.box(selector), x = b.x + b.width / 2, y = b.y + b.height / 2;
      await page.mouse('mouseMoved', x, y); await page.mouse('mousePressed', x, y); await page.mouse('mouseReleased', x, y);
    },
    async drag(x0, y0, x1, y1, steps = 6) {
      await page.mouse('mouseMoved', x0, y0); await page.mouse('mousePressed', x0, y0);
      for (let i = 1; i <= steps; i++) await page.mouse('mouseMoved', x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps);
      await page.mouse('mouseReleased', x1, y1);
    },
    async screenshot(file, { fullPage = true } = {}) {
      const { cssContentSize: c } = await s('Page.getLayoutMetrics');
      const { data } = await s('Page.captureScreenshot', fullPage
        ? { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: Math.ceil(c.width), height: Math.ceil(c.height), scale: 1 } }
        : { format: 'png' });
      fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, Buffer.from(data, 'base64'));
    },
  };
  await page.setViewport(width, height);

  async function close() {
    try { await send('Browser.close', {}, undefined, 2000); } catch (_) { /* socket may already be closed */ }
    try { ws.close(); } catch (_) { /* ignore */ }
    for (let i = 0; i < 40 && child.exitCode === null; i++) await sleep(50);
    kill(); process.off('exit', kill);
    await cleanupDir();
  }
  return { page, close };
}

module.exports = { launch, findBrowser, fileUrl };
