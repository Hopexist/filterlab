/* filterlab UI. Depends on window.DSP (dsp.js). */
(() => {
'use strict';
const D = window.DSP;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/* ================= state ================= */
const METHODS = {
  remez: { name: 'Equiripple FIR', note: 'Parks–McClellan: smallest filter for a given spec', kind: 'fir' },
  window: { name: 'Windowed FIR', note: 'Ideal response times a window', kind: 'fir' },
  butter: { name: 'Butterworth', note: 'IIR, flat passband, gentle roll-off', kind: 'iir' },
  cheby1: { name: 'Chebyshev I', note: 'IIR, ripple in the passband', kind: 'iir' },
  cheby2: { name: 'Chebyshev II', note: 'IIR, ripple in the stopband', kind: 'iir' },
  ellip: { name: 'Elliptic', note: 'IIR, ripple in both bands, steepest roll-off', kind: 'iir' },
};
const BTYPES = { lowpass: 'Low-pass', highpass: 'High-pass', bandpass: 'Band-pass', bandstop: 'Band-stop' };
const LABELS = {
  lowpass: ['Passband ends', 'Stopband starts'], highpass: ['Stopband ends', 'Passband starts'],
  bandpass: ['Lower stopband ends', 'Passband starts', 'Passband ends', 'Upper stopband starts'],
  bandstop: ['Lower passband ends', 'Stopband starts', 'Stopband ends', 'Upper passband starts'],
};
const ROLES = { lowpass: 'PS', highpass: 'SP', bandpass: 'SPPS', bandstop: 'PSSP' };
const WINDOWS = { kaiser: 'Kaiser (set by attenuation)', blackman: 'Blackman', hamming: 'Hamming', hann: 'Hann', rect: 'Rectangular' };
const WIN_FACTOR = { rect: 0.9, hann: 3.1, hamming: 3.3, blackman: 5.5 };
const WIN_CAP = { rect: 21, hann: 44, hamming: 53, blackman: 74 };
const defaultEdges = (bt, fs) => ({ lowpass: [0.125, 0.1875], highpass: [0.125, 0.1875], bandpass: [0.0625, 0.125, 0.25, 0.3125], bandstop: [0.0625, 0.125, 0.25, 0.3125] }[bt].map(r => Math.round(r * fs)));

const state = {
  method: 'remez', btype: 'lowpass', fs: 8000, edges: defaultEdges('lowpass', 8000), rp: 1, rs: 60, win: 'kaiser',
  orderMode: 'auto', order: 41, tab: 'response', zoom: 'full', phase: 'phase',
  q: { coef: 12, sig: 16, round: 'nearest', struct: 'sos', overflow: 'saturate', headroom: 0, ef: false },
};
let pinB = null, respGhost = null, respScrub = false;   // respGhost: the magnitude before the latest order scrub
let rtlForm = 'direct';   // FIR export structure
const sig = { source: 'tones', wav: null, name: '', error: '', vol: 0, loads: 0 };   // Signal tab: source, loaded WAV, volume (starts muted)
let audio = { ctx: null, src: null }, sigMemo = { key: '', out: null };   // compare mode: a snapshot of the magnitude response of a pinned design
let drawn = false, current = null, focusKey = null, renderQueued = false, fastMode = false;

/* ================= spec helpers ================= */
function bandsOf(bt, e, nyq) {
  const B = (lo, hi, type) => ({ lo, hi, type });
  if (bt === 'lowpass') return [B(0, e[0], 'pass'), B(e[1], nyq, 'stop')];
  if (bt === 'highpass') return [B(0, e[0], 'stop'), B(e[1], nyq, 'pass')];
  if (bt === 'bandpass') return [B(0, e[0], 'stop'), B(e[1], e[2], 'pass'), B(e[3], nyq, 'stop')];
  return [B(0, e[0], 'pass'), B(e[1], e[2], 'stop'), B(e[3], nyq, 'pass')];
}
function splitEdges(bt, e) {
  if (bt === 'lowpass') return { pass: [e[0]], stop: [e[1]] };
  if (bt === 'highpass') return { stop: [e[0]], pass: [e[1]] };
  if (bt === 'bandpass') return { stop: [e[0], e[3]], pass: [e[1], e[2]] };
  return { pass: [e[0], e[3]], stop: [e[1], e[2]] };
}
const transWidth = (bt, e) => bt === 'lowpass' || bt === 'highpass' ? e[1] - e[0] : Math.min(e[1] - e[0], e[3] - e[2]);

/* ================= design ================= */
const memo = new Map();
const lazyRoots = (obj, key, poly) => { let v; Object.defineProperty(obj, key, { configurable: true, enumerable: true, get: () => v || (v = D.polyRoots(poly)) }); };   // same roots, computed on first use (they cost ~1 s at 256 taps)
function designFilter(st, fast) {
  const key = JSON.stringify([st.method, st.btype, st.fs, st.edges, st.rp, st.rs, st.win, st.orderMode, st.orderMode === 'manual' ? st.order : 0, fast]);
  if (memo.has(key)) return memo.get(key);
  const out = buildDesign(st, fast);
  memo.set(key, out); if (memo.size > 40) memo.delete(memo.keys().next().value);
  return out;
}
function buildDesign(st, fast) {
  const nyq = st.fs / 2, e = st.edges, bands = bandsOf(st.btype, e, nyq), M = METHODS[st.method], notes = [];
  const dp = (Math.pow(10, st.rp / 20) - 1) / (Math.pow(10, st.rp / 20) + 1), ds = Math.pow(10, -st.rs / 20);
  const sp = splitEdges(st.btype, e), df = transWidth(st.btype, e) / st.fs;
  const out = { method: st.method, kind: M.kind, bands, notes, nyq };
  if (st.method === 'remez') {
    const flat = [0, ...e, nyq];
    let desired, wts;
    if (st.btype === 'lowpass') { desired = [1, 0]; wts = [1 / dp, 1 / ds]; }
    else if (st.btype === 'highpass') { desired = [0, 1]; wts = [1 / ds, 1 / dp]; }
    else if (st.btype === 'bandpass') { desired = [0, 1, 0]; wts = [1 / ds, 1 / dp, 1 / ds]; }
    else { desired = [1, 0, 1]; wts = [1 / dp, 1 / ds, 1 / dp]; }
    const run = n => { const r = D.remez(n, flat, desired, wts, st.fs); const resp = D.freqz(r.h, null, 2048, st.fs); return { r, resp, m: D.measure(resp, bands) }; };
    const ok = m => m.ripple <= st.rp * 1.0005 + 1e-6 && m.atten >= st.rs - 0.01;
    let est = Math.ceil((-10 * Math.log10(dp * ds) - 13) / (14.6 * df)) + 1; est = clamp(est | 1, 7, 801);
    let n, res;
    const evenOk = st.btype === 'lowpass' || st.btype === 'bandpass';   // type II has a forced zero at fs/2
    if (st.orderMode === 'manual') {
      n = clamp(Math.round(st.order), 4, 801);
      if (n % 2 === 0 && !evenOk) { n += 1; notes.push(`An even-length linear-phase FIR always has zero gain at fs/2, so a ${BTYPES[st.btype].toLowerCase()} needs an odd length. Using ${n} taps.`); }
      res = run(n);
    }
    else if (fast) { n = est; res = run(n); }
    else {
      n = est; res = run(n);
      if (ok(res.m)) { for (let i = 0; i < 12 && n > 7; i++) { const t = run(n - 2); if (ok(t.m)) { n -= 2; res = t; } else break; } }
      else { for (let i = 0; i < 70 && n < 801; i++) { n += 2; res = run(n); if (ok(res.m)) break; } if (!ok(res.m)) notes.push('No filter up to 801 taps meets this spec. Widen the transition band or relax the targets.'); }
      if (evenOk && ok(res.m)) { const t = run(n - 1); if (ok(t.m)) { n -= 1; res = t; } }   // one tap fewer as type II, if it still meets spec
    }
    Object.assign(out, { h: Array.from(res.r.h), taps: n, resp: res.resp, title: `Equiripple FIR, ${n} taps`, size: `${n} taps` });
  } else if (st.method === 'window') {
    const cuts = st.btype === 'lowpass' || st.btype === 'highpass' ? [(e[0] + e[1]) / 2] : [(e[0] + e[1]) / 2, (e[2] + e[3]) / 2];
    let n, beta = 8.6; const tw = transWidth(st.btype, e);
    if (st.win === 'kaiser') { const kp = D.kaiserParams(st.rs, tw, st.fs); n = kp.numtaps; beta = kp.beta; } else n = Math.ceil(WIN_FACTOR[st.win] * st.fs / tw) | 1;
    n = clamp(st.orderMode === 'manual' ? st.order : n, 5, 1201);
    const build = nn => { const hh = D.firWindow(nn, cuts, st.btype, st.win, st.fs, beta); const rr = D.freqz(hh, null, 2048, st.fs); return { hh, rr, mm: D.measure(rr, bands) }; };
    const meets = mm => mm.ripple <= st.rp * 1.0005 + 1e-6 && mm.atten >= st.rs - 0.01;
    let t = build(n);
    // Kaiser's formula is an estimate: in auto mode, add taps until the measured response meets the spec
    const reachable = st.win === 'kaiser' || st.rs <= WIN_CAP[st.win];
    if (st.orderMode === 'auto' && !fast && reachable) for (let i = 0; i < 40 && !meets(t.mm); i++) { n += 2; t = build(n); }
    const h = t.hh, nn = h.length, resp = t.rr;
    Object.assign(out, { h: Array.from(h), taps: nn, resp, beta, title: `${WINDOWS[st.win].split(' (')[0]} window FIR, ${nn} taps`, size: `${nn} taps` });
    if (st.win !== 'kaiser' && st.rs > WIN_CAP[st.win]) notes.push(`A ${WINDOWS[st.win]} window can't give more than about ${WIN_CAP[st.win]} dB of stopband attenuation, however many taps you use. Choose Kaiser or Blackman for ${st.rs} dB.`);
  } else {
    const pe = sp.pass, se = sp.stop; let n;
    if (st.orderMode === 'manual') n = clamp(st.order, 1, 24);
    else { n = D.minOrder(st.method, st.btype, pe, se, st.rp, st.rs, st.fs); if (n > 24) { notes.push(`Minimum order is ${n}; capped at 24. Widen the transition band for a practical IIR.`); n = 24; } }
    const edges = st.method === 'cheby2' ? se : pe;
    const scale = st.method === 'butter' ? Math.pow(Math.pow(10, st.rp / 10) - 1, -1 / (2 * n)) : 1;
    const d = D.designIIR(st.method, st.btype, n, edges, st.fs, st.rp, st.rs, scale);
    const resp = D.sosFreqz(d.sos, 2048, st.fs);
    Object.assign(out, { sos: d.sos, b: d.b, a: d.a, zeros: d.z, poles: d.p, order: n, resp, title: `${M.name}, order ${d.a.length - 1}`, size: `order ${d.a.length - 1}, ${d.sos.length} biquad${d.sos.length > 1 ? 's' : ''}` });
  }
  if (out.kind === 'fir') {
    lazyRoots(out, 'zeros', out.h); out.poleOrigin = out.h.length - 1; out.poles = [];
    out.gd = D.groupDelay(out.h, null, 1024, st.fs);
  } else {
    out.poleOrigin = 0; out.gd = D.sosGroupDelay(out.sos, 1024, st.fs);
  }
  out.m = D.measure(out.resp, bands);
  out.passRipple = out.m.ripple <= st.rp * 1.0005 + 1e-6; out.stopOk = out.m.atten >= st.rs - 0.01;
  return out;
}

/* ================= charts ================= */
function niceTicks(lo, hi, target) {
  const raw = (hi - lo) / target, mag = Math.pow(10, Math.floor(Math.log10(raw))), nn = raw / mag;
  const step = (nn < 1.5 ? 1 : nn < 3 ? 2 : nn < 7 ? 5 : 10) * mag, t = [];
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + 1e-9; v += step) t.push(+v.toFixed(10));
  return t;
}
const fmtHz = f => Math.abs(f) >= 1000 ? (f / 1000).toFixed(Math.abs(f) % 1000 === 0 ? 0 : 2).replace(/0$/, '') + 'k' : String(Math.round(f * 10) / 10);
const unitSplit = t => { const m = /^(-?[\d.]+(?:e[-+]?\d+)?) (.+)$/i.exec(String(t)); return m ? `${m[1]} <span class="u">${m[2]}</span>` : /^-?[\d.]/.test(String(t)) ? String(t) : `<span class="txt">${t}</span>`; };   // display only: '0.826 dB' -> big number, small unit
const fmtN = (v, d = 2) => Number.isFinite(v) ? (Math.round(v * Math.pow(10, d)) / Math.pow(10, d)).toString() : '—';
let uid = 0;
const SERIES_COLORS = ['var(--s1)', 'var(--s2)', 'var(--ink-3)'];

/* linked cursor: charts in one group follow a shared frequency (hover or arrow keys on any of them) */
const links = {}, perf = { link: [], scrub: [], order: [] };
function linkRegister(g, id, h) { (links[g] = links[g] || new Map()).set(id, h); }
function linkCursor(g, from, xv) {
  const t0 = performance.now();
  for (const [id, h] of links[g] || []) { if (id === from) continue; if (!document.getElementById(id)) { links[g].delete(id); continue; } if (xv == null) h.hide(); else h.show(xv); }
  perf.link.push(performance.now() - t0); if (perf.link.length > 400) perf.link.shift();
}
/* transitions between designs: only after a user action, under 250 ms, ease-out, none with reduced motion, none while dragging or scrubbing */
const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const morphCache = new Map();
function morphPath(key, path) {   // WAAPI on the SVG `d` property when the command structure matches; otherwise just jump
  const prev = morphCache.get(key), next = path.getAttribute('d'); morphCache.set(key, next);
  if (!prev || prev === next || calm() || fastMode || respScrub || qScrubRaf || typeof path.animate !== 'function') return;
  if (prev.replace(/[^ML]/g, '') !== next.replace(/[^ML]/g, '')) return;
  try { path.animate([{ d: `path("${prev}")` }, { d: `path("${next}")` }], { duration: 220, easing: 'cubic-bezier(.2, .7, .3, 1)' }); } catch (e) { /* d not animatable here: no transition */ }
}
const countCache = new Map();
function countReadouts(root) {   // readouts tween from their last shown value to the exact new text, which is what stays
  if (!root) return;
  root.querySelectorAll('.score .row').forEach(row => {
    const lab = row.querySelector('.lab')?.textContent, val = row.querySelector('.val'); if (!lab || !val) return;
    const node = val.firstChild; if (!node || node.nodeType !== 3) return;
    const txt = node.textContent.trim(), to = parseFloat(txt), key = (root.id || '') + lab, from = countCache.get(key); countCache.set(key, to);
    if (!/^-?\d+(\.\d+)?$/.test(txt) || from === undefined || from === to || !Number.isFinite(from) || calm() || fastMode || respScrub || qScrubRaf) return;
    const dec = (txt.split('.')[1] || '').length, t0 = performance.now(), end = node.textContent;
    const step = now => { const k = Math.min((now - t0) / 220, 1), e = 1 - Math.pow(1 - k, 3);
      node.textContent = k < 1 ? (from + (to - from) * e).toFixed(dec) + ' ' : end; if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  });
}
function lineChart(el, cfg) {
  const W = Math.max(el.clientWidth || 520, 240), H = cfg.height || 260;
  const m = { l: cfg.ml || 62, r: 14, t: 22, b: cfg.xLabel ? 40 : 24 };
  const [x0, x1] = cfg.xd, [y0, y1] = cfg.yd, iw = W - m.l - m.r, ih = H - m.t - m.b;
  const sx = x => m.l + (x - x0) / (x1 - x0) * iw, sy = y => m.t + (1 - (y - y0) / (y1 - y0)) * ih, id = 'c' + (++uid);
  const xt = cfg.xticks || niceTicks(x0, x1, Math.max(3, Math.floor(iw / 80))), yt = niceTicks(y0, y1, Math.max(3, Math.floor(ih / 44)));
  let s = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(cfg.label)}"><defs><clipPath id="${id}"><rect x="${m.l}" y="${m.t}" width="${iw}" height="${ih}"/></clipPath></defs>`;
  const mid = t => t.slice(1).map((v, i) => (v + t[i]) / 2);   // minor graticule halfway between major ticks
  s += `<rect class="screen" x="${m.l}" y="${m.t}" width="${iw}" height="${ih}"/>`;
  s += '<g class="grid minor">' + mid(yt).map(v => `<line x1="${m.l}" x2="${W - m.r}" y1="${sy(v)}" y2="${sy(v)}"/>`).join('') + mid(xt).map(v => `<line y1="${m.t}" y2="${H - m.b}" x1="${sx(v)}" x2="${sx(v)}"/>`).join('') + '</g>';
  s += '<g class="grid">' + yt.map(v => `<line x1="${m.l}" x2="${W - m.r}" y1="${sy(v)}" y2="${sy(v)}"/>`).join('') + xt.map(v => `<line y1="${m.t}" y2="${H - m.b}" x1="${sx(v)}" x2="${sx(v)}"/>`).join('') + '</g>';
  s += `<g clip-path="url(#${id})">`;
  for (const sh of cfg.shades || []) { const ya = sy(clamp(sh.y0, y0, y1)), yb = sy(clamp(sh.y1, y0, y1)); s += `<rect class="shade" x="${sx(sh.x0)}" y="${Math.min(ya, yb)}" width="${Math.max(sx(sh.x1) - sx(sh.x0), 0)}" height="${Math.abs(yb - ya)}"/><line class="shade-edge" x1="${sx(sh.x0)}" x2="${sx(sh.x1)}" y1="${sy(sh.edge)}" y2="${sy(sh.edge)}"/>`; }
  for (const hl of cfg.hlines || []) s += `<line x1="${m.l}" x2="${W - m.r}" y1="${sy(hl.y)}" y2="${sy(hl.y)}" stroke="var(--ink-3)" stroke-dasharray="2 4"/>`;
  cfg.series.forEach((se, k) => {
    const col = se.color || SERIES_COLORS[k];
    if (se.type === 'stem') {
      s += se.x.map((xv, i) => `<line x1="${sx(xv)}" x2="${sx(xv)}" y1="${sy(0)}" y2="${sy(se.y[i])}" stroke="${col}" stroke-width="1.5"/>`).join('');
      if (se.x.length <= 140) s += se.x.map((xv, i) => `<circle cx="${sx(xv)}" cy="${sy(se.y[i])}" r="3" fill="${col}" stroke="var(--panel)" stroke-width="1.5"/>`).join('');
    } else {
      let d = '', pen = false;
      for (let i = 0; i < se.x.length; i++) { const yv = se.y[i]; if (!Number.isFinite(yv)) { pen = false; continue; } d += (pen ? 'L' : 'M') + sx(se.x[i]).toFixed(1) + ' ' + sy(yv).toFixed(1); pen = true; }
      s += `<path class="trace${se.ghost ? ' ghost' : ''}" d="${d}" stroke="${col}" ${se.dash ? 'stroke-dasharray="6 4"' : ''} style="color:${col}${se.w ? `;stroke-width:${se.w}` : ''}"/>`;
    }
  });
  s += '</g>';
  s += `<rect class="frame" x="${m.l}" y="${m.t}" width="${iw}" height="${ih}"/>`;
  s += yt.map(v => `<text x="${m.l - 8}" y="${sy(v) + 4}" text-anchor="end">${(cfg.fy || fmtN)(v)}</text>`).join('') + xt.map(v => `<text x="${sx(v)}" y="${H - m.b + 15}" text-anchor="middle">${(cfg.fx || fmtHz)(v)}</text>`).join('');
  if (cfg.xLabel) s += `<text class="axis-title" x="${m.l + iw / 2}" y="${H - 4}" text-anchor="middle">${esc(cfg.xLabel)}</text>`;
  if (cfg.yLabel) s += `<text class="axis-title" transform="translate(12 ${m.t + ih / 2}) rotate(-90)" text-anchor="middle">${esc(cfg.yLabel)}</text>`;
  for (const hd of cfg.handles || []) {
    const x = sx(hd.x), w = 22;
    s += `<g class="handle${focusKey === hd.key ? ' active' : ''}" data-key="${hd.key}" tabindex="0" role="slider" aria-label="${esc(hd.title)}" aria-valuenow="${Math.round(hd.x)}" aria-valuemin="0" aria-valuemax="${Math.round(x1)}"><line class="edge" x1="${x}" x2="${x}" y1="${m.t}" y2="${H - m.b}"/><rect x="${x - 22}" y="${m.t - 20}" width="44" height="${ih + 20}" fill="transparent"/><rect class="tab" x="${x - w / 2}" y="${m.t - 18}" width="${w}" height="16" rx="4"/><text class="tabtxt" x="${x}" y="${m.t - 6}" text-anchor="middle">${hd.label}</text><title>${esc(hd.title)}</title></g>`;
  }
  s += `<g class="hover" visibility="hidden"><line class="xh" y1="${m.t}" y2="${H - m.b}" stroke="var(--ink-3)"/>${cfg.series.map((se, k) => `<circle r="4" fill="${se.color || SERIES_COLORS[k]}" stroke="var(--panel)" stroke-width="2"/>`).join('')}</g>`;
  s += `<rect class="hit" x="${m.l}" y="${m.t}" width="${iw}" height="${ih}" fill="transparent" style="pointer-events:${cfg.handles ? 'none' : 'all'}"/></svg><div class="tip" hidden></div>`;
  el.innerHTML = s;
  const svg = el.firstElementChild, tip = el.lastElementChild, hover = $('.hover', el), hit = $('.hit', el);
  const s0 = cfg.series[0], xh = $('.xh', el), dots = $$('circle', hover); let cur = -1;
  const nearest = xv => { let lo = 0, hi = s0.x.length - 1; while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (s0.x[mid] < xv) lo = mid; else hi = mid; } return Math.abs(s0.x[lo] - xv) <= Math.abs(s0.x[hi] - xv) ? lo : hi; };
  const showX = xv => {   // place the cursor at x value xv (also called by linked charts)
    if (!(xv >= x0 && xv <= x1)) return hideX();
    const r = svg.getBoundingClientRect(), i = cur = nearest(xv);
    hover.setAttribute('visibility', 'visible'); const xs = sx(s0.x[i]);
    xh.setAttribute('x1', xs); xh.setAttribute('x2', xs);
    dots.forEach((c, k) => { const yv = cfg.series[k].y[i]; c.setAttribute('cx', sx(cfg.series[k].x[i] ?? s0.x[i])); c.setAttribute('cy', Number.isFinite(yv) ? sy(clamp(yv, y0, y1)) : -99); });
    tip.innerHTML = cfg.tip(i); tip.hidden = false;
    const tw = tip.offsetWidth; tip.style.left = clamp(xs * (r.width / W) + 12, 0, r.width - tw) + 'px'; tip.style.top = (m.t + 4) + 'px';
  };
  const hideX = () => { hover.setAttribute('visibility', 'hidden'); tip.hidden = true; };
  const move = ev => { const r = svg.getBoundingClientRect(), xv = x0 + ((ev.clientX - r.left) * (W / r.width) - m.l) / iw * (x1 - x0); showX(xv); if (cfg.link) linkCursor(cfg.link, el.id, xv >= x0 && xv <= x1 ? xv : null); };
  const leave = () => { hideX(); if (cfg.link) linkCursor(cfg.link, el.id, null); };
  const area = cfg.handles ? svg : hit; area.addEventListener('pointermove', ev => { if (!ev.target.closest('.handle')) move(ev); else leave(); }); area.addEventListener('pointerleave', leave);
  if (cfg.link) {   // linked cursor: this chart follows the others, and arrow keys drive it when the plot has focus
    linkRegister(cfg.link, el.id, { show: showX, hide: hideX });
    svg.setAttribute('tabindex', '0'); svg.setAttribute('aria-label', `${cfg.label}. Left and right arrow keys move a frequency cursor shared with the other plots.`);
    svg.addEventListener('keydown', ev => {
      const k = { ArrowLeft: -1, ArrowRight: 1 }[ev.key];
      if (ev.key === 'Escape') { leave(); return; }
      if (!k || ev.target !== svg) return;
      ev.preventDefault(); const i = clamp((cur < 0 ? s0.x.length >> 1 : cur) + k * (ev.shiftKey ? 20 : 2), 0, s0.x.length - 1);
      showX(s0.x[i]); linkCursor(cfg.link, el.id, s0.x[i]);
    });
    svg.addEventListener('blur', leave);
  }
  if (cfg.handles) {
    const toX = ev => { const live = document.getElementById(el.id) || el, r = $('svg', live).getBoundingClientRect(); return x0 + ((ev.clientX - r.left) * (W / r.width) - m.l) / iw * (x1 - x0); };
    $$('.handle', el).forEach(g => {
      const key = +g.dataset.key;
      g.addEventListener('pointerdown', ev => {
        ev.preventDefault(); focusKey = key; g.classList.add('active');
        const mv = e2 => cfg.onDrag(key, toX(e2), false), up = e2 => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); cfg.onDrag(key, toX(e2), true); };
        window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
      });
      g.addEventListener('keydown', ev => {
        const k = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 }[ev.key]; if (!k) return;
        ev.preventDefault(); focusKey = key; const hd = cfg.handles.find(h => h.key === key); cfg.onDrag(key, hd.x + k * (ev.shiftKey ? 10 : 1) * (x1 - x0) / 400, true);
      });
    });
    if (focusKey !== null) { const g = $(`.handle[data-key="${focusKey}"]`, el); if (g && document.activeElement !== g && el.dataset.keepfocus) g.focus({ preventScroll: true }); }
  }
  if (cfg.morph) { const tr = $$('path.trace:not(.ghost)', el)[0]; if (tr) morphPath(el.id, tr); }
}

function pzChart(el, cfg) {
  const Wd = Math.min(Math.max(el.clientWidth || 300, 220), 420), H = Wd;
  let R = 1.4; for (const z of [...cfg.zeros, ...cfg.poles, ...(cfg.qZeros || []), ...(cfg.qPoles || [])]) R = Math.max(R, Math.min(D.cabs(z) * 1.1, 6));
  R = cfg.R || (R > 1.5 ? Math.ceil(R * 2) / 2 : 1.4); const c = Wd / 2, k = (Wd / 2 - 24) / R, X = x => c + x * k, Y = y => c - y * k;
  let s = `<svg viewBox="0 0 ${Wd} ${H}" width="${Wd}" height="${H}" role="img" aria-label="Pole-zero plot"><rect class="screen" x="0.5" y="0.5" width="${Wd - 1}" height="${H - 1}"/><rect class="frame" x="0.5" y="0.5" width="${Wd - 1}" height="${H - 1}"/><g class="grid">`;
  [0.5, 1.5].filter(r => r < R).forEach(r => { s += `<circle cx="${c}" cy="${c}" r="${r * k}" fill="none" stroke="var(--grid)"/>`; });
  s += `<line x1="${24}" x2="${Wd - 24}" y1="${c}" y2="${c}"/><line y1="${24}" y2="${H - 24}" x1="${c}" x2="${c}"/></g><circle cx="${c}" cy="${c}" r="${k}" fill="none" stroke="var(--ink-3)" stroke-width="1.5"/>`;
  s += `<text x="${X(1) + 4}" y="${c + 14}">1</text><text x="${X(-1) - 4}" y="${c + 14}" text-anchor="end">−1</text><text x="${c + 5}" y="${Y(1) - 4}">j</text><text x="${Wd - 8}" y="${c - 6}" text-anchor="end">Re</text><text x="${c + 6}" y="30">Im</text>`;
  const groups = (arr, extraOrigin) => {
    const g = new Map(); arr.forEach(z => { const kk = Math.round(z.re * 1e4) + ',' + Math.round(z.im * 1e4); const e = g.get(kk) || { z, n: 0 }; e.n++; g.set(kk, e); });
    if (extraOrigin) { const e = g.get('0,0') || { z: { re: 0, im: 0 }, n: 0 }; e.n += extraOrigin; g.set('0,0', e); }
    return [...g.values()];
  };
  const marks = [];
  const draw = (items, type, col, ghost) => items.forEach(({ z, n }) => {
    const x = X(z.re), y = Y(z.im); marks.push({ x, y, z, n, type, ghost });
    const out = ghost && D.cabs(z) >= 1 && type === 'pole';
    if (out) s += `<circle cx="${x}" cy="${y}" r="10" fill="none" stroke="var(--bad)" stroke-width="2"/>`;
    if (type === 'zero') s += `<circle cx="${x}" cy="${y}" r="${ghost ? 4 : 5}" fill="${ghost ? 'none' : 'var(--screen)'}" stroke="${col}" stroke-width="2"/>`;
    else s += `<path d="M${x - 5} ${y - 5}L${x + 5} ${y + 5}M${x + 5} ${y - 5}L${x - 5} ${y + 5}" stroke="${col}" stroke-width="2" fill="none" stroke-linecap="round"/>`;
    if (n > 1) s += `<text class="mult" x="${x + 10}" y="${y - 9}">${n}</text>`;
  });
  draw(groups(cfg.zeros, 0), 'zero', 'var(--s1)', false); draw(groups(cfg.poles, cfg.poleOrigin || 0), 'pole', 'var(--s1)', false);
  if (cfg.qZeros) { draw(groups(cfg.qZeros, 0), 'zero', 'var(--s2)', true); draw(groups(cfg.qPoles, cfg.qPoleOrigin || 0), 'pole', 'var(--s2)', true); }
  if (cfg.link) s += `<g class="fcur" visibility="hidden"><line class="fray" x1="${c}" y1="${c}" x2="${c}" y2="${c}"/><circle class="fdot" r="5.5" cx="${c}" cy="${c}"/></g>`;
  s += `</svg><div class="tip" hidden></div>`; el.innerHTML = s;
  const svg = el.firstElementChild, tip = el.lastElementChild;
  svg.addEventListener('pointermove', ev => {
    const r = svg.getBoundingClientRect(), px = (ev.clientX - r.left) * (Wd / r.width), py = (ev.clientY - r.top) * (H / r.height);
    let best = null, bd = 14; marks.forEach(mk => { const d = Math.hypot(mk.x - px, mk.y - py); if (d < bd) { bd = d; best = mk; } });
    if (!best) { tip.hidden = true; return; }
    const z = best.z, ang = Math.atan2(z.im, z.re) / (2 * Math.PI) * cfg.fs;
    tip.innerHTML = `<b>${best.ghost ? 'Quantized ' : ''}${best.type}${best.n > 1 ? ' ×' + best.n : ''}</b><br>${fmtN(z.re, 4)} ${z.im < 0 ? '−' : '+'} ${fmtN(Math.abs(z.im), 4)}j<br>radius ${fmtN(D.cabs(z), 4)} · angle ${fmtN(Math.abs(ang), 0)} Hz`;
    tip.hidden = false; tip.style.left = clamp(px * (r.width / Wd) + 12, 0, r.width - tip.offsetWidth) + 'px'; tip.style.top = clamp(py * (r.height / H) + 12, 0, r.height - 60) + 'px';
  });
  svg.addEventListener('pointerleave', () => { tip.hidden = true; });
  if (cfg.link) {   // the shared frequency is the point e^{j 2 pi f / fs} on the unit circle
    const g = $('.fcur', el), ray = $('.fray', el), dot = $('.fdot', el);
    linkRegister(cfg.link, el.id, {
      show: f => {
        const w = 2 * Math.PI * f / cfg.fs, px = X(Math.cos(w)), py = Y(Math.sin(w)), r = svg.getBoundingClientRect();
        g.setAttribute('visibility', 'visible'); ray.setAttribute('x2', px); ray.setAttribute('y2', py); dot.setAttribute('cx', px); dot.setAttribute('cy', py);
        tip.innerHTML = cfg.readout(f, w); tip.hidden = false;
        tip.style.left = clamp(px * (r.width / Wd) + 12, 0, r.width - tip.offsetWidth) + 'px'; tip.style.top = clamp(py * (r.height / H) + 12, 0, r.height - 70) + 'px';
      },
      hide: () => { g.setAttribute('visibility', 'hidden'); tip.hidden = true; },
    });
  }
  return { X, Y, R, k, c, Wd, svg };
}

const legend = items => `<div class="legend">${items.map(i => `<span${i.ghost ? ' class="ghost"' : ''}><i class="${i.dash ? 'dash' : ''}" style="border-color:${i.color}${i.w ? `;border-top-width:${Math.max(i.w, 2)}px` : ''}"></i>${esc(i.label)}</span>`).join('')}</div>`;
function tableDetails(headers, rows, label = 'Show data table') {
  return `<details class="data"><summary>${label}</summary><div class="scroll"><table class="t"><thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div></details>`;
}

/* ================= views ================= */
function magShades(st, d) {
  const nyq = st.fs / 2, fir = d.kind === 'fir', up = fir ? st.rp / 2 : 0, lo = fir ? -st.rp / 2 : -st.rp, sh = [];
  for (const b of d.bands) {
    if (b.type === 'stop') sh.push({ x0: b.lo, x1: b.hi, y0: -st.rs, y1: 100, edge: -st.rs });
    else { sh.push({ x0: b.lo, x1: b.hi, y0: -400, y1: lo, edge: lo }); if (fir) sh.push({ x0: b.lo, x1: b.hi, y0: up, y1: 400, edge: up }); }
  }
  return sh;
}
function yDomain(st) { return state.zoom === 'pass' ? [-Math.max(st.rp * 2.4, 0.6), Math.max(st.rp * 1.4, 0.4)] : [-Math.ceil((st.rs + 30) / 10) * 10, 5]; }
const edgeHandles = (st, d) => st.edges.map((f, i) => ({ key: i, x: f, label: ROLES[st.btype][i], title: `${LABELS[st.btype][i]}: ${Math.round(f)} Hz` }));
function onEdgeDrag(i, x, final) {
  const gap = Math.max(state.fs / 800, 1), nyq = state.fs / 2, e = state.edges.slice();
  e[i] = clamp(Math.round(x), (e[i - 1] ?? 0) + gap, (e[i + 1] ?? nyq) - gap); state.edges = e; syncControls(); fastMode = !final; scheduleRender();
}

function renderResponse(d) {
  const st = state, v = $('#view');
  if (!respScrub || (respGhost && respGhost.f.length !== d.resp.f.length)) respGhost = null;
  const tools = (name, opts, cur) => `<div class="seg" role="group" aria-label="${name}">${opts.map(([k, l]) => `<button data-k="${name}" data-v="${k}" aria-pressed="${cur === k}">${l}</button>`).join('')}</div>`;
  v.innerHTML = `<div class="grid2"><div class="col">
    <div class="panel card"><div class="card-head"><h2>Magnitude</h2><div class="tools"><span class="drag-hint">Drag the edge tabs to reshape the filter</span> ${tools('zoom', [['full', 'Full range'], ['pass', 'Passband']], st.zoom)}
        <button class="btn" id="pinB" aria-pressed="${!!pinB}">${pinB ? 'Clear B' : 'Pin as B'}</button></div></div>
      ${legend([{ label: pinB ? 'A: current design' : 'Response', color: 'var(--s1)' }, ...(respGhost ? [{ label: 'Previous order (faint)', color: 'var(--s1)', ghost: true }] : []), ...(explore && explore.src === d ? [{ label: 'Exploration (what-if, not a design)', color: 'var(--accent)', dash: true }] : []), ...(pinB ? [{ label: 'B: ' + pinB.title, color: 'var(--cmp)', dash: true }] : []), { label: 'Spec limit (shaded = outside spec)', color: 'var(--shade-line)' }])}
      <div class="chart" id="cMag" data-keepfocus="1"></div><div id="tMag"></div></div>
    <div class="panel card"><div class="card-head"><h2>${st.phase === 'phase' ? 'Phase' : 'Group delay'}</h2><div class="tools">${tools('phase', [['phase', 'Phase'], ['gd', 'Group delay']], st.phase)}</div></div>
      <div class="chart" id="cPh"></div></div></div>
    <div class="col"><div class="panel card"><div class="card-head"><h2>Poles and zeros</h2></div><div class="legend"><span><svg class="mk" viewBox="0 0 14 14" aria-hidden="true"><circle cx="7" cy="7" r="4.5" fill="none" stroke="var(--s1)" stroke-width="2"/></svg>Zero</span><span><svg class="mk" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 3L11 11M11 3L3 11" stroke="var(--s1)" stroke-width="2" stroke-linecap="round"/></svg>Pole</span></div><div class="chart" id="cPZ"></div>
      ${explore && explore.src === d ? `<div class="banner info explore-label"><b>Exploration, not a spec-meeting design.</b> Dragging poles and zeros changes only the dashed trace on the magnitude plot (gain normalised to a 0 dB peak). The design, its spec check and every other tab are unchanged.</div><p class="hint" id="exploreNote"></p>` : `<p class="hint">${d.kind === 'fir' ? `FIR: ${d.poleOrigin} poles sit at the origin, so it is always stable.` : 'All poles inside the unit circle means a stable filter.'}</p>`}
      <div class="tools play"><button class="btn" id="exploreBtn" aria-pressed="${!!(explore && explore.src === d)}">${explore && explore.src === d ? 'End exploration' : 'Explore: drag poles and zeros'}</button>${explore && explore.src === d ? '<button class="btn" id="exploreReset">Reset roots</button>' : ''}</div></div>
    <div class="panel card"><div class="card-head"><h2>Spec check</h2><button class="btn" id="specSheet" title="A technical drawing of this design (shortcut: D)">Spec sheet (SVG)</button></div>${scoreHtml(d)}</div></div></div>`;
  $$('[data-k]', v).forEach(b => b.addEventListener('click', () => { state[b.dataset.k] = b.dataset.v; renderResponse(current); }));
  $('#specSheet').addEventListener('click', downloadSpecSheet);
  if (explore && explore.src !== d) explore = null;   // a new design ends the what-if
  $('#exploreBtn').addEventListener('click', () => { if (explore) explore = null; else exploreStart(d); renderResponse(current); $('#exploreBtn').focus(); });
  if ($('#exploreReset')) $('#exploreReset').addEventListener('click', () => { exploreStart(d); renderResponse(current); });
  $('#pinB').addEventListener('click', () => { pinB = pinB ? null : { title: d.title, f: Array.from(d.resp.f), db: Array.from(d.resp.db), fs: st.fs }; renderResponse(current); $('#pinB').focus(); });
  const nyq = st.fs / 2, r = d.resp, fr = Array.from(r.f), bSame = pinB && pinB.fs === st.fs;
  const series = [{ x: fr, y: Array.from(r.db) }, ...(respGhost ? [{ x: respGhost.f, y: respGhost.db, ghost: true }] : [])]; if (pinB) series.push({ x: pinB.f, y: pinB.db, color: 'var(--cmp)', dash: true });
  const drawMag = er => lineChart($('#cMag'), { link: 'resp', morph: true, label: pinB ? 'Magnitude response in decibels, current design A and pinned design B' : 'Magnitude response in decibels', height: 300, xd: [0, nyq], yd: yDomain(st), yLabel: 'Gain (dB)', xLabel: 'Frequency (Hz)', series: er ? [...series, { x: er.f, y: er.db, color: 'var(--accent)', dash: true, w: 2 }] : series,
    shades: magShades(st, d), handles: edgeHandles(st, d), onDrag: onEdgeDrag,
    tip: i => `<b>${fmtN(r.f[i], 1)} Hz</b><br>${pinB ? '<span class="sw" style="background:var(--s1)"></span>A ' : ''}${fmtN(r.db[i], 2)} dB` + (bSame ? `<br><span class="sw dash" style="background:var(--cmp)"></span>B ${fmtN(pinB.db[i], 2)} dB` : '') });
  drawMag(null); exploreRedrawMag = explore && explore.src === d ? drawMag : null;
  const phaseChart = () => {
    if (st.phase === 'phase') { const y = Array.from(r.phase, p => p * 180 / Math.PI); lineChart($('#cPh'), { link: 'resp', label: 'Phase response', height: 200, xd: [0, nyq], yd: padRange(y), yLabel: 'Phase (°)', xLabel: 'Frequency (Hz)', series: [{ x: fr, y }], tip: i => `<b>${fmtN(r.f[i], 1)} Hz</b><br>${fmtN(y[i], 1)}°` }); }
    else { const g = Array.from(d.gd.gd), fg = Array.from(d.gd.f), fin = g.filter(Number.isFinite).sort((a, b) => a - b); const lo = fin[Math.floor(fin.length * 0.02)], hi = fin[Math.floor(fin.length * 0.98)]; lineChart($('#cPh'), { link: 'resp', label: 'Group delay', height: 200, xd: [0, nyq], yd: padRange([lo, hi, 0]), yLabel: 'Delay (samples)', xLabel: 'Frequency (Hz)', series: [{ x: fg, y: g }], tip: i => `<b>${fmtN(fg[i], 1)} Hz</b><br>${fmtN(g[i], 2)} samples (${fmtN(g[i] / st.fs * 1000, 3)} ms)` }); }
  };
  phaseChart();
  const at = f => { let i = Math.round(f / nyq * (fr.length - 1)); i = clamp(i, 0, fr.length - 1); return i; };
  if (explore && explore.src === d) wireExplore(d);
  else if (respScrub && d.kind === 'fir' && d.h.length > 64) $('#cPZ').innerHTML = '<p class="hint pz-wait">Poles and zeros redraw when you let go of the slider (root-finding a long FIR takes a moment).</p>'; else pzChart($('#cPZ'), { zeros: d.zeros, poles: d.poles, poleOrigin: d.poleOrigin, fs: st.fs, link: 'resp',
    readout: (f, w) => { const i = at(f); return `<b>${fmtN(r.f[i], 1)} Hz</b><br>z = e<sup>jω</sup>, ω = ${fmtN(w, 4)} rad/sample<br>|H| ${fmtN(r.db[i], 2)} dB · phase ${fmtN(r.phase[i] * 180 / Math.PI, 1)}°`; } });
  countReadouts(v);
  const step = Math.max(1, Math.floor(fr.length / 32)); const rows = []; for (let i = 0; i < fr.length; i += step) rows.push([fmtN(r.f[i], 1), fmtN(r.db[i], 2), fmtN(r.phase[i] * 180 / Math.PI, 1), ...(bSame ? [fmtN(pinB.db[i], 2)] : [])]);
  $('#tMag').innerHTML = tableDetails(['Frequency (Hz)', pinB ? 'A gain (dB)' : 'Gain (dB)', 'Phase (°)', ...(bSame ? ['B gain (dB)'] : [])], rows) + (pinB && !bSame ? '<p class="hint">B was pinned at a different sample rate, so the table and hover readout leave it out.</p>' : '');
}
function padRange(a) { const f = a.filter(Number.isFinite); let lo = Math.min(...f), hi = Math.max(...f); if (hi - lo < 1e-9) { lo -= 1; hi += 1; } const p = (hi - lo) * 0.08; return [lo - p, hi + p]; }

function scoreHtml(d) {
  const st = state, row = (ok, lab, val, sub) => `<div class="row"><span class="ic ${ok ? 'ok' : 'no'}" aria-hidden="true">${ok ? '✓' : '✕'}</span><span class="lab">${lab}</span><span class="val num">${unitSplit(val)}</span>${sub ? `<span class="sub">${sub}</span>` : ''}</div>`;
  const gdPass = (() => { const f = Array.from(d.gd.f), g = Array.from(d.gd.gd); let mn = Infinity, mx = -Infinity; d.bands.filter(b => b.type === 'pass').forEach(b => f.forEach((ff, i) => { if (ff >= b.lo && ff <= b.hi && Number.isFinite(g[i])) { mn = Math.min(mn, g[i]); mx = Math.max(mx, g[i]); } })); return [mn, mx]; })();
  const gdTxt = d.kind === 'fir' ? `Constant delay of ${fmtN((d.taps - 1) / 2, 1)} samples (${fmtN((d.taps - 1) / 2 / st.fs * 1000, 2)} ms): linear phase.` : `Delay varies ${fmtN(gdPass[0], 1)} to ${fmtN(gdPass[1], 1)} samples across the passband.`;
  return `<div class="score">
    ${row(d.passRipple, 'Passband ripple', fmtN(d.m.ripple, 3) + ' dB', `Target ${st.rp} dB or less${d.passRipple ? '' : '. Over by ' + fmtN(d.m.ripple - st.rp, 3) + ' dB'}`)}
    ${row(d.stopOk, 'Stopband attenuation', fmtN(d.m.atten, 1) + ' dB', `Target ${st.rs} dB or more${d.stopOk ? '' : '. Short by ' + fmtN(st.rs - d.m.atten, 1) + ' dB'}`)}
    ${row(true, 'Size', d.size, gdTxt)}
    ${d.notes.map(n => `<div class="banner">${esc(n)}</div>`).join('')}</div>`;
}

function listings(d) {
  if (d.kind === 'fir') return { rows: d.h.map((v, n) => [n, v.toPrecision(10)]), head: ['n', 'h[n]'] };
  return { rows: d.sos.map((s, k) => [k + 1, ...s.map(v => v.toFixed(10))]), head: ['Section', 'b0', 'b1', 'b2', 'a0', 'a1', 'a2'] };
}
function impulse(d, n) {
  if (d.kind === 'fir') return Array.from({ length: Math.min(n, d.h.length) }, (_, i) => d.h[i]);
  let x = new Array(n).fill(0); x[0] = 1;
  for (const s of d.sos) { let x1 = 0, x2 = 0, y1 = 0, y2 = 0; x = x.map(v => { const y = s[0] * v + s[1] * x1 + s[2] * x2 - s[4] * y1 - s[5] * y2; x2 = x1; x1 = v; y2 = y1; y1 = y; return y; }); }
  return x;
}
function renderTime(d) {
  const st = state, v = $('#view'), n = d.kind === 'fir' ? Math.min(d.h.length, 400) : 200;
  const h = impulse(d, n), idx = h.map((_, i) => i), stepR = []; h.reduce((a, b, i) => (stepR[i] = a + b), 0);
  const L = listings(d);
  v.innerHTML = `<div class="grid2"><div class="col">
    <div class="panel card"><div class="card-head"><h2>Impulse response</h2></div><div class="chart" id="cImp"></div></div>
    <div class="panel card"><div class="card-head"><h2>Step response</h2></div><div class="chart" id="cStep"></div></div></div>
    <div class="col"><div class="panel card"><div class="card-head"><h2>Coefficients</h2><div class="tools"><button class="btn" id="cpPy">Python</button><button class="btn" id="cpC">C, floating</button><button class="btn" id="cpQ">C, fixed-point</button></div></div>
      <div class="scroll"><table class="t mono"><thead><tr>${L.head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${L.rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
      <p class="hint">Fixed-point export uses the word length chosen on the Quantization tab (${st.q.coef} bits).</p></div></div></div>`;
  lineChart($('#cImp'), { label: 'Impulse response', height: 240, xd: [-0.5, n - 0.5], yd: padRange([...h, 0]), xticks: undefined, fx: v => Math.round(v), fy: v => fmtN(v, 3), xLabel: 'Sample n', series: [{ type: 'stem', x: idx, y: h }], tip: i => `<b>n = ${i}</b><br>${h[i].toPrecision(6)}` });
  const stp = stepR; lineChart($('#cStep'), { label: 'Step response', height: 220, xd: [0, n - 1], yd: padRange([...stp, 0]), fx: v => Math.round(v), fy: v => fmtN(v, 2), xLabel: 'Sample n', series: [{ x: idx, y: stp }], tip: i => `<b>n = ${i}</b><br>${stp[i].toPrecision(6)}` });
  $('#cpPy').onclick = () => copy(pythonSnippet(d)); $('#cpC').onclick = () => copy(cSnippet(d, false)); $('#cpQ').onclick = () => copy(cSnippet(d, true));
}

/* ---------- quantization ---------- */
function quantAnalysis(d, st) {
  const q = st.q, nyq = st.fs / 2, out = {}, sigFmt = D.qFormat(0, q.sig - 1), x = D.testSignal(8192, 0.22);
  const respOf = (b, a) => D.freqz(b, a, 2048, st.fs);
  const sweepWords = Array.from({ length: 21 }, (_, i) => i + 4);
  const atten = r => { const m = D.measure(r, d.bands); return m.passMax > -20 ? m.atten : NaN; };   // NaN = filter lost its passband
  if (d.kind === 'fir') {
    const qf = D.quantizeFir(d.h, q.coef, q.round), resp = respOf(qf.hq, null);
    Object.assign(out, { fmt: qf.fmt, maxErr: qf.maxErr, resp, m: D.measure(resp, d.bands), poles: [], poleOrigin: d.h.length - 1, stable: true }); lazyRoots(out, 'zeros', qf.hq);
    if (qf.fmt.fracBits >= 0) {
      const sim = D.firFixedSim(d.h, x, qf.fmt, sigFmt, q.round, { overflow: q.overflow }), skip = d.h.length;
      out.noise = D.variance(sim.y, sim.yq, skip); out.theory = D.firNoiseTheory(d.h, sigFmt, false);
      out.sqnr = 10 * Math.log10(D.power(sim.yIdeal, skip) / D.variance(sim.y, sim.yIdeal, skip));
    }
    out.sweep = [{ name: 'Quantized coefficients', color: 'var(--s2)', y: sweepWords.map(w => atten(D.freqz(D.quantizeFir(d.h, w, q.round).hq, null, 1024, st.fs))) }];
  } else {
    const qs = D.quantizeSos(d.sos, q.coef, q.round), qd = D.quantizeDirect(d.b, d.a, q.coef, q.round);
    const poleOf = sos => sos.flatMap(s => D.polyRoots(s.slice(3))), zeroOf = sos => sos.flatMap(s => D.polyRoots(s.slice(0, 3)));
    const sosPoles = poleOf(qs.sq), sosStable = sosPoles.every(p => D.cabs(p) < 1);
    out.sos = { fmt: qs.fmt, maxErr: qs.maxErr, resp: D.sosFreqz(qs.sq, 2048, st.fs, qs.gain), zeros: zeroOf(qs.sq), poles: sosPoles, stable: sosStable, maxR: Math.max(...sosPoles.map(D.cabs)) };
    out.direct = { fmt: qd.fmt, maxErr: qd.maxErr, resp: D.freqz(qd.bq, qd.aq, 2048, st.fs, qd.gain), zeros: D.polyRoots(qd.bq), poles: qd.poles, stable: qd.stable, maxR: qd.maxRadius };
    const act = q.struct === 'sos' ? out.sos : out.direct; Object.assign(out, { fmt: act.fmt, maxErr: act.maxErr, resp: act.resp, zeros: act.zeros, poles: act.poles, stable: act.stable, m: D.measure(act.resp, d.bands), maxR: act.maxR, poleOrigin: 0 });
    if (out.sos.stable && qs.fmt.fracBits >= 0) {
      const sim = D.sosFixedSim(qs.scaled, x, qs.fmt, sigFmt, q.round, { overflow: q.overflow, headroomBits: q.headroom, errorFeedback: q.ef }), skip = 600; out.sosSim = true;
      const up = Math.pow(4, q.headroom);   // noise referred back to the output scale (the output is multiplied by 2^h)
      out.noise = D.variance(sim.y, sim.yq, skip) * up; out.theory = D.sosNoiseTheory(qs.sq, sigFmt, false, { errorFeedback: q.ef }) * up;
      out.sqnr = 10 * Math.log10(D.power(sim.yIdeal, skip) / D.variance(sim.y, sim.yIdeal, skip));
    }
    out.sweep = [
      { name: 'Biquad cascade', color: 'var(--s2)', y: sweepWords.map(w => { const t = D.quantizeSos(d.sos, w, q.round); return t.sq.every(s => D.polyRoots(s.slice(3)).every(p => D.cabs(p) < 1)) ? atten(D.sosFreqz(t.sq, 1024, st.fs, t.gain)) : NaN; }) },
      { name: 'Single direct form', color: 'var(--ink-3)', dash: true, y: sweepWords.map(w => { const t = D.quantizeDirect(d.b, d.a, w, q.round); return t.stable ? atten(D.freqz(t.bq, t.aq, 1024, st.fs, t.gain)) : NaN; }) },
    ];
  }
  out.alive = out.stable && out.m.passMax > -20;
  out.sweepWords = sweepWords; out.floatAtten = d.m.atten;
  return out;
}

/** Signal-flow diagram of one direct-form-I biquad with its single rounding point (and the error-feedback path). */
function dfDiagram(ef) {
  const box = (x, y, t) => `<rect class="df-box" x="${x}" y="${y}" width="32" height="20" rx="4"/><text class="df-mono" x="${x + 16}" y="${y + 14}" text-anchor="middle">z⁻¹</text>`;
  const lab = (x, y, t, w = 28) => `<rect class="df-mask" x="${x - w / 2}" y="${y - 19}" width="${w}" height="14"/><text class="df-mono" x="${x}" y="${y - 8}" text-anchor="middle">${t}</text>`;
  const ln = (d, cls = 'df-line', arrow = true) => `<path class="${cls}" d="${d}"${arrow ? ' marker-end="url(#dfArr)"' : ''}/>`;
  return `<div class="df-wrap"><svg class="df" viewBox="0 0 520 220" role="img" aria-labelledby="df-title df-desc"><title id="df-title">Direct-form-I biquad with one rounding point</title>
  <desc id="df-desc">Input x[n] and its two delayed copies are weighted by b0, b1, b2; the two delayed outputs are weighted by minus a1 and minus a2; all five products add in one wide accumulator, which is rounded once at Q to give y[n].${ef ? ' A dashed error-feedback path takes the rounding error back into the accumulator through minus round(a1) and minus round(a2).' : ''}</desc>
  <defs><marker id="dfArr" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L8 4L0 8z" class="df-head"/></marker>
  <marker id="dfArrQ" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L8 4L0 8z" class="df-head-q"/></marker></defs>
  <g transform="translate(0 20)">
  ${ln('M44 40H218')}${ln('M70 40V62', 'df-line', false)}${ln('M70 82V122', 'df-line', false)}${ln('M70 102H218')}${ln('M70 142V162H218')}
  ${ln('M264 40H294')}${ln('M352 40H500')}${ln('M440 40V62', 'df-line', false)}${ln('M440 82V122', 'df-line', false)}${ln('M440 102H266')}${ln('M440 142V162H266')}
  ${ef ? `<path class="df-ef" d="M324 26V4H242V22" marker-end="url(#dfArrQ)"/>` : ''}
  <text class="df-name" x="8" y="44">x[n]</text><text class="df-name" x="504" y="30" text-anchor="end">y[n]</text>
  ${box(54, 62)}${box(54, 122)}${box(424, 62)}${box(424, 122)}
  ${lab(150, 40, 'b₀')}${lab(150, 102, 'b₁')}${lab(150, 162, 'b₂')}${lab(360, 102, '−a₁')}${lab(360, 162, '−a₂')}
  <rect class="df-box" x="218" y="24" width="46" height="156" rx="6"/><text class="df-name" x="241" y="100" text-anchor="middle">Σ</text><text class="df-mono" x="241" y="116" text-anchor="middle">ACC</text>
  <rect class="df-q" x="294" y="26" width="58" height="28" rx="6"/><text class="df-name df-qt" x="323" y="45" text-anchor="middle">Q</text>
  <text class="df-mono" x="323" y="72" text-anchor="middle">ROUND ONCE</text>
  ${ef ? `${lab(283, 4, 'ERROR FEEDBACK', 104)}` : ''}
  </g></svg></div>`;
}
/* ---------- signal (time-domain demo) ---------- */
function stopAudio() { if (audio.src) { try { audio.src.stop(); } catch (e) { /* already stopped */ } audio.src = null; } }
function play(y, fs) {
  stopAudio();
  if (!(sig.vol > 0)) { toast('Volume is at zero. Raise it to hear the signal.'); return; }
  try {
    audio.ctx = audio.ctx || new (window.AudioContext || window.webkitAudioContext)();
    const b = audio.ctx.createBuffer(1, y.length, fs), ch = b.getChannelData(0);
    for (let i = 0; i < y.length; i++) ch[i] = clamp(y[i], -1, 1);
    const src = audio.ctx.createBufferSource(), g = audio.ctx.createGain();
    g.gain.value = clamp(sig.vol / 100, 0, 1) * 0.5;   // never louder than half scale
    src.buffer = b; src.connect(g).connect(audio.ctx.destination); src.onended = () => { if (audio.src === src) audio.src = null; };
    src.start(); audio.src = src;
  } catch (e) { toast(`Playback failed: ${e.message}`); }
}
function signalRun(d, st) {
  const q = st.q, wav = sig.source === 'wav' && sig.wav;
  const key = JSON.stringify([d.title, d.size, st.fs, st.edges, st.rp, st.rs, q, sig.source, sig.loads]);   // every upload is a new signal, even with the same name and length
  if (sigMemo.key === key) return sigMemo.out;
  const fs = st.fs, x = wav ? wav.x : D.toneSignal(16384, fs, [[0.03 * fs, 0.25], [0.11 * fs, 0.25], [0.3 * fs, 0.25]], 0.02, 7);
  const sigFmt = D.qFormat(0, q.sig - 1), out = { x, fs, notes: [] };
  if (d.kind === 'fir') {
    const qf = D.quantizeFir(d.h, q.coef, q.round), sim = D.firFixedSim(d.h, x, qf.fmt, sigFmt, q.round, { overflow: q.overflow });
    out.yF = sim.yIdeal; out.yQ = sim.y;
  } else {
    const qs = D.quantizeSos(d.sos, q.coef, q.round);
    if (q.struct === 'direct') out.notes.push('The fixed-point output uses the biquad cascade (direct form is only analysed for coefficient sensitivity).');
    if (!qs.sq.every(s => D.polyRoots(s.slice(3)).every(p => D.cabs(p) < 1))) { out.notes.push(`At ${q.coef} bits a biquad pole leaves the unit circle, so there is no fixed-point output. Use more bits.`); }
    const sim = D.sosFixedSim(qs.scaled, x, qs.fmt, sigFmt, q.round, { overflow: q.overflow, headroomBits: q.headroom, errorFeedback: q.ef }), g = qs.gain * Math.pow(2, q.headroom);
    out.yF = sim.yIdeal.map(v => v * g); out.yQ = out.notes.length && /no fixed-point/.test(out.notes.join()) ? null : sim.y.map(v => v * g);
  }
  const skip = Math.min(1000, Math.floor(x.length / 10));
  out.snr = out.yQ ? 10 * Math.log10(D.power(out.yF, skip) / D.variance(out.yQ, out.yF, skip)) : NaN;
  const nfft = x.length >= 8192 ? 4096 : 1024;
  out.sx = D.powerSpectrumDb(x, fs, nfft); out.sF = D.powerSpectrumDb(out.yF, fs, nfft); out.sQ = out.yQ ? D.powerSpectrumDb(out.yQ, fs, nfft) : null;
  sigMemo = { key, out }; return out;
}
function renderSignal(d) {
  const st = state, v = $('#view'), r = signalRun(d, st), fs = st.fs, nyq = fs / 2;
  const wav = sig.source === 'wav' && sig.wav, srcTxt = wav ? `${esc(sig.name)}: ${sig.wav.format}, ${sig.wav.channels === 2 ? 'stereo mixed to mono' : 'mono'}, ${fmtN(sig.wav.seconds, 2)} s at ${sig.wav.fs} Hz.`
    : `Three tones at ${fmtN(0.03 * fs, 0)}, ${fmtN(0.11 * fs, 0)} and ${fmtN(0.3 * fs, 0)} Hz (amplitude 0.25 each) plus white noise (rms 0.02), ${fmtN(16384 / fs, 2)} s.`;
  const segBtn = (k, l) => `<button data-src="${k}" aria-pressed="${sig.source === k}">${l}</button>`;
  v.innerHTML = `<div class="panel card"><div class="sigctl">
      <div><div class="seg" role="group" aria-label="Signal source">${segBtn('tones', 'Test tones')}${segBtn('wav', 'WAV file')}</div>
        <label class="file btn">Choose a WAV file<input type="file" id="wavIn" accept=".wav,audio/wav,audio/x-wav" class="vh"></label>
        <p class="hint" id="srcInfo">${sig.source === 'wav' && !sig.wav ? 'No file loaded yet. PCM 16- or 24-bit, or 32-bit float; mono or stereo; up to 10 s.' : srcTxt}</p>
        ${sig.error ? `<div class="banner" role="alert">${esc(sig.error)}</div>` : ''}
        ${wav && sig.wav.fs !== fs ? `<div class="banner info">The file was recorded at ${sig.wav.fs} Hz but the design is at ${fs} Hz, so every frequency below is scaled by ${fmtN(fs / sig.wav.fs, 3)}. Set the sample rate to ${sig.wav.fs} to hear it as recorded.</div>` : ''}
        ${r.notes.map(n => `<div class="banner info">${esc(n)}</div>`).join('')}</div>
      <div><div class="slider"><label for="vol">Volume <small class="unit">starts muted, capped at half scale</small></label><span class="big num">${sig.vol}%</span><input type="range" id="vol" min="0" max="100" value="${sig.vol}"></div>
        <div class="tools play"><button class="btn" data-play="x">Play input</button><button class="btn" data-play="f">Play floating point</button><button class="btn" data-play="q"${r.yQ ? '' : ' disabled'}>Play fixed point</button><button class="btn" id="stopA">Stop</button></div></div>
    </div></div>
    <div class="grid2"><div class="col">
      <div class="panel card"><div class="card-head"><h2>Output spectrum</h2></div>${legend([{ label: 'Floating point', color: 'var(--s1)', w: 3.5 }, { w: 1.6, label: `Fixed point, ${st.q.coef}-bit coefficients, ${st.q.sig}-bit signal`, color: 'var(--s2)' }])}<div class="chart" id="sOut"></div>
        <p class="caption">The same input through your filter twice: once in floating point, once bit-true in fixed point with the Quantization tab's settings. Where the orange floor sits above the blue, you are seeing round-off noise and coefficient error. ${Number.isFinite(r.snr) ? `Fixed point against floating point: <b class="num">${fmtN(r.snr, 1)} dB</b> signal-to-noise.` : ''}</p><div id="sOutT"></div></div>
      <div class="panel card"><div class="card-head"><h2>Input spectrum</h2></div><div class="chart" id="sIn"></div><p class="caption">Averaged power spectrum (Welch, Hann window). A full-scale sine reads 0 dB.</p></div></div>
    <div class="col"><div class="panel card"><div class="card-head"><h2>First samples</h2></div>${legend([{ label: 'Input', color: 'var(--ink-3)', dash: true }, { label: 'Floating point', color: 'var(--s1)', w: 3.5 }, { w: 1.6, label: 'Fixed point', color: 'var(--s2)' }])}<div class="chart" id="sTime"></div>
      <p class="caption">The first ${Math.min(120, r.x.length)} samples (the spectra use the whole run). The filter delays and reshapes the input; the two outputs should lie on top of each other unless the arithmetic overflowed.</p></div></div></div>`;
  $$('[data-src]', v).forEach(b => b.addEventListener('click', () => { sig.source = b.dataset.src; sig.error = ''; renderSignal(current); }));
  $('#wavIn').addEventListener('change', async e => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    sig.error = '';
    if (f.size > 64 * 1024 * 1024) sig.error = 'That file is larger than 64 MB. A 10 s WAV is far smaller; trim it and try again.';
    else try {
      const w = D.parseWav(await f.arrayBuffer());
      sig.wav = w; sig.name = f.name; sig.source = 'wav'; sig.loads++;
      if (w.fs !== state.fs) { const k = w.fs / state.fs; state.edges = state.edges.map(x => Math.round(x * k)); state.fs = w.fs; syncControls(); }
    } catch (err) { sig.error = `Could not read ${f.name}. ${err.message}`; }
    render();
  });
  $('#vol').addEventListener('input', e => { sig.vol = +e.target.value; $('.slider .big', v).textContent = sig.vol + '%'; if (audio.src) stopAudio(); });
  $$('[data-play]', v).forEach(b => b.addEventListener('click', () => play(b.dataset.play === 'x' ? r.x : b.dataset.play === 'f' ? r.yF : r.yQ, fs)));
  $('#stopA').addEventListener('click', stopAudio);
  const all = [r.sx, r.sF, r.sQ].filter(Boolean).flatMap(s => Array.from(s.db)), top = Math.ceil((Math.max(...all) + 6) / 10) * 10, yd = [top - 140, top];
  const fr = Array.from(r.sF.f), dbF = Array.from(r.sF.db), dbQ = r.sQ ? Array.from(r.sQ.db) : null;
  lineChart($('#sOut'), { label: 'Output power spectrum, floating point and fixed point', height: 280, xd: [0, nyq], yd, yLabel: 'Power (dB)', xLabel: 'Frequency (Hz)',
    series: [{ x: fr, y: dbF, w: 3.5 }, ...(dbQ ? [{ x: fr, y: dbQ, w: 1.6 }] : [])], tip: i => `<b>${fmtN(fr[i], 1)} Hz</b><br><span class="sw" style="background:var(--s1)"></span>${fmtN(dbF[i], 1)} dB` + (dbQ ? `<br><span class="sw" style="background:var(--s2)"></span>${fmtN(dbQ[i], 1)} dB` : '') });
  const step = Math.max(1, Math.floor(fr.length / 32)), rows = []; for (let i = 0; i < fr.length; i += step) rows.push([fmtN(fr[i], 1), fmtN(dbF[i], 1), dbQ ? fmtN(dbQ[i], 1) : 'n/a']);
  $('#sOutT').innerHTML = tableDetails(['Frequency (Hz)', 'Floating point (dB)', 'Fixed point (dB)'], rows);
  const dbx = Array.from(r.sx.db);
  lineChart($('#sIn'), { label: 'Input power spectrum', height: 200, xd: [0, nyq], yd, yLabel: 'Power (dB)', xLabel: 'Frequency (Hz)', series: [{ x: fr, y: dbx, color: 'var(--ink-2)' }], tip: i => `<b>${fmtN(fr[i], 1)} Hz</b><br>${fmtN(dbx[i], 1)} dB` });
  const n = Math.min(120, r.x.length), idx = Array.from({ length: n }, (_, i) => i), xi = Array.from(r.x.slice(0, n)), yf = Array.from(r.yF.slice(0, n)), yq = r.yQ ? Array.from(r.yQ.slice(0, n)) : null;
  lineChart($('#sTime'), { label: 'First samples of the input and both outputs', height: 280, xd: [0, n - 1], yd: padRange([...xi, ...yf, ...(yq || [])]), fx: v => Math.round(v), fy: v => fmtN(v, 2), xLabel: 'Sample n',
    series: [{ x: idx, y: xi, color: 'var(--ink-3)', dash: true }, { x: idx, y: yf, color: 'var(--s1)', w: 3.5 }, ...(yq ? [{ x: idx, y: yq, color: 'var(--s2)', w: 1.6 }] : [])],   // input drawn first, underneath
    tip: i => `<b>n = ${i}</b><br>Input ${fmtN(xi[i], 4)}<br><span class="sw" style="background:var(--s1)"></span>${fmtN(yf[i], 4)}` + (yq ? `<br><span class="sw" style="background:var(--s2)"></span>${fmtN(yq[i], 4)}` : '') });
}
/* ---------- hardware export (SystemVerilog, bit-exact with the fixed-point simulation) ---------- */
function rtlDesign(d, st) {
  const q = st.q, R = window.RTL, sigFmt = D.qFormat(0, q.sig - 1);
  if (d.kind === 'fir') {
    const qf = D.quantizeFir(d.h, q.coef, q.round); if (qf.fmt.fracBits < 0) return { error: 'The coefficient format is coarser than 1; use more coefficient bits.' };
    const hInt = d.h.map(v => D.toInt(v, qf.fmt, q.round)), name = 'filterlab_fir';
    return { name, sigFmt, coefFmt: qf.fmt, cost: R.rtlCostFir(hInt, qf.fmt, sigFmt, { form: rtlForm }), text: R.genFirSv(hInt, qf.fmt, sigFmt, { overflow: q.overflow, form: rtlForm, moduleName: name }),
      expect: x => D.firFixedSim(hInt.map(v => v * qf.fmt.lsb), x.map(v => v * sigFmt.lsb), qf.fmt, sigFmt, 'nearest', { overflow: q.overflow }).y };
  }
  const qs = D.quantizeSos(d.sos, q.coef, q.round);
  if (!qs.sq.every(s => D.polyRoots(s.slice(3)).every(p => D.cabs(p) < 1))) return { error: `At ${q.coef} bits a biquad pole leaves the unit circle; there is nothing sensible to export. Use more bits.` };
  if (qs.fmt.fracBits < 0) return { error: 'The coefficient format is coarser than 1; use more coefficient bits.' };
  const rows = qs.sq.map(s => [0, 1, 2, 4, 5].map(i => D.toInt(s[i], qs.fmt, 'nearest'))), name = 'filterlab_sos';
  const sosF = rows.map(r => [r[0], r[1], r[2], 1, r[3], r[4]].map((v, i) => i === 3 ? 1 : v * qs.fmt.lsb));
  return { name, sigFmt, coefFmt: qs.fmt, gain: qs.gain * Math.pow(2, q.headroom), cost: window.RTL.rtlCostSos(rows, qs.fmt, sigFmt, { errorFeedback: q.ef }),
    text: window.RTL.genSosSv(rows, qs.fmt, sigFmt, { overflow: q.overflow, headroomBits: q.headroom, errorFeedback: q.ef, moduleName: name }),
    expect: x => D.sosFixedSim(sosF, x.map(v => v * sigFmt.lsb), qs.fmt, sigFmt, 'nearest', { overflow: q.overflow, headroomBits: q.headroom, errorFeedback: q.ef }).y };
}
function rtlStimulus(sigFmt) { // impulse, full-scale step, full-scale square, seeded random (JS generator; Python uses numpy's)
  const hi = Math.pow(2, sigFmt.word - 1) - 1, lo = -hi - 1, r = D.toneSignal(256, 1, [], 0.5, 11), x = [];
  for (let i = 0; i < 64; i++) x.push(i ? 0 : hi);
  for (let i = 0; i < 64; i++) x.push(hi);
  for (let i = 0; i < 128; i++) x.push(Math.floor(i / 16) % 2 ? lo : hi);
  for (const v of r) x.push(Math.max(lo, Math.min(hi, Math.round(v * hi))));
  return x;
}
function download(name, text, type = 'text/plain') {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
}
function rtlCard(d) {
  const st = state, q = st.q, r = rtlDesign(d, st);
  const formCtl = d.kind === 'fir' ? `<div class="field" style="grid-template-columns:1fr 150px;margin-top:0"><label for="rtlForm">Structure</label><select id="rtlForm"><option value="direct">Direct form</option><option value="transposed">Transposed form</option></select></div>`
    : `<p class="hint" style="margin-top:0">Structure: direct-form-I biquad cascade${q.struct === 'direct' ? ' (exported as a cascade even though Structure above says single direct form)' : ''}.</p>`;
  if (r.error) return `<div class="panel card" id="rtlCard"><div class="card-head"><h2>Hardware export</h2></div>${formCtl}<div class="banner info">${esc(r.error)}</div></div>`;
  return `<div class="panel card" id="rtlCard"><div class="card-head"><h2>Hardware export</h2><span class="tag">Generated, not synthesized, not run in an HDL simulator</span></div>
    ${formCtl}
    <div class="tools play"><button class="btn" id="rtlCopy">Copy SystemVerilog</button><button class="btn" id="rtlDl">Download ${r.name}.sv</button><button class="btn" id="rtlTb">Download testbench and vectors</button></div>
    <p class="caption">A synthesizable SystemVerilog module whose arithmetic matches this tab's fixed-point simulation bit for bit: ${q.coef}-bit coefficients, a ${q.sig}-bit signal, ${q.overflow === 'wrap' ? 'wrap-around' : 'saturating'} overflow${d.kind === 'iir' ? `, ${q.headroom} bit${q.headroom === 1 ? '' : 's'} of headroom${q.ef ? ', error feedback' : ''}` : ''}.</p>
    <p class="caption">It assumes one clock, a synchronous active-high reset (<code>rst</code>), and one new sample per clock when <code>in_valid</code> is high. <code>out_data</code> and <code>out_valid</code> arrive one clock later. There is no pipelining, so the whole multiply-add chain must fit in one clock period.${d.kind === 'iir' ? ` The output is the cascade output: multiply it by ${fmtN(r.gain, 4)} (the leftover scaling gain${q.headroom ? ' times 2^' + q.headroom : ''}) downstream.` : ''}</p>
    <details class="data more"><summary>How this was checked</summary><p class="caption">No standard HDL simulator was available where this was built. The test suite runs the generated text through Filterlab's own evaluators and compares them with the bit-true simulator, and <b>Simulate hardware</b> below does the same in your browser; run the testbench with Icarus Verilog to check it with a standard tool.</p></details>
    <div id="rtlCost"></div>
    <details class="data"><summary>Show the module</summary><pre class="code" id="rtlText"></pre></details></div>`;
}
function wireRtl(d) {
  const r = rtlDesign(d, state); if (r.error) { const sel = $('#rtlForm'); if (sel) { sel.value = rtlForm; sel.onchange = e => { rtlForm = e.target.value; renderQuant(current); }; } return; }
  const c = r.cost, n = c.coefficients.length, nz = c.multipliers, acc = Array.isArray(c.acc_bits) ? c.acc_bits.join(', ') : c.acc_bits;
  if (c) $('#rtlCost').innerHTML = `<h3 class="sub-h">Hardware cost (counts, not area)</h3><div class="score plain">
    <div class="row"><span class="lab">General multipliers</span><span class="val num">${nz}</span><span class="sub">One per non-zero coefficient (${n} coefficients, ${n - nz} zero).</span></div>
    <div class="row"><span class="lab">Shift-and-add adders instead</span><span class="val num">${c.csd_adders}</span><span class="sub">If every coefficient is built from its canonical-signed-digit (CSD) form: digits minus one per coefficient.</span></div>
    <div class="row"><span class="lab">Accumulation adders</span><span class="val num">${c.accumulation_adders}</span><span class="sub">Summing the products, plus rounding${state.q.ef && d.kind === 'iir' ? ' and the error-feedback terms' : ''}.</span></div>
    <div class="row"><span class="lab">Accumulator width</span><span class="val num">${acc} bits</span><span class="sub">${Array.isArray(c.acc_bits) ? 'Per section. ' : ''}Smallest width that cannot overflow for any input (docs/rtl.md).</span></div>
    <div class="row"><span class="lab">State and output registers</span><span class="val num">${c.register_bits} bits</span></div></div>
    <p class="caption">These are counts from the generated structure. Area, power and maximum clock speed depend on the target and need a synthesis tool, so none are given.</p>
    ${tableDetails(['Coefficient (integer)', 'CSD digits', 'Adders if shift-add'], c.coefficients.map(x => [x.value, x.digits, x.adders]), 'Show per-coefficient CSD')}`;
  const sel = $('#rtlForm'); if (sel) { sel.value = rtlForm; sel.onchange = e => { rtlForm = e.target.value; renderQuant(current); $('#rtlForm').focus(); }; }
  if (r.error) return;
  $('#rtlText').textContent = r.text;
  $('#rtlCopy').onclick = () => copy(r.text);
  $('#rtlDl').onclick = () => download(`${r.name}.sv`, r.text);
  $('#rtlTb').onclick = () => {
    const x = rtlStimulus(r.sigFmt), y = Array.from(r.expect(x), v => Math.round(v / r.sigFmt.lsb));
    download(`${r.name}_tb.sv`, window.RTL.genTestbenchSv(r.name, r.sigFmt, x.length, `${r.name}.hex`));
    setTimeout(() => download(`${r.name}.hex`, window.RTL.vectorsHex(x, y, r.sigFmt)), 300);
  };
}
/* ---------- in-browser simulation of the generated SystemVerilog (web/rtlsim.js interprets the text) ---------- */
const rsim = { input: 'impulse', len: 32, run: null };
const RSIM_INPUTS = [['impulse', 'Impulse'], ['step', 'Step'], ['square', 'Square'], ['sine', 'Sine'], ['noise', 'Seeded noise']];
function rsimStimulus(kind, n, sigFmt) { // full-scale integers; noise is seeded (seed 11) so a run is repeatable
  const hi = Math.pow(2, sigFmt.word - 1) - 1, lo = -hi - 1, r = kind === 'noise' ? D.toneSignal(n, 1, [], 0.5, 11) : null;
  return Array.from({ length: n }, (_, i) => kind === 'impulse' ? (i ? 0 : hi) : kind === 'step' ? hi : kind === 'square' ? (Math.floor(i / 8) % 2 ? lo : hi)
    : kind === 'sine' ? Math.round(0.9 * hi * Math.sin(2 * Math.PI * i / 16)) : clamp(Math.round(r[i] * hi), lo, hi));
}
function rsimSignals(m, r) { // what the waveform shows: input, first state register, up to 3 accumulators, output
  const sf = r.sigFmt.fracBits, af = sf + r.coefFmt.fracBits, has = n => !!m.sig[n];
  const accs = has('acc') ? ['acc'] : Object.keys(m.sig).filter(n => /^s\d+_acc$/.test(n));
  const show = [['in_data', sf], ...(has('xs') ? [['xs', sf]] : []), ...(has('x1') ? [['x1', sf]] : has('p1') ? [['p1', af]] : []), ...accs.slice(0, 3).map(n => [n, af]), ['out_data', sf]];
  return { show, accs, af, sf, more: Math.max(accs.length - 3, 0) };
}
function rsimStart(r) { const sim = window.RTLSim.create(r.text); sim.step({ rst: 1, in_valid: 0, in_data: 0 }); return sim; }
function rsimRun(run, k) { while (k-- > 0 && run.cycles.length < run.x.length) run.cycles.push(run.sim.step({ rst: 0, in_valid: 1, in_data: run.x[run.cycles.length] })); }
function rsimEnsure(r) {
  const key = `${r.text}|${rsim.input}|${rsim.len}`;
  if (rsim.run && rsim.run.key === key) return rsim.run;
  try {
    const sim = rsimStart(r), x = rsimStimulus(rsim.input, rsim.len, r.sigFmt);
    rsim.run = { key, sim, x, model: Array.from(r.expect(x), v => Math.round(v / r.sigFmt.lsb)), cycles: [], cursor: null, sigs: rsimSignals(sim.module, r) };
    rsimRun(rsim.run, Infinity);
  } catch (e) { rsim.run = { key, error: e.message }; }
  return rsim.run;
}
const rsimSame = (run, i) => run.cycles[i].after.out_data !== null && Number(run.cycles[i].after.out_data) === run.model[i];
function rsimCompare(run) {
  const k = run.cycles.length, N = run.x.length; let first = -1, same = 0;
  for (let i = 0; i < k; i++) if (rsimSame(run, i)) same++; else if (first < 0) first = i;
  if (!k) return { html: `RTL output vs bit-true model: nothing simulated yet (${N} clocks to go).`, ok: true };
  let s = `RTL output vs bit-true model: <b class="num">${same} of ${k}</b> samples identical${k < N ? ` so far (clock ${k} of ${N})` : ''}.`;
  if (first >= 0) { const v = run.cycles[first].after.out_data; s += ` First mismatch at clock ${first}: RTL out_data = ${v === null ? 'X' : v}, model = ${run.model[first]}.`; }
  return { html: s, ok: first < 0 };
}
const rsimReal = (v, f) => { const r = Number(v) / Math.pow(2, f); return Math.abs(r) >= 1e-4 || r === 0 ? String(+r.toPrecision(6)) : r.toExponential(3); };
function rsimReadout(run) {
  const k = run.cycles.length; if (!k) return 'Nothing simulated yet. Press <b>Step 1 clock</b> or <b>Run to end</b>.';
  const n = clamp(run.cursor ?? k - 1, 0, k - 1), c = run.cycles[n], m = run.sim.module.sig;
  const cell = (name, f, v) => `<span class="rd"><span class="nm">${name}</span> <span class="num">${v === null ? 'X' : v}</span> <span class="unit">Q${m[name].w - 1 - f}.${f} = ${v === null ? 'X' : rsimReal(v, f)}</span></span>`;
  const y = c.after.out_data, ok = rsimSame(run, n);
  return `<div><b>Clock ${n}</b> <span class="unit">(values before its rising edge)</span></div><div class="rds">${run.sigs.show.map(([nm, f]) => cell(nm, f, c.before[nm])).join('')}</div>
    <div>At the rising edge, out_data takes <b class="num">${y === null ? 'X' : y}</b>; the bit-true model says <b class="num">${run.model[n]}</b> <span class="${ok ? 'good' : 'bad'}">${ok ? 'identical' : 'different'}</span>.</div>`;
}
function rsimWave(run) {
  const el = $('#rsimWave'), W = Math.max(el.clientWidth || 600, 260), lab = W < 520 ? 66 : 92, N = run.x.length, k = run.cycles.length;
  const cw = (W - lab - 6) / (N + 1), X = t => lab + t * cw, rows = [{ name: 'clk', h: 18 }, ...run.sigs.show.map(([name]) => ({ name, h: 40 }))];
  let y = 6; for (const r of rows) { r.y = y; y += r.h + 10; } const H = y;
  let s = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true"><rect class="wcol" y="2" height="${H - 4}" width="${Math.max(cw, 2)}" x="-99"/>`;
  for (const r of rows) s += `<text class="wl" x="4" y="${r.y + r.h / 2 + 4}">${r.name}</text><line class="wz" x1="${lab}" x2="${W - 6}" y1="${r.y + r.h / 2}" y2="${r.y + r.h / 2}"/>`;
  const ck = rows[0];   // clock n: high for the first half, falls, rises again at its end (the edge that stores out_data)
  if (cw >= 4) { let d = `M${X(0)} ${ck.y}`; for (let n = 0; n < k; n++) d += `H${X(n + .5)}V${ck.y + ck.h}H${X(n + 1)}V${ck.y}`; s += `<path class="wclk" d="${d}"/>`; }
  else if (k) s += `<rect class="wband" x="${X(0)}" y="${ck.y + 3}" width="${X(k) - X(0)}" height="${ck.h - 6}"/>`;
  rows.slice(1).forEach(r => {
    const vals = []; for (let n = 0; n < k; n++) vals.push(run.cycles[n].before[r.name]);
    if (k && (r.name === 'out_data' || run.sim.module.regs.includes(r.name))) vals.push(run.cycles[k - 1].after[r.name]);   // registers also have a value after the last edge
    const big = vals.reduce((a, v) => v === null ? a : Math.max(a, Math.abs(Number(v))), 1), mid = r.y + r.h / 2, Y = v => mid - Number(v) / big * (r.h / 2 - 2);
    let d = '', pen = false;
    vals.forEach((v, n) => { if (v === null) { s += `<rect class="wx" x="${X(n)}" y="${r.y}" width="${cw}" height="${r.h}"/>`; pen = false; return; } d += `${pen ? 'V' : `M${X(n).toFixed(1)} `}${Y(v).toFixed(1)}H${X(n + 1).toFixed(1)}`; pen = true; });
    s += `<path class="wtr${r.name === 'out_data' ? ' out' : ''}" d="${d}"/>`;
    if (r.name === 'out_data') for (let n = 0; n < k; n++) if (!rsimSame(run, n)) s += `<rect class="wbad" x="${X(n + 1)}" y="${r.y}" width="${Math.max(cw, 2)}" height="${r.h}"/>`;
  });
  el.innerHTML = s + '</svg>';
  const col = $('.wcol', el), place = () => { const n = clamp(run.cursor ?? k - 1, 0, k - 1); col.setAttribute('x', k ? X(n) : -99); $('#rsimRead').innerHTML = rsimReadout(run); };
  place();
  const at = ev => { const r = el.firstElementChild.getBoundingClientRect(); return Math.floor(((ev.clientX - r.left) * (W / r.width) - lab) / cw); };
  el.onpointermove = ev => { if (!k) return; const n = at(ev); if (n >= 0 && n < k && n !== run.cursor) { run.cursor = n; place(); } };
  el.onkeydown = ev => {
    const step = { ArrowLeft: -1, ArrowRight: 1, PageUp: -10, PageDown: 10 }[ev.key], cur = clamp(run.cursor ?? k - 1, 0, k - 1);
    const n = ev.key === 'Home' ? 0 : ev.key === 'End' ? k - 1 : step ? cur + step : null; if (n === null || !k) return;
    ev.preventDefault(); run.cursor = clamp(n, 0, k - 1); place();
  };
}
function rtlSimCard(d) {
  if (rtlDesign(d, state).error) return '';
  return `<div class="panel card" id="rsimCard"><div class="card-head"><h2>Simulate hardware</h2><span class="tag">Interpreted in your browser</span></div>
    <div class="rsim-ctl"><div class="field"><label for="rsimIn">Input</label><select id="rsimIn">${RSIM_INPUTS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></div>
      <div class="field"><label for="rsimLen">Samples (16 to 256)</label><input id="rsimLen" type="number" min="16" max="256" step="1" inputmode="numeric"></div></div>
    <div class="tools play"><button class="btn" id="rsimReset">Reset</button><button class="btn" id="rsimStep">Step 1 clock</button><button class="btn" id="rsimRun">Run to end</button></div>
    <p class="rsim-cmp" id="rsimCmp" role="status"></p>
    <div class="wave" id="rsimWave" tabindex="0" role="group" aria-label="Waveform. Left and right arrow keys move the cursor one clock; Home and End jump to the ends." aria-describedby="rsimRead"></div>
    <div class="wave-read num" id="rsimRead"></div>
    <p class="caption">Simulated in your browser by Filterlab's interpreter of the generated SystemVerilog. Not run in a standard HDL simulator, not synthesized.</p>
    <details class="data more"><summary>How the simulation works</summary><p class="caption">The interpreter parses the module text above and runs it one clock at a time with SystemVerilog's signed-arithmetic and width rules; the bit-true model is this tab's fixed-point simulation. Both the interpreter and the generator were written for Filterlab, so agreement here is weaker evidence than a third-party simulator. Running the downloaded testbench in Icarus Verilog or another standard simulator closes that gap.</p></details>
    <div id="rsimTable"></div></div>`;
}
function wireRtlSim(d) {
  const r = rtlDesign(d, state); if (r.error || !$('#rsimCard')) return;
  const run = rsimEnsure(r);
  $('#rsimIn').value = rsim.input; $('#rsimLen').value = rsim.len;
  $('#rsimIn').onchange = e => { rsim.input = e.target.value; wireRtlSim(d); };
  $('#rsimLen').onchange = e => { rsim.len = clamp(Math.round(+e.target.value) || 32, 16, 256); wireRtlSim(d); };
  if (run.error) { $('#rsimCmp').innerHTML = `<span class="bad">Could not simulate: ${esc(run.error)}</span>`; ['#rsimReset', '#rsimStep', '#rsimRun'].forEach(b => $(b).setAttribute('aria-disabled', 'true')); return; }
  const draw = () => {
    const c = rsimCompare(run), done = run.cycles.length >= run.x.length;
    $('#rsimCmp').innerHTML = c.html; $('#rsimCmp').className = 'rsim-cmp ' + (c.ok ? 'good' : 'bad');
    $('#rsimStep').setAttribute('aria-disabled', done); $('#rsimRun').setAttribute('aria-disabled', done);
    rsimWave(run);
    const sg = run.sigs, hd = ['Clock', 'in_data', ...sg.accs, 'out_data after edge', 'Model', 'Same'];
    $('#rsimTable').innerHTML = tableDetails(hd, run.cycles.map((c, n) => [n, c.before.in_data, ...sg.accs.map(a => c.before[a] ?? 'X'), c.after.out_data ?? 'X', run.model[n], rsimSame(run, n) ? 'yes' : '<b class="bad">no</b>']), 'Show the simulated values as a table');
  };
  $('#rsimReset').onclick = () => { run.sim = rsimStart(r); run.cycles = []; run.cursor = null; draw(); };
  $('#rsimStep').onclick = () => { rsimRun(run, 1); run.cursor = null; draw(); };
  $('#rsimRun').onclick = () => { rsimRun(run, Infinity); run.cursor = null; draw(); };
  draw();
}
let qLast = null, qGhost = null, qScrubRaf = 0;   // previous quantized response, drawn faint while scrubbing
function renderQuant(d, opts = {}) {
  const st = state, q = st.q, v = $('#view'), qa = quantAnalysis(d, st), nyq = st.fs / 2, iir = d.kind === 'iir';
  const sliderBlock = (id, label, min, max, val, big) => `<div class="slider"><label for="${id}">${label}</label><span class="big num" id="${id}Big">${big}</span><input type="range" id="${id}" min="${min}" max="${max}" value="${val}"></div>`;
  if (!opts.scrub) qGhost = null;
  const fmtS = f => f.fracBits >= 0 ? `Q${f.intBits}.${f.fracBits}` : `step ${Math.pow(2, -f.fracBits)}`;
  const deadMsg = qa.stable && !qa.alive ? `<div class="banner"><b>Passband lost.</b> At ${q.coef} bits the rounded coefficients are too coarse to pass the signal. Use more bits${iir && q.struct === 'direct' ? ' or switch to a biquad cascade' : ''}.</div>` : '';
  const unstableMsg = deadMsg || (!qa.stable ? `<div class="banner"><b>Unstable.</b> After rounding to ${q.coef} bits, ${iir ? (q.struct === 'direct' ? 'a pole of the single high-order polynomial moved to radius ' + fmtN(qa.maxR, 3) + ', outside the unit circle.' : 'a biquad pole moved outside the unit circle.') : ''} Use more bits${iir && q.struct === 'direct' ? ' or switch to a biquad cascade' : ''}.</div>` : '');
  const sweepNote = iir ? 'Gaps mean the filter went unstable or lost its passband at that word length.' : '';
  const ctlHtml = `<div class="panel card" id="qctlCard"><div class="qctl">
      ${sliderBlock('qCoef', 'Coefficient word length', 4, 24, q.coef, `${q.coef} bits <small class="unit">${fmtS(qa.fmt)}</small>`)}
      ${sliderBlock('qSig', 'Signal word length', 8, 20, q.sig, `${q.sig} bits <small class="unit">Q0.${q.sig - 1}</small>`)}
      <div><div class="field" style="grid-template-columns:1fr 130px;margin-top:0"><label for="qRound">Coefficient rounding</label><select id="qRound"><option value="nearest">Nearest</option><option value="floor">Floor (truncate)</option></select></div>
      ${iir ? `<div class="field" style="grid-template-columns:1fr 130px"><label for="qStruct">Structure</label><select id="qStruct"><option value="sos">Biquad cascade</option><option value="direct">Single direct form</option></select></div>` : ''}
      <div class="field" style="grid-template-columns:1fr 130px"><label for="qOver">On overflow</label><select id="qOver"><option value="saturate">Saturate</option><option value="wrap">Wrap around</option></select></div></div>
      ${iir ? `<div>${sliderBlock('qHead', 'Input headroom', 0, 6, q.headroom, `${q.headroom} bit${q.headroom === 1 ? '' : 's'} <small class="unit">${q.headroom ? '−' + fmtN(6.02 * q.headroom, 1) + ' dB SNR' : 'none'}</small>`)}
      <label class="check"><input type="checkbox" id="qEF"${q.ef ? ' checked' : ''}> Error feedback <small class="unit">feeds each rounding error back through round(a₁), round(a₂)</small></label></div>` : ''}</div></div>`;
  const bodyHtml = `<div class="grid2"><div class="col">
      <div class="panel card"><div class="card-head"><h2>Response, before and after rounding</h2></div>${legend([{ label: 'Floating point', color: 'var(--s1)', w: 3.5 }, { label: `Quantized, ${q.coef}-bit coefficients`, w: 1.6, color: 'var(--s2)' }, ...(opts.scrub && qGhost ? [{ label: 'Previous setting (faint)', color: 'var(--s2)', w: 1.6, ghost: true }] : [])])}<div class="chart" id="qMag"></div><p class="caption">Blue is the filter you designed. Orange is the same filter after every coefficient is rounded to ${q.coef} bits, which is what fixed-point hardware actually computes. Where orange crosses into the shaded area, rounding alone broke the spec.</p>${unstableMsg}</div>
      <div class="panel card"><div class="card-head"><h2>Stopband attenuation against word length</h2></div>${legend([{ label: 'Floating point', color: 'var(--s1)', dash: true }, ...qa.sweep.map(s => ({ label: s.name, color: s.color, dash: s.dash }))])}<div class="chart" id="qSweep"></div><p class="caption">Each point rounds the same design to that many bits; nothing is redesigned. Fewer bits mean coarser steps and usually less stopband attenuation. ${sweepNote} The dotted marker is your current setting.</p><div id="qSweepT"></div></div>
      ${iir && q.struct === 'sos' ? `<div class="panel card"><div class="card-head"><h2>Inside one biquad</h2></div>${dfDiagram(q.ef)}<p class="caption">Each section of the cascade rounds once, at Q. That rounding error (variance q²/12, with q one step of the ${q.sig}-bit signal) feeds back through −a₁ and −a₂, so the section's own poles amplify it before the later sections filter it.${q.ef ? ' Error feedback (dashed) subtracts round(a₁)·r[n−1] + round(a₂)·r[n−2] before rounding, which cancels most of that amplification when the poles sit near z = 1.' : ''}</p></div>` : ''}</div>
    <div class="col"><div class="panel card"><div class="card-head"><h2>Rounding effects</h2></div>${quantScore(d, qa)}<p class="caption">Coefficient rounding changes which filter you get. Round-off noise is separate: it is the error added every time the arithmetic rounds a result, measured here on a test signal and compared with theory.</p></div>
      <div class="panel card"><div class="card-head"><h2>Poles and zeros</h2></div>${legend([{ label: 'Floating point', color: 'var(--s1)' }, { label: 'Quantized', color: 'var(--s2)' }])}<div class="chart" id="qPZ"></div><p class="caption">Rounding moves poles and zeros. ${iir ? 'A pole that reaches the unit circle makes the filter ring forever or blow up; high-order direct form is far more sensitive than a cascade of biquads.' : 'An FIR filter has no poles to move, so it stays stable at any word length; only its zeros, and so its stopband, shift.'}</p></div>
</div></div>
    <div class="hwrow">${rtlCard(d)}${rtlSimCard(d)}</div>`;
  if (opts.scrub && $('#qctlCard') && $('#qBody')) {   // keep the slider being dragged; refresh its readout and everything below
    $('#qBody').innerHTML = bodyHtml;
    $('#qCoefBig').innerHTML = `${q.coef} bits <small class="unit">${fmtS(qa.fmt)}</small>`; $('#qSigBig').innerHTML = `${q.sig} bits <small class="unit">Q0.${q.sig - 1}</small>`;
    if (iir && $('#qHeadBig')) $('#qHeadBig').innerHTML = `${q.headroom} bit${q.headroom === 1 ? '' : 's'} <small class="unit">${q.headroom ? '−' + fmtN(6.02 * q.headroom, 1) + ' dB SNR' : 'none'}</small>`;
  } else v.innerHTML = ctlHtml + `<div id="qBody">${bodyHtml}</div>`;
  $('#qRound').value = q.round; if (iir) $('#qStruct').value = q.struct;
  const upd = () => renderQuant(current);
  const scrub = (key, val) => {   // live while dragging, at most once per frame; the previous trace stays faint behind
    if (!qScrubRaf) qGhost = qLast;
    q[key] = val; cancelAnimationFrame(qScrubRaf);
    qScrubRaf = requestAnimationFrame(() => { qScrubRaf = 0; const t0 = performance.now(); renderQuant(current, { scrub: true }); perf.scrub.push(performance.now() - t0); if (perf.scrub.length > 200) perf.scrub.shift(); });
  };
  $('#qCoef').oninput = e => scrub('coef', +e.target.value); $('#qSig').oninput = e => scrub('sig', +e.target.value);
  ['qCoef', 'qSig', 'qHead'].forEach(id => { const el = $('#' + id); if (el) el.onchange = () => { cancelAnimationFrame(qScrubRaf); qScrubRaf = 0; renderQuant(current, { scrub: true, final: true }); }; });   // on release: full redraw, slider kept
  $('#qRound').onchange = e => { q.round = e.target.value; upd(); }; if (iir) $('#qStruct').onchange = e => { q.struct = e.target.value; upd(); };
  wireRtl(d); wireRtlSim(d);
  $('#qOver').value = q.overflow; $('#qOver').onchange = e => { q.overflow = e.target.value; upd(); };
  if (iir) { $('#qHead').oninput = e => scrub('headroom', +e.target.value); $('#qEF').onchange = e => { q.ef = e.target.checked; upd(); focusRestore('qEF'); }; }
  const fr = Array.from(d.resp.f), y = Array.from(qa.resp.db), ghost = qGhost && qGhost.length === y.length ? qGhost : null; qLast = y;
  lineChart($('#qMag'), { morph: true, label: 'Magnitude before and after quantization', height: 290, xd: [0, nyq], yd: yDomain(st), yLabel: 'Gain (dB)', xLabel: 'Frequency (Hz)', shades: magShades(st, d), series: [{ x: fr, y: Array.from(d.resp.db), w: 3.5 }, { x: fr, y, w: 1.6 }, ...(ghost ? [{ x: fr, y: ghost, color: 'var(--s2)', w: 1.6, ghost: true }] : [])],
    tip: i => `<b>${fmtN(d.resp.f[i], 1)} Hz</b><br><span class="sw" style="background:var(--s1)"></span>${fmtN(d.resp.db[i], 2)} dB<br><span class="sw" style="background:var(--s2)"></span>${fmtN(y[i], 2)} dB` });
  const wd = qa.sweepWords, series = [{ x: wd, y: wd.map(() => qa.floatAtten), color: 'var(--s1)', dash: true }, ...qa.sweep.map(s => ({ x: wd, y: s.y, color: s.color, dash: s.dash }))];
  const all = series.flatMap(s => s.y).filter(Number.isFinite), hi = Math.max(...all, st.rs) + 6;
  lineChart($('#qSweep'), { label: 'Stopband attenuation against coefficient word length', height: 250, xd: [4, 24], yd: [0, Math.ceil(hi / 10) * 10], xticks: [4, 8, 12, 16, 20, 24], fx: v => v, fy: v => v, xLabel: 'Coefficient word length (bits)', yLabel: 'Attenuation (dB)', series, hlines: [{ y: st.rs }],
    tip: i => `<b>${wd[i]} bits</b><br>Float: ${fmtN(qa.floatAtten, 1)} dB` + qa.sweep.map(s => `<br><span class="sw" style="background:${s.color}"></span>${s.name}: ${Number.isFinite(s.y[i]) ? fmtN(s.y[i], 1) + ' dB' : 'unstable or no passband'}`).join('') });
  const cur = $('#qSweep svg'); if (cur) { /* current-setting marker */ const W = cur.viewBox.baseVal.width, m = { l: 62, r: 14 }; const xv = m.l + (q.coef - 4) / 20 * (W - m.l - m.r); cur.insertAdjacentHTML('beforeend', `<line x1="${xv}" x2="${xv}" y1="22" y2="${250 - 24}" stroke="var(--accent)" stroke-width="1.5" stroke-dasharray="1 3" pointer-events="none"/>`); }
  $('#qSweepT').innerHTML = tableDetails(['Bits', ...qa.sweep.map(s => s.name)], wd.map((w, i) => [w, ...qa.sweep.map(s => Number.isFinite(s.y[i]) ? fmtN(s.y[i], 1) + ' dB' : 'unstable or no passband')]));
  countReadouts($('#qBody'));
  if (opts.scrub && !opts.final && d.kind === 'fir' && d.h.length > 64) $('#qPZ').innerHTML = '<p class="hint pz-wait">Poles and zeros redraw when you let go of the slider (root-finding a long FIR takes a moment).</p>'; else pzChart($('#qPZ'), { zeros: d.zeros, poles: d.poles, poleOrigin: d.poleOrigin, qZeros: qa.zeros, qPoles: qa.poles, qPoleOrigin: qa.poleOrigin || 0, fs: st.fs });
}
/* ---------- pole-zero what-if: drag a copy of the roots and watch a dashed response. Exploration only. ---------- */
let explore = null;   // { src: design, zeros: [], poles: [], R }
function exploreStart(d) {
  const zs = d.zeros.map(z => ({ re: z.re, im: z.im })), ps = [...d.poles.map(z => ({ re: z.re, im: z.im })), ...Array.from({ length: d.poleOrigin || 0 }, () => ({ re: 0, im: 0 }))];
  let R = 1.4; for (const z of [...zs, ...ps]) R = Math.max(R, Math.min(D.cabs(z) * 1.1, 6)); R = R > 1.5 ? Math.ceil(R * 2) / 2 : 1.4;
  explore = { src: d, zeros: zs, poles: ps, R };
}
function exploreResp(d) {   // existing analysis code: zpk2sos + sosFreqz, then normalised to a 0 dB peak
  const sos = D.zpk2sos(explore.zeros, explore.poles, 1), r = D.sosFreqz(sos, d.resp.f.length, state.fs), db = Array.from(r.db), mx = Math.max(...db.filter(Number.isFinite));
  return { f: Array.from(r.f), db: db.map(v => v - mx), unstable: explore.poles.some(p => D.cabs(p) >= 1) };
}
function conjPartner(arr, i) { const z = arr[i]; if (Math.abs(z.im) < 1e-9) return -1; let best = -1, bd = Infinity; arr.forEach((q, j) => { if (j !== i && Math.abs(q.re - z.re) + Math.abs(q.im + z.im) < bd) { bd = Math.abs(q.re - z.re) + Math.abs(q.im + z.im); best = j; } }); return best; }
function exploreMove(type, i, re, im) {   // conjugate pairs move together; real roots stay on the real axis (real coefficients)
  const arr = type === 'zero' ? explore.zeros : explore.poles, z = arr[i], j = conjPartner(arr, i);
  if (j < 0) { arr[i] = { re, im: 0 }; return; }
  const up = z.im > 0 ? 1 : -1, y = Math.max(Math.abs(im), 1e-6) * up; arr[i] = { re, im: y }; arr[j] = { re, im: -y };
}
function exploreDraw(d) {   // redraw the editable pole-zero plot and the dashed what-if trace (not the rest of the tab)
  const el = $('#cPZ'), geo = pzChart(el, { zeros: explore.zeros, poles: explore.poles, poleOrigin: 0, fs: state.fs, R: explore.R }), er = exploreResp(d);
  const handles = [...explore.zeros.map((z, i) => ['zero', i, z]), ...explore.poles.map((z, i) => ['pole', i, z])].filter(([, , z]) => z.im >= -1e-9 && D.cabs(z) > 1e-9);
  geo.svg.insertAdjacentHTML('beforeend', handles.map(([t, i, z]) => `<circle class="pzh" r="10" cx="${geo.X(z.re)}" cy="${geo.Y(z.im)}" tabindex="0" role="slider" data-t="${t}" data-i="${i}" aria-label="${t} at ${fmtN(z.re, 3)} ${z.im < 0 ? '−' : '+'} ${fmtN(Math.abs(z.im), 3)}j. Arrow keys move it; its conjugate follows."/>`).join(''));
  exploreRedrawMag && exploreRedrawMag(er);
  $('#exploreNote').innerHTML = er.unstable ? '<b>A pole is on or outside the unit circle:</b> this what-if filter is unstable; the dashed trace is only the frequency-response formula.' : '';
  return geo;
}
let exploreRedrawMag = null;
function wireExplore(d) {
  const el = $('#cPZ'); let geo = exploreDraw(d), drag = null, raf = 0;
  const toZ = ev => { const r = geo.svg.getBoundingClientRect(), px = (ev.clientX - r.left) * (geo.Wd / r.width), py = (ev.clientY - r.top) * (geo.Wd / r.height); return { re: (px - geo.c) / geo.k, im: (geo.c - py) / geo.k }; };
  el.onpointerdown = ev => { const h = ev.target.closest('.pzh'); if (!h) return; ev.preventDefault(); drag = { t: h.dataset.t, i: +h.dataset.i }; el.setPointerCapture(ev.pointerId); };
  el.onpointermove = ev => { if (!drag) return; const z = toZ(ev); exploreMove(drag.t, drag.i, z.re, z.im); if (!raf) raf = requestAnimationFrame(() => { raf = 0; geo = exploreDraw(d); }); };
  el.onpointerup = el.onpointercancel = () => { drag = null; };
  el.onkeydown = ev => {
    const h = ev.target.closest && ev.target.closest('.pzh'); const dv = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[ev.key]; if (!h || !dv) return;
    ev.preventDefault(); const st = ev.shiftKey ? 0.05 : 0.01, arr = h.dataset.t === 'zero' ? explore.zeros : explore.poles, z = arr[+h.dataset.i];
    exploreMove(h.dataset.t, +h.dataset.i, z.re + dv[0] * st, z.im + dv[1] * st); geo = exploreDraw(d);
    const again = $(`.pzh[data-t="${h.dataset.t}"][data-i="${h.dataset.i}"]`, el); if (again) again.focus();
  };
}
/* ---------- spec sheet: a technical drawing of the current design (SVG download) ---------- */
function specSheetSvg(d, st) {
  const W = 1000, H = 700, P = { l: 90, r: 40, t: 70, b: 250 }, iw = W - P.l - P.r, ih = H - P.t - P.b, nyq = st.fs / 2;
  const y0 = -Math.ceil((st.rs + 30) / 10) * 10, y1 = 5, sx = f => P.l + f / nyq * iw, sy = v => P.t + (1 - (clamp(v, y0, y1) - y0) / (y1 - y0)) * ih;
  const r = d.resp, f = Array.from(r.f), db = Array.from(r.db), m = d.m;
  let path = ''; f.forEach((x, i) => { if (Number.isFinite(db[i])) path += (path ? 'L' : 'M') + sx(x).toFixed(1) + ' ' + sy(db[i]).toFixed(1); });
  const e = x => esc(String(x)), num = (v, k) => fmtN(v, k);
  const arrow = (x1, y1, x2, y2, label, lx, ly, anchor = 'middle') => `<line class="dim" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" marker-start="url(#ar)" marker-end="url(#ar)"/><text class="dimt" x="${lx}" y="${ly}" text-anchor="${anchor}">${e(label)}</text>`;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="Bahnschrift, 'DIN Alternate', Arial, sans-serif">
<title>Filterlab spec sheet: ${e(d.title)}</title>
<style>.frame{fill:none;stroke:#111;stroke-width:1.5}.grid{stroke:#d8dcd9;stroke-width:1}.trace{fill:none;stroke:#2a78d6;stroke-width:2}.lim{stroke:#c23a39;stroke-width:1.2;stroke-dasharray:6 4}
.dim{stroke:#111;stroke-width:1}.ext{stroke:#111;stroke-width:.7;stroke-dasharray:2 3}.dimt{font-size:13px;fill:#111}.tick{font-size:11px;fill:#444}.tb{fill:none;stroke:#111;stroke-width:1.2}.tbl{font-size:11px;fill:#555}.tbv{font-size:14px;fill:#111}.h{font-size:20px;font-weight:700;fill:#111}.ok{fill:#0b7a3b}.no{fill:#c23a39}</style>
<defs><marker id="ar" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 1L9 5L0 9Z" fill="#111"/></marker></defs>
<rect x="1" y="1" width="${W - 2}" height="${H - 2}" fill="#fff" stroke="#111" stroke-width="2"/>
<text class="h" x="${P.l}" y="34">Magnitude response, ${e(d.title)}</text>`;
  for (let v = 0; v >= y0; v -= 20) s += `<line class="grid" x1="${P.l}" x2="${P.l + iw}" y1="${sy(v)}" y2="${sy(v)}"/><text class="tick" x="${P.l - 8}" y="${sy(v) + 4}" text-anchor="end">${v} dB</text>`;
  for (let k = 0; k <= 8; k++) { const x = P.l + k / 8 * iw; s += `<line class="grid" x1="${x}" x2="${x}" y1="${P.t}" y2="${P.t + ih}"/><text class="tick" x="${x}" y="${P.t + ih + 16}" text-anchor="middle">${num(k / 8 * nyq, 0)} Hz</text>`; }
  s += `<rect class="frame" x="${P.l}" y="${P.t}" width="${iw}" height="${ih}"/>`;
  for (const b of d.bands) { const lim = b.type === 'stop' ? -st.rs : -st.rp; s += `<line class="lim" x1="${sx(b.lo)}" x2="${sx(b.hi)}" y1="${sy(lim)}" y2="${sy(lim)}"/>`; }
  s += `<path class="trace" d="${path}"/>`;
  // chain dimension of the band edges above the plot
  const edges = [0, ...st.edges, nyq], dy = P.t - 16;
  edges.forEach(x => { s += `<line class="ext" x1="${sx(x)}" x2="${sx(x)}" y1="${dy - 6}" y2="${P.t + ih}"/>`; });
  for (let i = 0; i + 1 < edges.length; i++) { const a = sx(edges[i]), b = sx(edges[i + 1]); if (b - a > 18) s += arrow(a, dy, b, dy, `${num(edges[i + 1] - edges[i], 0)} Hz`, (a + b) / 2, dy - 6); }
  // ripple and attenuation, dimensioned at the first pass band and the first stop band
  const pb = d.bands.find(b => b.type === 'pass'), sb = d.bands.find(b => b.type === 'stop');
  if (sb && Number.isFinite(m.atten)) { const x = sx(sb.lo + (sb.hi - sb.lo) * 0.62), right = x > P.l + iw * 0.55; s += arrow(x, sy(0), x, sy(-m.atten), `attenuation ${num(m.atten, 1)} dB (target ${st.rs} dB or more)`, right ? x - 8 : x + 8, (sy(0) + sy(-m.atten)) / 2, right ? 'end' : 'start') + `<line class="ext" x1="${x - 30}" x2="${x + 30}" y1="${sy(0)}" y2="${sy(0)}"/>`; }
  if (pb && Number.isFinite(m.ripple)) { const x = sx(pb.lo + (pb.hi - pb.lo) * 0.5), yb = sy(-14); s += `<line class="dim" x1="${x}" y1="${yb}" x2="${x}" y2="${sy(0) + 4}" marker-end="url(#ar)"/><text class="dimt" x="${Math.max(x, P.l + 8)}" y="${yb + 16}" text-anchor="${x < P.l + 160 ? 'start' : 'middle'}">passband ripple ${e(num(m.ripple, 3))} dB (target ${st.rp} dB or less)</text>`; }
  // title block: parameters, measured values and the spec check exactly as the app states it
  const tx = P.l, ty = H - P.b + 46, rowsL = [['Method', d.title], ['Response type', st.btype], ['Sample rate', `${st.fs} Hz`], ['Band edges', `${st.edges.join(', ')} Hz`], ['Size', d.size]];
  const rowsR = [['Passband ripple', `${num(m.ripple, 3)} dB`, `Target ${st.rp} dB or less${d.passRipple ? '' : '. Over by ' + num(m.ripple - st.rp, 3) + ' dB'}`, d.passRipple],
    ['Stopband attenuation', `${num(m.atten, 1)} dB`, `Target ${st.rs} dB or more${d.stopOk ? '' : '. Short by ' + num(st.rs - m.atten, 1) + ' dB'}`, d.stopOk]];
  s += `<rect class="tb" x="${tx}" y="${ty - 22}" width="${iw}" height="${P.b - 60}"/><line class="tb" x1="${tx + iw / 2}" x2="${tx + iw / 2}" y1="${ty - 22}" y2="${ty - 22 + P.b - 60}"/>`;
  rowsL.forEach(([k, v], i) => { s += `<text class="tbl" x="${tx + 12}" y="${ty + i * 30}">${e(k)}</text><text class="tbv" x="${tx + 150}" y="${ty + i * 30}">${e(v)}</text>`; });
  rowsR.forEach(([k, v, sub, ok], i) => { const x = tx + iw / 2 + 12, y = ty + i * 52; s += `<text class="tbl" x="${x}" y="${y}">${e(k)}</text><text class="tbv" x="${x + 170}" y="${y}">${e(v)}</text><text class="${ok ? 'ok' : 'no'}" font-size="13" x="${x + 290}" y="${y}">${ok ? '✓ meets' : '✕ misses'}</text><text class="tbl" x="${x}" y="${y + 18}">${e(sub)}</text>`; });
  s += `<text class="tbl" x="${tx + iw / 2 + 12}" y="${ty + 116}">Measured by Filterlab's spec check on the design's computed response.</text>
<text class="tbl" x="${tx + iw / 2 + 12}" y="${ty + 134}">Floating-point design; see the Quantization tab for fixed-point effects.</text>
<text class="tbl" x="${tx + 12}" y="${ty + 156}">Filterlab spec sheet · generated ${e(new Date().toISOString().slice(0, 10))} · dimensions in Hz and dB</text>
</svg>`;
  return s;
}

/* ---------- keyboard shortcuts and the help dialog ---------- */
function openHelp() { const dlg = $('#help'); if (!dlg.open) dlg.showModal(); }
function shortcuts(ev) {
  if (ev.ctrlKey || ev.metaKey || ev.altKey || ev.defaultPrevented) return;
  const t = ev.target; if (t.closest && t.closest('input, select, textarea, [contenteditable], dialog')) return;
  if (!$('#tour').hidden) return;   // the tour has its own keys
  const k = ev.key, tabs = ['response', 'time', 'quant', 'signal'];
  if (k >= '1' && k <= '4') { $(`[data-tab=${tabs[+k - 1]}]`).click(); $(`[data-tab=${tabs[+k - 1]}]`).focus(); }
  else if (k === 't' || k === 'T') { const i = THEMES.indexOf(document.documentElement.dataset.theme); setTheme(THEMES[(i + 1) % THEMES.length], true); toast('Theme: ' + $('#theme').selectedOptions[0].textContent); }
  else if ((k === 's' || k === 'S') && $('#rsimStep')) $('#rsimStep').click();
  else if ((k === 'r' || k === 'R') && $('#rsimRun')) $('#rsimRun').click();
  else if (k === 'g' || k === 'G') tourStart();
  else if (k === 'd' || k === 'D') downloadSpecSheet();
  else if (k === '?') openHelp();
  else return;
  ev.preventDefault();
}
function downloadSpecSheet() { if (!current) return; download(`filterlab-spec-sheet-${current.kind}.svg`, specSheetSvg(current, state), 'image/svg+xml'); toast('Spec sheet downloaded (SVG)'); }

/* ---------- guided tour: six steps, starts only when asked, restores your design at the end ---------- */
const TOUR = [
  { tab: 'response', target: '#controls', title: 'Design a filter', text: 'Pick a method, a response type and the spec. The tour has loaded a Chebyshev I low-pass: 1000 Hz passband, 1500 Hz stopband, 60 dB.',
    act: () => Object.assign(state, { method: 'cheby1', btype: 'lowpass', fs: 8000, edges: [1000, 1500], rp: 1, rs: 60, orderMode: 'auto' }) },
  { tab: 'response', target: '#cMag', title: 'Shape it on the plot', text: 'Drag the P and S tabs to move the band edges; the filter is redesigned live. Hover any plot: the cursor is shared with phase and the pole-zero plot.' },
  { tab: 'response', target: '.score', card: true, title: 'Read the spec check', text: 'The measured passband ripple and stopband attenuation against your targets, with the size the order search picked.' },
  { tab: 'quant', target: '#qctlCard', title: 'Quantize it', text: 'Choose the coefficient and signal word lengths. The tour set 12-bit coefficients; drag the slider and the previous response stays faint behind the new one.',
    act: () => { state.q.coef = 12; state.q.sig = 16; } },
  { tab: 'quant', target: '#rtlCard', title: 'Export hardware', text: 'Copy or download the SystemVerilog module, a testbench and test vectors for exactly these settings. Generated, not synthesized, not run in an HDL simulator.' },
  { tab: 'quant', target: '#rsimCard', title: 'Simulate it', text: "Filterlab's interpreter runs the generated text clock by clock and compares every output with the bit-true model. Press S to step one clock, R to run to the end.",
    act: () => { if (rsim.run && rsim.run.sim) { rsim.run = null; } } },
];
let tourAt = -1, tourSaved = null, tourReturnFocus = null;
function tourStart() {
  if (tourAt >= 0) return;
  tourSaved = JSON.stringify({ state, q: state.q }); tourReturnFocus = document.activeElement;
  $('#tour').hidden = false; tourGo(0);
}
function tourEnd() {
  if (tourAt < 0) return; tourAt = -1; $('#tour').hidden = true;
  const saved = JSON.parse(tourSaved); Object.assign(state, saved.state); state.q = saved.q; syncControls(); render();
  toast('Tour closed. Your design is back.'); if (tourReturnFocus && tourReturnFocus.focus) tourReturnFocus.focus();
}
function tourGo(i) {
  tourAt = clamp(i, 0, TOUR.length - 1); const stp = TOUR[tourAt];
  if (stp.act) { stp.act(); syncControls(); }   // the side panel shows the demo design too
  if (state.tab !== stp.tab || stp.act) { state.tab = stp.tab; render(); }
  $('#tourStep').textContent = `Step ${tourAt + 1} of ${TOUR.length}`; $('#tourTitle').textContent = stp.title; $('#tourText').textContent = stp.text;
  $('#tourBack').disabled = tourAt === 0; $('#tourNext').textContent = tourAt === TOUR.length - 1 ? 'Finish' : 'Next';
  let el = $(stp.target); if (el && stp.card) el = el.closest('.panel') || el;
  if (el) el.scrollIntoView({ block: 'center', behavior: calm() ? 'auto' : 'smooth' });
  const place = () => {
    const ring = $('.tour-ring'), card = $('.tour-card'); if (!el) { ring.style.opacity = 0; return; }
    const r = el.getBoundingClientRect(), pad = 6; ring.style.opacity = 1;
    Object.assign(ring.style, { left: r.left - pad + 'px', top: r.top - pad + 'px', width: r.width + 2 * pad + 'px', height: r.height + 2 * pad + 'px' });
    const cw = card.offsetWidth, ch = card.offsetHeight, below = r.bottom + 16 + ch < innerHeight, above = r.top - ch - 16 > 0;
    let left = clamp(r.left, 12, innerWidth - cw - 12), top = below ? r.bottom + 16 : r.top - ch - 16;
    if (!below && !above) {   // a tall target: sit beside it rather than on top of it, if there is room
      if (r.left - cw - 16 >= 12) { left = r.left - cw - 16; top = r.top; } else if (r.right + 16 + cw <= innerWidth - 12) { left = r.right + 16; top = r.top; }
    }
    card.style.left = left + 'px'; card.style.top = clamp(top, 12, innerHeight - ch - 12) + 'px';
  };
  place(); setTimeout(place, calm() ? 0 : 320);   // again after the smooth scroll settles
  $('#tourTitle').focus({ preventScroll: true });
}
function wireTour() {
  $('#tourBtn').addEventListener('click', tourStart);
  $('#tourNext').addEventListener('click', () => tourAt === TOUR.length - 1 ? tourEnd() : tourGo(tourAt + 1));
  $('#tourBack').addEventListener('click', () => tourGo(tourAt - 1));
  $('#tourSkip').addEventListener('click', tourEnd);
  $('#tour').addEventListener('keydown', ev => {
    if (ev.key === 'Escape') { ev.preventDefault(); tourEnd(); }
    else if (ev.key === 'ArrowRight' && !ev.target.closest('button')) { ev.preventDefault(); $('#tourNext').click(); }
    else if (ev.key === 'ArrowLeft' && !ev.target.closest('button')) { ev.preventDefault(); if (tourAt > 0) tourGo(tourAt - 1); }
    else if (ev.key === 'Tab') {   // keep keyboard focus inside the tour card while it is open
      const f = $$('.tour-card button:not([disabled]), #tourTitle'); const i = f.indexOf(document.activeElement);
      if (ev.shiftKey && i <= 0) { ev.preventDefault(); f[f.length - 1].focus(); } else if (!ev.shiftKey && i === f.length - 1) { ev.preventDefault(); f[0].focus(); }
    }
  });
  addEventListener('resize', () => { if (tourAt >= 0) tourGo(tourAt); });
}
/* ---------- themes: Instrument light/dark, Swiss, Phosphor, Paper; the choice is remembered per viewer ---------- */
const THEMES = ['light', 'dark', 'swiss', 'phosphor', 'paper'];
function storedTheme() { try { const t = localStorage.getItem('filterlab.theme'); return THEMES.includes(t) ? t : null; } catch (e) { return null; } }
function setTheme(t, remember) {
  if (!THEMES.includes(t)) t = 'light';
  document.documentElement.dataset.theme = t; $('#theme').value = t;
  if (remember) { try { localStorage.setItem('filterlab.theme', t); } catch (e) { /* storage blocked: the theme still applies for this visit */ } }
}
function focusRestore(id) { const el = document.getElementById(id); if (el) el.focus(); }
function quantScore(d, qa) {
  const st = state, lsb = Math.pow(2, -qa.fmt.fracBits), row = (ok, lab, val, sub) => `<div class="row"><span class="ic ${ok ? 'ok' : 'no'}" aria-hidden="true">${ok ? '✓' : '✕'}</span><span class="lab">${lab}</span><span class="val num">${unitSplit(val)}</span>${sub ? `<span class="sub">${sub}</span>` : ''}</div>`;
  const stopOk = qa.alive && qa.m.atten >= st.rs - 0.01, ripOk = qa.alive && qa.m.ripple <= st.rp * 1.0005 + 1e-6;
  let h = '<div class="score">';
  h += row(qa.stable, 'Stability', qa.stable ? 'Stable' : 'Unstable', d.kind === 'fir' ? 'FIR filters cannot go unstable.' : `Largest pole radius ${fmtN(qa.maxR, 4)}`);
  h += row(stopOk, 'Stopband attenuation', qa.alive ? fmtN(qa.m.atten, 1) + ' dB' : 'n/a', `Floating point gives ${fmtN(d.m.atten, 1)} dB. Spec ${st.rs} dB.`);
  h += row(ripOk, 'Passband ripple', qa.alive ? fmtN(qa.m.ripple, 3) + ' dB' : 'n/a', `Floating point gives ${fmtN(d.m.ripple, 3)} dB. Spec ${st.rp} dB.`);
  h += row(qa.maxErr <= lsb / 2 + 1e-15, 'Largest coefficient error', qa.maxErr.toExponential(1), `Rounding limit is half a step, ${(lsb / 2).toExponential(1)}. Format ${qa.fmt.fracBits >= 0 ? 'Q' + qa.fmt.intBits + '.' + qa.fmt.fracBits : 'coarser than 1 (step ' + Math.pow(2, -qa.fmt.fracBits) + ')'}.`);
  if (qa.sqnr !== undefined && (d.kind === 'fir' || st.q.struct === 'sos')) {
    const gap = 10 * Math.log10(qa.noise / qa.theory);
    h += row(Math.abs(gap) < 3, 'Round-off noise', fmtN(10 * Math.log10(qa.noise), 1) + ' dB', `Theory predicts ${fmtN(10 * Math.log10(qa.theory), 1)} dB (${gap >= 0 ? '+' : ''}${fmtN(gap, 1)} dB off). ${d.kind === 'iir' ? `Inside the cascade, before the output gain${st.q.headroom ? `, scaled back by 2^${st.q.headroom}` : ''}${st.q.ef ? ', with error feedback' : ''}. ` : ''}Relative to a 1.0 full scale.${Math.abs(gap) >= 3 && st.q.overflow === 'wrap' ? ' Large gaps with wrap-around usually mean the signal overflowed.' : ''}`);
    h += row(true, 'Signal-to-noise ratio', fmtN(qa.sqnr, 1) + ' dB', `Fixed-point output against the ideal floating-point filter, so coefficient rounding counts too. ${st.q.sig}-bit signal.`);
  } else if (d.kind === 'iir' && st.q.struct === 'direct') h += '<div class="banner info">Round-off noise is simulated for the biquad cascade only. Direct form is shown for its coefficient sensitivity: switch Structure to see the noise figures.</div>';
  else if (!qa.stable) h += '<div class="banner info">Noise simulation skipped because the quantized filter is unstable.</div>';
  return h + '</div>';
}

/* ================= export ================= */
function pythonSnippet(d) {
  const st = state, nyq = st.fs / 2, e = st.edges, f = v => String(Math.round(v * 1e6) / 1e6);
  const dp = (Math.pow(10, st.rp / 20) - 1) / (Math.pow(10, st.rp / 20) + 1), ds = Math.pow(10, -st.rs / 20);
  const des = { lowpass: '[1, 0]', highpass: '[0, 1]', bandpass: '[0, 1, 0]', bandstop: '[1, 0, 1]' }[st.btype];
  const w = { lowpass: [1 / dp, 1 / ds], highpass: [1 / ds, 1 / dp], bandpass: [1 / ds, 1 / dp, 1 / ds], bandstop: [1 / dp, 1 / ds, 1 / dp] }[st.btype].map(x => +x.toPrecision(5));
  if (st.method === 'remez') return `from dsp import remez\nh = remez(${d.taps}, [0, ${e.map(f).join(', ')}, ${f(nyq)}], ${des},\n          weight=[${w.join(', ')}], fs=${st.fs})`;
  if (st.method === 'window') { const cuts = st.btype === 'lowpass' || st.btype === 'highpass' ? [(e[0] + e[1]) / 2] : [(e[0] + e[1]) / 2, (e[2] + e[3]) / 2]; return `from dsp import fir_window\nh = fir_window(${d.taps}, ${cuts.length > 1 ? '[' + cuts.map(f).join(', ') + ']' : f(cuts[0])}, "${st.btype}", "${st.win}", fs=${st.fs}${st.win === 'kaiser' ? ', beta=' + fmtN(d.beta, 4) : ''})`; }
  const sp = splitEdges(st.btype, e), ed = (st.method === 'cheby2' ? sp.stop : sp.pass), edTxt = ed.length > 1 ? '[' + ed.map(f).join(', ') + ']' : f(ed[0]);
  return `from dsp import design_iir\nd = design_iir("${st.method}", "${st.btype}", ${d.order}, ${edTxt}, fs=${st.fs}, rp=${st.rp}, rs=${st.rs}${st.method === 'butter' ? ',\n               butter_edge_rp=' + st.rp : ''})\nsos = d["sos"]   # biquad cascade; d["b"], d["a"] hold the single polynomial form`;
}
function cSnippet(d, fixed) {
  const st = state, q = st.q;
  if (d.kind === 'fir') {
    if (!fixed) return `// ${d.title}, fs = ${st.fs} Hz\nstatic const float h[${d.h.length}] = {\n  ${d.h.map(v => v.toExponential(9) + 'f').join(',\n  ')}\n};`;
    const fm = D.autoFormat(Math.max(...d.h.map(Math.abs)), q.coef); const T = q.coef <= 16 ? 'int16_t' : 'int32_t';
    return `// ${d.title}, fs = ${st.fs} Hz. Q${fm.intBits}.${fm.fracBits} coefficients (value = integer / 2^${fm.fracBits})\n#define H_FRAC_BITS ${fm.fracBits}\nstatic const ${T} h[${d.h.length}] = {\n  ${d.h.map(v => D.toInt(v, fm, q.round)).join(', ')}\n};`;
  }
  if (!fixed) return `// ${d.title}, fs = ${st.fs} Hz. Each row: b0 b1 b2 a1 a2 (a0 = 1)\nstatic const float sos[${d.sos.length}][5] = {\n${d.sos.map(s => '  { ' + [0, 1, 2, 4, 5].map(i => s[i].toExponential(9) + 'f').join(', ') + ' }').join(',\n')}\n};`;
  const qs = D.quantizeSos(d.sos, q.coef, q.round), T = q.coef <= 16 ? 'int16_t' : 'int32_t';
  return `// ${d.title}, fs = ${st.fs} Hz. Q${qs.fmt.intBits}.${qs.fmt.fracBits} coefficients. Each row: b0 b1 b2 a1 a2 (a0 = 1)\n#define SOS_FRAC_BITS ${qs.fmt.fracBits}\nstatic const ${T} sos[${d.sos.length}][5] = {\n${d.sos.map(s => '  { ' + [0, 1, 2, 4, 5].map(i => D.toInt(s[i], qs.fmt, q.round)).join(', ') + ' }').join(',\n')}\n};`;
}
function copy(text) {
  const done = () => toast('Copied to clipboard');
  if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, fallback); else fallback();
  function fallback() { const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); done(); } catch (e) { toast('Copy failed. Select the text manually.'); } t.remove(); }
}
function toast(msg) { const t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 1800); }

/* ================= controls ================= */
const miniIcon = bt => {
  const p = { lowpass: 'M2 4H14Q18 4 20 8T26 12H32', highpass: 'M2 12H8Q14 12 16 8T22 4H32', bandpass: 'M2 12H9Q13 12 15 6T19 6T23 12H32', bandstop: 'M2 4H9Q13 4 15 10T19 10T23 4H32' }[bt];
  return `<svg viewBox="0 0 34 16" aria-hidden="true"><path d="${p}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
};
function buildControls() {
  $('#controls').innerHTML = `
  <details class="grp" id="gMethod"><summary><h2>Method</h2><span class="sum" id="sumMethod"></span></summary><div class="method" role="radiogroup" aria-label="Design method">${Object.entries(METHODS).map(([k, m]) => `<label><input type="radio" name="method" value="${k}"><b>${m.name}</b><small>${m.note}</small></label>`).join('')}</div></details>
  <details class="grp" open><summary><h2>Response type</h2><span class="sum" id="sumBtype"></span></summary><div class="seg" id="btype" role="group" aria-label="Response type">${Object.entries(BTYPES).map(([k, l]) => `<button data-v="${k}" aria-pressed="false">${miniIcon(k)}${l}</button>`).join('')}</div></details>
  <details class="grp" open><summary><h2>Spec</h2><span class="sum"></span></summary>
    <div class="field"><label for="fs">Sample rate</label><span><input id="fs" type="number" min="100" step="100"></span></div>
    <div id="edgeFields"></div>
    <div class="field"><label for="rp">Passband ripple</label><span><input id="rp" type="number" min="0.01" max="6" step="any"></span></div>
    <div class="field"><label for="rs">Stopband attenuation</label><span><input id="rs" type="number" min="10" max="140" step="any"></span></div>
    <p class="hint">Frequencies in Hz, ripple and attenuation in dB.</p></details>
  <details class="grp" id="gSize"><summary><h2>Size</h2><span class="sum" id="sumSize"></span></summary>
    <div class="field hidden" id="winRow"><label for="win">Window</label><select id="win">${Object.entries(WINDOWS).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></div>
    <div class="seg" id="omode" role="group" aria-label="Order selection"><button data-v="auto" aria-pressed="true">Pick for me</button><button data-v="manual" aria-pressed="false">Set it</button></div>
    <div class="field"><label for="ord" id="ordLab">Taps</label><span><input id="ord" type="number" min="1" step="1"></span></div>
    <div class="slider ordscrub"><label for="ordR" class="vh">Scrub the order</label><input type="range" id="ordR" min="1" step="1"></div>
    <p class="hint" id="ordHint"></p></details>`;
  $$('input[name=method]').forEach(r => r.addEventListener('change', () => { state.method = r.value; if (METHODS[r.value].kind === 'iir' && state.orderMode === 'manual') state.order = clamp(current?.order || 4, 1, 24); syncControls(); scheduleRender(); }));
  $$('#btype button').forEach(b => b.addEventListener('click', () => { state.btype = b.dataset.v; state.edges = defaultEdges(state.btype, state.fs); syncControls(); scheduleRender(); }));
  $('#fs').addEventListener('input', e => { const nf = +e.target.value; if (nf >= 100) { const r = nf / state.fs; state.edges = state.edges.map(x => Math.round(x * r)); state.fs = nf; syncControls(true); scheduleRender(); } });
  $('#rp').addEventListener('input', e => { if (+e.target.value > 0) { state.rp = +e.target.value; scheduleRender(); } });
  $('#rs').addEventListener('input', e => { if (+e.target.value > 0) { state.rs = +e.target.value; scheduleRender(); } });
  $('#win').addEventListener('change', e => { state.win = e.target.value; scheduleRender(); });
  $$('#omode button').forEach(b => b.addEventListener('click', () => { state.orderMode = b.dataset.v; if (b.dataset.v === 'manual' && current) state.order = current.kind === 'fir' ? current.taps : current.order; syncControls(); scheduleRender(); }));
  $('#ord').addEventListener('input', e => { const n = Math.round(+e.target.value); if (n >= 1) { state.order = n; scheduleRender(); } });
  $('#ordR').addEventListener('input', e => {   // scrub: live redesign once per frame, previous magnitude drawn faint
    if (!respScrub && current) respGhost = { f: Array.from(current.resp.f), db: Array.from(current.resp.db) };
    respScrub = true; state.orderMode = 'manual'; state.order = Math.round(+e.target.value); scheduleRender();
  });
  $('#ordR').addEventListener('change', () => { respScrub = false; scheduleRender(); });
}
function syncControls(skipFs) {
  const st = state, M = METHODS[st.method];
  $$('input[name=method]').forEach(r => { r.checked = r.value === st.method; });
  $('#sumMethod').textContent = M.name; $('#sumBtype').textContent = BTYPES[st.btype];
  $$('#btype button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === st.btype)));
  if (!skipFs && document.activeElement !== $('#fs')) $('#fs').value = st.fs;
  if (document.activeElement !== $('#rp')) $('#rp').value = st.rp; if (document.activeElement !== $('#rs')) $('#rs').value = st.rs;
  const host = $('#edgeFields'), n = st.edges.length;
  if (host.dataset.sig !== st.btype) {
    host.dataset.sig = st.btype;
    host.innerHTML = LABELS[st.btype].map((l, i) => `<div class="field"><label for="e${i}">${l}</label><span><input id="e${i}" type="number" step="any" data-i="${i}"></span></div>`).join('');
    $$('#edgeFields input').forEach(inp => inp.addEventListener('input', () => {
      const i = +inp.dataset.i, v = +inp.value; if (!(v > 0)) return; const gap = Math.max(st.fs / 800, 1), e = st.edges.slice();
      e[i] = clamp(v, (e[i - 1] ?? 0) + gap, (e[i + 1] ?? st.fs / 2) - gap); st.edges = e; scheduleRender();
    }));
    $$('#edgeFields input').forEach(inp => inp.addEventListener('change', () => syncControls()));
  }
  $$('#edgeFields input').forEach((inp, i) => { if (document.activeElement !== inp) inp.value = Math.round(st.edges[i]); });
  $('#winRow').classList.toggle('hidden', st.method !== 'window'); $('#win').value = st.win;
  $$('#omode button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === st.orderMode)));
  const ordR = $('#ordR'); ordR.max = M.kind === 'fir' ? 256 : 24; ordR.min = M.kind === 'fir' ? 5 : 1; if (document.activeElement !== ordR) ordR.value = st.orderMode === 'manual' ? st.order : (current ? (current.kind === 'fir' ? current.taps : current.order) : 1);
  const ord = $('#ord'); ord.disabled = st.orderMode === 'auto'; $('#ordLab').textContent = M.kind === 'fir' ? 'Taps' : (st.btype === 'bandpass' || st.btype === 'bandstop' ? 'Prototype order' : 'Order'); ord.max = M.kind === 'fir' ? 1201 : 24;
  if (document.activeElement !== ord) ord.value = st.orderMode === 'manual' ? st.order : (current ? (current.kind === 'fir' ? current.taps : current.order) : '');
  $('#ordHint').textContent = st.orderMode === 'auto' ? (st.method === 'remez' ? 'Searches for the fewest taps that meet the spec.' : st.method === 'window' ? 'From the transition width and window.' : (st.btype === 'bandpass' || st.btype === 'bandstop' ? 'Lowest order that meets the spec. Band filters end up twice the prototype order.' : 'Lowest order that meets the spec.')) : 'Manual size. The spec check shows what you get.';
}

/* ================= render loop ================= */
function scheduleRender() { if (renderQueued) return; renderQueued = true; requestAnimationFrame(() => { renderQueued = false; render(); }); }
function render() {
  const st = state; let d;
  try { d = designFilter(st, fastMode); } catch (err) { $('#view').innerHTML = `<div class="banner">Could not design this filter: ${esc(err.message)}. Check that the edges increase and stay below half the sample rate.</div>`; console.error(err); return; }
  current = d;
  if (st.orderMode === 'auto' && document.activeElement !== $('#ord')) $('#ord').value = d.kind === 'fir' ? d.taps : d.order;
  $$('.tabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === st.tab)));
  if (st.tab !== 'signal') stopAudio();
  if (st.tab === 'response') renderResponse(d); else if (st.tab === 'time') renderTime(d); else if (st.tab === 'signal') renderSignal(d); else renderQuant(d);
  if (st.tab === 'response') drawn = true;
  $('#subtitle').textContent = d.title;
  $('#sumSize').textContent = `${d.size}${st.orderMode === 'auto' ? ', picked for you' : ''}`;
  $('#sumMethod').textContent = METHODS[st.method].name; $('#sumBtype').textContent = BTYPES[st.btype];
  if (fastMode) { clearTimeout(render.t); render.t = setTimeout(() => { fastMode = false; scheduleRender(); }, 160); }
}

function init() {
  setTheme(storedTheme() || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'), false);
  $('#theme').addEventListener('change', e => setTheme(e.target.value, true));
  document.addEventListener('toggle', e => { const el = e.target; if (el.tagName === 'DETAILS' && el.open) { el.classList.add('opening'); setTimeout(() => el.classList.remove('opening'), 200); } }, true);
  addEventListener('keydown', shortcuts); $('#helpBtn').addEventListener('click', openHelp); wireTour();
  $('#copyPy').addEventListener('click', () => current && copy(pythonSnippet(current)));
  $$('.tabs button').forEach(b => b.addEventListener('click', () => {
    if (state.tab === b.dataset.tab) return;
    state.tab = b.dataset.tab; render();
    const v = $('#view'); v.classList.toggle('enter', false); void v.offsetWidth; v.classList.add('enter');   // a short fade answers the tab change (CSS skips it under reduced motion)
  }));
  buildControls(); syncControls();
  let rt; new ResizeObserver(() => { clearTimeout(rt); rt = setTimeout(() => current && render(), 120); }).observe($('#view'));
  render(); window.__filterlab = { state, designFilter, sig, rsim, perf, specSheetSvg, get current() { return current; }, get tourAt() { return tourAt; } };
}
document.addEventListener('DOMContentLoaded', init);
})();
