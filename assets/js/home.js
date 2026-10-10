/* 西北荒漠化灾害预测及防护平台 — 首页交互（1 km 逐年） */
'use strict';
(() => {
const M = window.NWMap, CORE = window.NW_CORE;
const $ = id => document.getElementById(id);
const { COL, NAMES, CONF, CHG, UP, DN, YEARS, Y0, Y1, BASE, el, clamp, lerp, eo } = M;
const html = (t, cls, txt) => { const e = document.createElement(t); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
const W10 = v => v / 1e4, f1 = v => v.toFixed(1), pct = (v, d = 1) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(d) + '%', sgn = (v, d = 1) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(d);
const yi = M.yi;

/* 县区数据按需加载（见 mapcore.js“按需数据”）：缺数据时先加载，到齐后再画；同一处只保留最后一次请求 */
const later = new Map();
function whenReady(key, has, need, fn) { if (has()) return true; const tok = (later.get(key) || 0) + 1; later.set(key, tok);
  need().then(() => { if (later.get(key) === tok) fn(); }, e => M.toast(e.message)); return false; }
const state = { year: BASE, layer: 'level', scope: -1, cmp: false, yA: BASE, yB: Y1, cmpMode: 'swipe', div: .5, hi: null, county: null, playing: false, reveal: 0 };

/* =================== resources =================== */
const SRC = new Map();          // key -> image | canvas (ready to draw)
const BUCKET = new Map();       // key -> Uint8Array bucket per cell (255 = none)
let CID = null;
const put = (map, k, v, max) => { map.set(k, v); while (map.size > max) map.delete(map.keys().next().value); return v; };
const sk = (y, c = M.scn) => y > BASE ? c : '';   // 2026 年起各情景不同，缓存键带情景
const keyOf = (layer, y, y2, c = M.scn) => layer === 'level' ? 'L' + y + sk(y, c) : layer === 'conf' ? 'C' + y + sk(y, c) : layer === 'change' ? 'X' + y + sk(y, c)
  : layer === 'sdiff' ? 'S' + y + sk(y, c) : 'D' + y + sk(y, c) + '_' + y2 + sk(y2, c);
const CONF_R = new Int16Array(256).fill(-1); CONF.forEach((d, k) => { CONF_R[parseInt(d.c.slice(1, 3), 16)] = k; });
async function confArr(y) { const k = 'Cb' + y + sk(y); if (BUCKET.has(k)) return BUCKET.get(k);
  const img = await M.tile(M.tn('conf', y)), c = document.createElement('canvas'); c.width = M.GW; c.height = M.GH; const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0);
  const d = x.getImageData(0, 0, M.GW, M.GH).data, o = new Uint8Array(M.GW * M.GH).fill(255);
  for (let p = 0, q = 0; p < o.length; p++, q += 4) if (d[q + 3] > 127) { const v = CONF_R[d[q]]; if (v >= 0) o[p] = v; }
  return put(BUCKET, k, o, 6); }
async function bucket(layer, y, y2) {
  const k = 'B' + keyOf(layer, y, y2); if (BUCKET.has(k)) return BUCKET.get(k);
  if (layer === 'level') return M.classArr(y);
  if (layer === 'conf') return confArr(y);
  const n = M.GW * M.GH, o = new Uint8Array(n).fill(255);
  if (layer === 'sdiff') { const a = await M.classArr(y, 'ssp245'), b = await M.classArr(y);   // 0 较 SSP2-4.5 加重，1 减轻，254 相同
    for (let i = 0; i < n; i++) { const B = b[i]; if (B === 255) continue; o[i] = B > a[i] ? 0 : B < a[i] ? 1 : 254; } }
  else if (layer === 'change') { const a = await M.classArr(Math.max(Y0, y - 1)), b = await M.classArr(y);
    for (let i = 0; i < n; i++) { const B = b[i]; if (B === 255) continue; const d = B - a[i]; o[i] = d >= 2 ? 0 : d === 1 ? 1 : d === 0 ? 2 : d === -1 ? 3 : 4; } }
  else { const a = await M.classArr(y), b = await M.classArr(y2);   // diff: 0 扩大, 1 加重, 2 减轻, 3 缩小, 254 不变
    for (let i = 0; i < n; i++) { const A = a[i], B = b[i]; if (B === 255) continue; o[i] = A === 0 && B > 0 ? 0 : A > 0 && B === 0 ? 3 : B > A ? 1 : B < A ? 2 : 254; } }
  return put(BUCKET, k, o, 6);
}
const PAL = { change: CHG.map(d => d.c), conf: CONF.map(d => d.c), level: COL, diff: [UP, '#E58A99', '#8CC5A2', DN], sdiff: [UP, DN] };
async function source(layer, y, y2) {
  const k = keyOf(layer, y, y2); if (SRC.has(k)) return SRC.get(k);
  if (layer === 'level') return put(SRC, k, await M.tile(M.tn('cls', y)), 10);
  if (layer === 'conf') return put(SRC, k, await M.tile(M.tn('conf', y)), 10);
  const b = await bucket(layer, y, y2);
  if (layer === 'sdiff') {   // 差异格网很分散：先按 8×8 格网块统计差异密度着色，再叠加逐格网差异
    const base = await M.classArr(y), GW = M.GW, GH = M.GH, BK = 8, bw = Math.ceil(GW / BK), bh = Math.ceil(GH / BK);
    const up = new Uint16Array(bw * bh), dn = new Uint16Array(bw * bh), nv = new Uint16Array(bw * bh);
    for (let i = 0; i < b.length; i++) { const v = b[i]; if (v === 255) continue; const r = (i / GW) | 0, q = ((r / BK) | 0) * bw + (((i - r * GW) / BK) | 0); nv[q]++; if (v === 0) up[q]++; else if (v === 1) dn[q]++; }
    const blk = new Uint32Array(bw * bh);
    for (let q = 0; q < blk.length; q++) { if (!nv[q]) continue; const f = (up[q] + dn[q]) / nv[q]; if (f < .03) continue;
      blk[q] = M.packRGBA(up[q] >= dn[q] ? '#C8102E' : '#1E7B4D', Math.round(255 * Math.min(.62, .16 + f * 1.6))); }
    const pal = [M.packRGBA(UP), M.packRGBA(DN)], basePal = COL.map(h => M.packRGBA(h, 50));
    return put(SRC, k, M.gridCanvas(i => { const v = b[i]; if (v === 255) return 0; if (v < 2) return pal[v];
      const r = (i / GW) | 0, bq = blk[((r / BK) | 0) * bw + (((i - r * GW) / BK) | 0)]; return bq || basePal[base[i]]; }), 10); }
  if (layer === 'change') { const pal = PAL.change.map(h => M.packRGBA(h)); return put(SRC, k, M.gridCanvas(i => b[i] < 5 ? pal[b[i]] : 0), 10); }
  const base = await M.classArr(y2), pal = [M.packRGBA('#F7D5DA'), M.packRGBA('#E58A99'), M.packRGBA('#8CC5A2'), M.packRGBA('#D3EBDD')], basePal = COL.map(h => M.packRGBA(h, 80));
  const cv = M.gridCanvas(i => { const v = b[i]; return v < 4 ? pal[v] : v === 254 ? basePal[base[i]] : 0; });
  const mk = c => M.gridCanvas(i => b[i] === c ? 0xff000000 : 0);
  cv.masks = { 0: mk(0), 3: mk(3) }; return put(SRC, k, cv, 10);
}
async function onlyClass(layer, y, y2, k) {
  const key = 'H' + keyOf(layer, y, y2) + '|' + k; if (SRC.has(key)) return SRC.get(key);
  const b = await bucket(layer, y, y2), c = M.packRGBA(PAL[layer][k]);
  return put(SRC, key, M.gridCanvas(i => b[i] === k ? c : 0), 10);
}
const ready = k => SRC.has(k);
let loadingToken = 0;
async function prepare() {
  const tok = ++loadingToken, need = [];
  if (!state.cmp) need.push(source(state.layer, state.year));
  else if (state.cmpMode === 'diff') need.push(source('diff', state.yA, state.yB));
  else { need.push(source(state.layer, state.yA)); need.push(source(state.layer, state.yB)); }
  if (state.hi !== null) need.push(onlyClass(state.cmp && state.cmpMode === 'diff' ? 'diff' : state.layer, state.cmp ? state.yB : state.year, state.yB, state.hi));
  const t = setTimeout(() => { if (tok === loadingToken) { $('loading').hidden = false; $('loadingY').textContent = state.cmp ? `${state.yA}/${state.yB}` : state.year; } }, 160);
  try { await Promise.all(need); } catch (e) { M.toast(e.message); }
  clearTimeout(t); if (tok === loadingToken) $('loading').hidden = true;
  mv.dirty();
}
function prefetch(y) { if (y <= Y1 && y >= Y0) { source(state.layer, y).catch(() => {}); M.needYears([y]).catch(() => {}); } }

/* =================== map =================== */
const wrap = $('mapwrap');
let fade = null;   // {from:key, t0}
const mv = new M.MapView(wrap, { onRender: draw, onView: () => { M.scaleBar($('scale'), mv); placeOverlays(); } });
function drawSrcKey(k, opt) { const s = SRC.get(k); if (s) mv.drawGrid(s, opt); return !!s; }
function hiKey() { return state.hi === null ? null : 'H' + keyOf(state.cmp && state.cmpMode === 'diff' ? 'diff' : state.layer, state.cmp ? state.yB : state.year, state.yB) + '|' + state.hi; }
function drawHi() {
  const k = hiKey(); if (!k || !SRC.has(k)) return; const x = mv.ctx;
  x.setTransform(1, 0, 0, 1, 0, 0); x.fillStyle = 'rgba(240,241,238,.82)'; x.fillRect(0, 0, mv.canvas.width, mv.canvas.height); mv.drawGrid(SRC.get(k));
}
function hatch(color, rot) { const c = document.createElement('canvas'); c.width = c.height = 7; const x = c.getContext('2d'); x.fillStyle = color; x.fillRect(0, 0, 2.4, 7); const p = mv.ctx.createPattern(c, 'repeat'); p.setTransform(new DOMMatrix().rotateSelf(rot)); return p; }
function drawMaskStyled(mask, color, rot) {
  const f = mv.frame, fx = mv.fx; fx.setTransform(1, 0, 0, 1, 0, 0); fx.clearRect(0, 0, f.width, f.height); mv.drawGrid(mask, { ctx: fx }); fx.setTransform(1, 0, 0, 1, 0, 0);
  const o = document.createElement('canvas'); o.width = f.width; o.height = f.height; const ox = o.getContext('2d'); const d = Math.max(1.5, 1.6 * mv.DPR);
  for (const [a, b] of [[-d, 0], [d, 0], [0, -d], [0, d]]) ox.drawImage(f, a, b);
  ox.globalCompositeOperation = 'destination-out'; ox.drawImage(f, 0, 0); ox.globalCompositeOperation = 'source-in'; ox.fillStyle = color; ox.fillRect(0, 0, o.width, o.height);
  fx.globalCompositeOperation = 'source-in'; fx.fillStyle = hatch(color, rot); fx.fillRect(0, 0, f.width, f.height); fx.globalCompositeOperation = 'source-over';
  const x = mv.ctx; x.setTransform(1, 0, 0, 1, 0, 0); x.drawImage(f, 0, 0); x.drawImage(o, 0, 0); fx.clearRect(0, 0, f.width, f.height);
}
function draw() {
  const x = mv.ctx;
  if (state.reveal < 1) { // intro sweep
    if (!ready('L' + state.year)) return; const w = mv.canvas.width * eo(state.reveal);
    x.save(); x.beginPath(); x.rect(0, 0, w, mv.canvas.height); x.clip(); drawSrcKey('L' + state.year); x.restore();
    if (state.reveal > 0) { x.fillStyle = '#E3A229'; x.fillRect(w - 2 * mv.DPR, 0, 2 * mv.DPR, mv.canvas.height); } return;
  }
  if (!state.cmp) {
    const cur = keyOf(state.layer, state.year);
    if (fade && SRC.has(fade.from) && SRC.has(cur) && fade.from !== cur) { const p = clamp((performance.now() - fade.t0) / 380, 0, 1);
      drawSrcKey(fade.from); mv.drawGrid(SRC.get(cur), { viaFrame: true, alpha: eo(p) }); if (p < 1) mv.dirty(); else fade = null; }
    else if (!drawSrcKey(cur) && fade && SRC.has(fade.from)) drawSrcKey(fade.from);
    drawHi(); return;
  }
  if (state.cmpMode === 'diff') { const s = SRC.get(keyOf('diff', state.yA, state.yB)); if (!s) return; mv.drawGrid(s); drawHi();
    if (state.hi === null || state.hi === 0) drawMaskStyled(s.masks[0], UP, 45); if (state.hi === null || state.hi === 3) drawMaskStyled(s.masks[3], DN, -45); return; }
  const dx = state.div * mv.canvas.width;
  x.save(); x.beginPath(); x.rect(0, 0, dx, mv.canvas.height); x.clip(); drawSrcKey(keyOf(state.layer, state.yA)); x.restore();
  x.save(); x.beginPath(); x.rect(dx, 0, mv.canvas.width - dx, mv.canvas.height); x.clip(); drawSrcKey(keyOf(state.layer, state.yB)); x.restore();
}

/* static vector layers */
el('path', { d: M.graticule, fill: 'none', stroke: '#C3C9C1', 'stroke-width': .6, 'stroke-dasharray': '2 4', 'vector-effect': 'non-scaling-stroke' }, mv.svgU);
el('path', { d: M.contextPath, fill: '#D9DCD6', stroke: '#F4F5F2', 'stroke-width': 1.2, 'vector-effect': 'non-scaling-stroke' }, mv.svgU);
const dimPath = el('path', { 'fill-rule': 'evenodd', fill: '#EEF0EC', 'fill-opacity': .72, d: '' }, mv.svgO);
const gCty = el('g', { fill: 'none', stroke: '#FFFFFF', 'stroke-width': .5, 'stroke-opacity': .45 }, mv.svgO);
const ctyPaths = M.county.map(c => el('path', { d: c.d, 'vector-effect': 'non-scaling-stroke' }, gCty));
const gCity = el('g', { fill: 'none', stroke: '#24475A', 'stroke-width': .9, 'stroke-opacity': .5 }, mv.svgO);
M.city.forEach(c => el('path', { d: c.d, 'vector-effect': 'non-scaling-stroke' }, gCity));
const gProv = el('g', { fill: 'none', stroke: '#1B252B', 'stroke-width': 1.6, 'stroke-linejoin': 'round' }, mv.svgO);
const provPaths = M.prov.map(p => el('path', { d: p.d, 'vector-effect': 'non-scaling-stroke' }, gProv));
const selHalo = el('path', { d: '', fill: 'none', stroke: '#E3A229', 'stroke-width': 6, 'stroke-linejoin': 'round', opacity: .9, 'vector-effect': 'non-scaling-stroke' }, mv.svgO);
const selLine = el('path', { d: '', fill: 'none', stroke: '#1B252B', 'stroke-width': 2, 'stroke-linejoin': 'round', 'vector-effect': 'non-scaling-stroke' }, mv.svgO);
const gLab = el('g', {}, mv.svgO);
for (const [n, ll] of Object.entries(M.geo.ctxLabel)) { const [x, y] = M.proj(...ll); mv.label(gLab, x, y, n, { fill: '#9AA29C', 'letter-spacing': 4, class: 'ctxl' }, 14); }
M.basemap(mv, $('mapCredit'));   // 天地图底图 + 地图下方说明条
for (const [n, ll] of Object.entries(M.geo.desertLabel)) { const [x, y] = M.proj(...ll); mv.label(gLab, x, y, n, { fill: '#4A2E16', stroke: 'rgba(255,255,255,.8)', 'letter-spacing': 2, 'font-weight': 500 }, 12, 3.5); }
M.prov.forEach(p => mv.label(gLab, p.lp[0], p.lp[1], p.n, { fill: '#1B252B', stroke: '#fff', 'font-weight': 800, 'letter-spacing': 6 }, 22, 4));
const gPins = el('g', {}, mv.svgO);

const fitAll = () => mv.fitBox(M.nwBB, 22);
let VIEW0 = fitAll(); mv.minS = VIEW0.s * .9; mv.maxS = VIEW0.s * 80; mv.setView(VIEW0);
let lastW = wrap.clientWidth;
window.addEventListener('resize', () => { if (Math.abs(wrap.clientWidth - lastW) > 2) { lastW = wrap.clientWidth; VIEW0 = fitAll(); mv.minS = VIEW0.s * .9; mv.maxS = VIEW0.s * 80;
  mv.setView(state.scope < 0 ? VIEW0 : mv.fitBox(M.prov[state.scope].bb, 40)); } buildTimeline(); });

{ const ins = $('inset'); let bb = [1e9, 1e9, -1e9, -1e9];
  const pts = r => { const p = M.dec(r), o = []; for (let i = 0; i < p.length; i += 2) { const q = M.proj(p[i], p[i + 1]); o.push(q); bb = [Math.min(bb[0], q[0]), Math.min(bb[1], q[1]), Math.max(bb[2], q[0]), Math.max(bb[3], q[1])]; } return o; };
  const all = M.geo.context.map(pts), nw = M.geo.nw.map(pts), w = 150, h = 132, s = Math.min((w - 8) / (bb[2] - bb[0]), (h - 8) / (bb[3] - bb[1]));
  const tp = arr => arr.map(r => 'M' + r.map(([x, y]) => `${((x - bb[0]) * s + 4).toFixed(1)},${((y - bb[1]) * s + 4).toFixed(1)}`).join('L') + 'Z').join('');
  ins.setAttribute('width', w); ins.setAttribute('height', h); el('path', { d: tp(all), fill: '#D2D6D0', stroke: '#F7F8F6', 'stroke-width': .5 }, ins); el('path', { d: tp(nw), fill: '#1A3441' }, ins);
  /* 南海诸岛示意框放在左下角：必要时加高位置图，使示意框不压住西藏 */
  const box = ins.parentNode.querySelector('.nh');
  if (box && window.NW_SCS) { const bh = drawSCS() + 16, bw = 50; let my = 0;  /* 示意框：40px 图 + 边距边框；下方 11px 注记 */
    all.forEach(r => r.forEach(([x, y]) => { if ((x - bb[0]) * s + 4 < bw) my = Math.max(my, (y - bb[1]) * s + 4); }));
    const h2 = Math.max(h, Math.ceil(my + bh + 5)); ins.setAttribute('height', h2); }
  else if (box) box.remove(); }
/* 南海诸岛示意（研究区位置图左下角）：华南沿海、南海诸岛与十段线；数据见 assets/data/scs.js */
function drawSCS() { const S = window.NW_SCS, svg = $('scs'), [a0, b0, a1, b1] = S.bbox, P = (lo, la) => M.proj(lo, la);
  const [px0, py1] = P(a0, b0), [px1, py0] = P(a1, b1), W = 40, k = W / (px1 - px0), H = Math.round((py1 - py0) * k);
  svg.setAttribute('width', W); svg.setAttribute('height', H); svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const tp = (arr, close) => arr.map(r => { let s = ''; for (let i = 0; i < r.length; i += 2) { const [x, y] = P(r[i], r[i + 1]); s += (i ? 'L' : 'M') + ((x - px0) * k).toFixed(2) + ',' + ((y - py0) * k).toFixed(2); } return s + (close ? 'Z' : ''); }).join('');
  el('path', { d: tp(S.land, true), fill: '#C9CEC7', stroke: '#9AA29C', 'stroke-width': .3 }, svg);
  el('path', { d: tp(S.jd, true), fill: '#4B575E', stroke: '#4B575E', 'stroke-width': .5 }, svg); return H; }

/* =================== scope / zoom =================== */
const scopeSel = $('scopeSel'); M.PROVS.forEach((p, i) => scopeSel.appendChild(Object.assign(document.createElement('option'), { value: i, textContent: p })));
const scopeName = () => state.scope < 0 ? '西北五省区' : M.PROVS[state.scope];
const scopeStats = k => state.scope < 0 ? M.stats.all(k) : M.stats.prov(state.scope, k);
function applyScope() {
  const s = state.scope;
  dimPath.setAttribute('d', s < 0 ? '' : `M-5000,-5000H5000V5000H-5000Z` + M.prov[s].d);
  provPaths.forEach((p, i) => p.setAttribute('stroke-width', s === i ? 2.6 : 1.6));
  ctyPaths.forEach((p, i) => p.setAttribute('stroke-opacity', s < 0 ? .45 : (M.county[i].p === M.PROVS[s] ? .85 : 0)));
  mv.setView(s < 0 ? fitAll() : mv.fitBox(M.prov[s].bb, 40), true);
  updateAll(true);
}
scopeSel.onchange = () => { state.scope = +scopeSel.value; applyScope(); };
$('zoomIn').onclick = () => mv.setView({ ...mv.view, s: mv.view.s * 1.6 }, true);
$('zoomOut').onclick = () => mv.setView({ ...mv.view, s: mv.view.s / 1.6 }, true);
$('zoomReset').onclick = () => mv.setView(state.scope < 0 ? fitAll() : mv.fitBox(M.prov[state.scope].bb, 40), true);
wrap.addEventListener('wheel', e => { e.preventDefault(); const r = wrap.getBoundingClientRect(); mv.zoomAt(e.deltaY < 0 ? 1.2 : 1 / 1.2, e.clientX - r.left, e.clientY - r.top); }, { passive: false });

/* =================== overlays =================== */
function placeOverlays() {
  if (!state.cmp) return; const VW = mv.VW, dvx = state.div * VW;
  $('divider').style.left = dvx + 'px'; const a = $('chipA'), b = $('chipB');
  if (state.cmpMode === 'swipe') { a.style.left = Math.max(10, dvx - a.offsetWidth - 10) + 'px'; b.style.left = Math.min(VW - b.offsetWidth - 10, dvx + 10) + 'px';
    a.style.opacity = dvx - a.offsetWidth - 10 < 10 ? 0 : 1; b.style.opacity = dvx + 10 + b.offsetWidth > VW - 10 ? 0 : 1; }
  else { a.style.left = (VW / 2 - a.offsetWidth - 5) + 'px'; b.style.left = (VW / 2 + 5) + 'px'; a.style.opacity = b.style.opacity = 1; }
}
const tweens = new Map();
function tweenNum(node, to, f, dur = 420) {
  const from = tweens.has(node) ? tweens.get(node).cur : to, t0 = performance.now(), o = { cur: from }; tweens.set(node, o);
  if (M.REDUCE || dur === 0 || from === to) { o.cur = to; node.textContent = f(to); return; }
  const step = now => { if (tweens.get(node) !== o) return; const p = eo(clamp((now - t0) / dur, 0, 1)); o.cur = lerp(from, to, p); node.textContent = f(o.cur); if (p < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}
const confLabel = y => y <= BASE ? (M.isAnchor(y) ? '数据完整度' : '插值置信度') : '预测置信度';
/* 官方口径校准的逐年面积与风险（NW_CAL）：[area, lo, hi, severe, landRisk, conf, composite, precipRisk, warmRisk] */
const CAL = window.NW_CAL;
const calS = k => (state.scope < 0 ? CAL.nw : CAL.prov[state.scope])[k];
function renderOverview(introF) {
  const box = $('overview');
  if (!box.dataset.built) { box.innerHTML = `<div class="cap"><i></i><span id="ovCap"></span></div>
      <div class="ov-row" id="ovr1"><span class="v"><span id="ov1"></span><small>万km²</small></span><span class="k">荒漠化土地</span><span class="s" id="ov1s"></span></div>
      <div class="ov-row"><span class="v" id="ov2"></span><span class="k" id="ov2k"></span></div>
      <div class="ov-row"><span class="v"><span id="ov3"></span><small>万km²</small></span><span class="k">重度及以上</span></div>
      <div class="ov-row" id="ovr4"><span class="v"><span id="ov4"></span></span><span class="k" id="ov4k"></span><span class="s" id="ov4s"></span></div>`; box.dataset.built = 1; }
  const yr = state.cmp ? state.yB : state.year, ref = state.cmp ? state.yA : BASE, c = calS(yi(yr)), r = calS(yi(ref)), S = scopeStats(yi(yr));
  $('ovCap').textContent = state.cmp ? `${scopeName()}　${state.yA} → ${state.yB}` : `${scopeName()}　${yr} 年`;
  const f = introF === undefined ? 1 : introF, d = introF === undefined ? 420 : 0;
  tweenNum($('ov1'), W10(c[0]) * f, f1, d);
  $('ov1s').textContent = (c[2] - c[1] > 1 ? `90% 区间 ${f1(W10(c[1]))}–${f1(W10(c[2]))}　` : '') + `${confLabel(yr)} ${c[5].toFixed(0)}%`;
  $('ovr1').title = `按 ${CAL.anchorYear} 年各省官方荒漠化调查面积校准（五省合计 ${f1(W10(CAL.anchorTotal))} 万km²）。1 km 格网直接统计为 ${f1(W10(S.cls[1] + S.cls[2] + S.cls[3] + S.cls[4]))} 万km²。`;
  const ch = (c[0] / r[0] - 1) * 100; $('ov2k').textContent = state.cmp ? `较 A 年（${ref}）` : `较 ${BASE} 年`;
  if (!state.cmp && yr === BASE) { tweens.delete($('ov2')); $('ov2').textContent = '基准年'; $('ov2').className = 'v'; }
  else { tweenNum($('ov2'), ch * f, v => pct(v), d); $('ov2').className = 'v ' + (Math.abs(ch) < .05 ? '' : ch > 0 ? 'up' : 'dn'); }
  tweenNum($('ov3'), W10(c[3]) * f, f1, d);
  const comp = c[6] != null; tweenNum($('ov4'), (comp ? c[6] : c[4]) * f, v => v.toFixed(3), d);
  $('ov4k').textContent = comp ? '综合风险指数' : '土地风险指数';
  $('ov4s').textContent = comp ? `${M.scnName()}　其中土地风险 ${c[4].toFixed(3)}` : '2025 年起叠加气候分量';
  $('ovr4').title = comp ? `综合风险 = ${CAL.formula}\n${yr} 年：土地 ${c[4].toFixed(3)}，降水亏缺 ${c[7].toFixed(2)}，增温 ${c[8].toFixed(2)}` : '历史年份没有情景气候分量，显示土地风险指数';
}

/* =================== legend =================== */
function legendRow(sw, name, sub, val, unit, bar, barA, delta, deltaCls, k, title) {
  const b = html('button', 'lv'); if (title) b.title = title;
  b.innerHTML = `<span class="sw" style="background:${sw}"></span><span class="nm">${name}<small>${sub || ''}</small></span>
    <span class="ar"><span class="av">${val}</span><small>${unit}</small></span>
    <span class="bar"><span class="bb"></span><i style="width:${clamp(bar, 0, 100)}%"></i>${barA !== null ? `<span class="ba" style="width:${clamp(barA, 0, 100)}%"></span>` : ''}</span>
    <span class="d ${deltaCls || ''}">${delta}</span>`;
  const on = () => { state.hi = k; prepare(); mv.dirty(); }, off = () => { state.hi = null; mv.dirty(); };
  b.addEventListener('mouseenter', on); b.addEventListener('focus', on); b.addEventListener('mouseleave', off); b.addEventListener('blur', off);
  return b;
}
let areaTok = 0;
async function areasFor(layer, y, y2, n) {   // bucket areas within scope
  const b = await bucket(layer, y, y2); if (!CID) CID = await M.cidArr();
  const out = new Float64Array(n), si = state.scope, inProv = si < 0 ? null : M.county.map(c => c.p === M.PROVS[si]), W = M.GW;
  for (let i = 0; i < b.length; i++) { const v = b[i]; if (v >= n) continue; if (inProv) { const c = CID[i]; if (c === 65535 || !inProv[c]) continue; } out[v] += M.rowArea[(i / W) | 0]; }
  return out;
}
async function renderLegend() {
  const box = $('lgMain'), tok = ++areaTok, yr = state.cmp ? state.yB : state.year;
  $('lgTag').textContent = state.cmp ? `${state.yA} / ${state.yB} 年　${M.scnName()}` : `${yr} 年　${M.scnOf(yr)}`;
  const h3 = html('h3'), list = html('div'), note = html('p', 'note');
  const finish = () => { if (tok !== areaTok) return; box.innerHTML = ''; box.append(h3, list, note); };
  const busy = () => { if (!box.children.length) return; box.classList.add('busy'); };
  try {
  if (state.cmp && state.cmpMode === 'diff') {
    h3.innerHTML = `${state.yA} → ${state.yB} 变化<small>面积 km²</small>`; busy();
    const ar = await areasFor('diff', state.yA, state.yB, 4); if (tok !== areaTok) return; const mx = Math.max(...ar, 1);
    const sw = [`repeating-linear-gradient(45deg,${UP} 0 2px,#fff 2px 6px)`, '#E58A99', '#8CC5A2', `repeating-linear-gradient(-45deg,${DN} 0 2px,#fff 2px 6px)`];
    ['荒漠扩大（新增荒漠化）', '程度加重', '程度减轻', '荒漠缩小（逆转为稳定）'].forEach((n, k) => list.appendChild(legendRow(sw[k], n, '', M.fmtInt(ar[k]), 'km²', ar[k] / mx * 100, null, '', '', k)));
    const net = ar[0] - ar[3]; note.innerHTML = `荒漠化范围净变化 <b class="${net > 0 ? 'up' : 'dn'}">${net > 0 ? '+' : '−'}${M.fmtInt(Math.abs(net))} km²</b>。未变化区域以 B 年等级淡色显示。`;
  } else if (state.layer === 'level') {
    const ref = state.cmp ? state.yA : BASE, S = scopeStats(yi(yr)), Rr = scopeStats(yi(ref));
    h3.innerHTML = `荒漠化等级<small>${state.cmp ? 'B 年面积 / 较 A 年' : '面积 / 较 2025 年'}</small>`;
    const ramp = html('div', 'ramp'); COL.forEach(c => { const i = html('i'); i.style.background = c; ramp.appendChild(i); }); list.appendChild(ramp);
    for (let k = 4; k >= 0; k--) { const a = S.cls[k], r = Rr.cls[k], d = W10(a - r);
      list.appendChild(legendRow(COL[k], NAMES[k], `${(a / S.area * 100).toFixed(1)}%`, f1(W10(a)), '万km²', a / S.area * 220, state.cmp ? r / Rr.area * 220 : null,
        (state.cmp || yr !== BASE) ? sgn(d) : '—', d > .05 ? (k ? 'up' : 'dn') : d < -.05 ? (k ? 'dn' : 'up') : '', k)); }
    note.textContent = '等级为土地覆盖与 NDVI 构造的五级代理标签。此处面积为 1 km 格网直接统计（未校准）；概览与时间轴中的荒漠化面积已按 2019 年官方调查面积校准。悬停可在地图上单独查看该等级。';
  } else if (state.layer === 'sdiff') {
    h3.innerHTML = `${M.scnName()} 与 SSP2-4.5<small>${yr} 年同一格网的等级差</small>`; busy();
    const ar = await areasFor('sdiff', yr, null, 2); if (tok !== areaTok) return; const S = scopeStats(yi(yr)), mx = Math.max(ar[0], ar[1], 1);
    [[UP, `较 SSP2-4.5 加重`], [DN, `较 SSP2-4.5 减轻`]].forEach(([c, n], k) => list.appendChild(legendRow(c, n, `${(ar[k] / S.area * 100).toFixed(2)}%`, M.fmtInt(ar[k]), 'km²', ar[k] / mx * 100, null, '', '', k)));
    const pr = M.SCN && M.SCN.pairs[M.scn < 'ssp245' ? 'ssp126|ssp245' : 'ssp245|ssp585'];
    note.innerHTML = yr <= BASE ? '2025 年及以前为三个情景共用的历史，没有差异。请选择 2026 年以后的年份。'
      : `三个情景使用同一模型和转移矩阵，只替换气候场，因此全区面积相差很小，差异集中在局部格网。${pr && state.scope < 0 ? `${yr} 年全区共 <b>${pr[yr - 2026][0].toFixed(2)}%</b> 的格网等级不同。` : ''}未变化区域以本情景等级淡色显示。`;
  } else if (state.layer === 'change') {
    h3.innerHTML = yr === Y0 ? '年际变化<small>2000 年为起始年</small>' : `年际变化<small>${yr - 1} → ${yr}</small>`; busy();
    const ar = await areasFor('change', yr, null, 5); if (tok !== areaTok) return; const tot = ar.reduce((a, b) => a + b, 0) || 1;
    CHG.forEach((d, k) => list.appendChild(legendRow(d.c, d.n, `${(ar[k] / tot * 100).toFixed(2)}%`, M.fmtInt(ar[k]), 'km²', ar[k] / tot * 100, null, '', '', k)));
    note.textContent = yr === Y0 ? '2000 年没有上一年数据，请选择 2001 年及以后。' : '比较相邻两年的荒漠化等级。非锚点年份的变化由五年转移按适宜度分配到各年。比较任意两年请用“双时相对比”。';
  } else {
    const S = scopeStats(yi(yr)); h3.innerHTML = `${confLabel(yr)}<small>${scopeName()}平均 ${S.conf.toFixed(1)}%</small>`; busy();
    const ar = await areasFor('conf', yr, null, 5); if (tok !== areaTok) return; const tot = ar.reduce((a, b) => a + b, 0) || 1;
    for (let k = 4; k >= 0; k--) list.appendChild(legendRow(CONF[k].c, CONF[k].n, '', (ar[k] / tot * 100).toFixed(1), '%', ar[k] / tot * 100, null, '', '', k));
    note.textContent = M.isAnchor(yr) && yr <= BASE ? '历史锚点年份：1.0 表示格网具有完整代理观测输入，不代表官方调查准确率。' :
      '插值与预测年份：相对于最近五年锚点的条件概率，在每个五年区间内逐步下降、到下一锚点回升。';
  }
  } catch (e) { note.textContent = '数据载入失败：' + e.message; }
  box.classList.remove('busy'); finish();
}

/* =================== 情景对比 =================== */
const SC_COL = ['#2E8B57', '#1B252B', '#C8102E'];
function renderScnCmp() {
  const box = $('lgScn'); if (!box || !M.SCN) return;
  const yr = state.cmp ? state.yB : state.year, k = yi(yr), codes = M.SC.codes, cur = M.scn, sc = state.scope;
  const calOf = (c, kk) => { const C = M.scnCal(c); return (sc < 0 ? C.nw : C.prov[sc])[kk]; }, rowsOf = c => calOf(c, k);
  const pairPct = c => { if (c === 'ssp245' || yr <= BASE || sc >= 0) return null; const pr = M.SCN.pairs[c === 'ssp126' ? 'ssp126|ssp245' : 'ssp245|ssp585']; return pr ? pr[yr - 2026][0] : null; };
  const tr = codes.map((c, i) => { const r = rowsOf(c), p = pairPct(c), comp = r[6] != null ? r[6] : r[4];
    return `<button class="scr${c === cur ? ' on' : ''}" data-pick="${c}"><i style="background:${SC_COL[i]}"></i><span class="n">${M.SC.names[i]}</span><b class="num">${f1(W10(r[0]))}</b><b class="num">${comp.toFixed(3)}</b><span class="num p">${p == null ? '—' : p.toFixed(2) + '%'}</span></button>`; }).join('');
  // 2025–2050 综合风险小图
  const W = 268, H = 74, x0 = 26, x1 = W - 6, y0 = 6, y1 = H - 14, ys = YEARS.filter(y => y >= BASE);
  const ser = codes.map(c => ys.map(y => { const r = calOf(c, yi(y)); return r[6] != null ? r[6] : r[4]; }));
  let mn = Math.min(...ser.flat()), mx = Math.max(...ser.flat()); const pd = Math.max(.005, (mx - mn) * .1); mn -= pd; mx += pd;
  const X = y => x0 + (y - BASE) / (Y1 - BASE) * (x1 - x0), Yv = v => y1 - (v - mn) / (mx - mn) * (y1 - y0);
  const lines = ser.map((a, i) => `<path d="M${a.map((v, j) => `${X(ys[j]).toFixed(1)},${Yv(v).toFixed(1)}`).join('L')}" fill="none" stroke="${SC_COL[i]}" stroke-width="${codes[i] === cur ? 2.2 : 1.3}" ${codes[i] === cur ? '' : 'stroke-dasharray="4 3" opacity=".8"'}/>`).join('');
  const mk = yr > BASE ? `<line x1="${X(yr)}" x2="${X(yr)}" y1="${y0}" y2="${y1}" stroke="#E3A229" stroke-width="1.5"/>` : '';
  box.innerHTML = `<h3>气候情景对比<small>${scopeName()}　${yr} 年</small></h3>
    <div class="sct"><div class="sch"><span></span><span>情景</span><span>面积 万km²</span><span>综合风险</span><span title="与 SSP2-4.5 等级不同的格网占比（全区）">格网差异</span></div>${tr}</div>
    <svg class="scs" viewBox="0 0 ${W} ${H}" aria-label="三情景综合风险 2025–2050">${lines}${mk}
      <text x="${x0}" y="${H - 2}" font-size="10" fill="#737D82">2025</text><text x="${x1}" y="${H - 2}" font-size="10" fill="#737D82" text-anchor="end">2050</text>
      <text x="${x0 - 4}" y="${Yv(mx - pd) + 4}" font-size="9.5" fill="#9AA29C" text-anchor="end">${(mx - pd).toFixed(2)}</text><text x="${x0 - 4}" y="${Yv(mn + pd) + 4}" font-size="9.5" fill="#9AA29C" text-anchor="end">${(mn + pd).toFixed(2)}</text></svg>
    <p class="note">${yr <= BASE ? '2025 年及以前为共同历史，三情景相同。' : '三情景只替换气候场，面积差别很小；综合风险的差别主要来自降水亏缺和增温分量，取自单一气候模式的单年场，年际波动较大。'}点击可切换情景。</p>`;
  box.querySelectorAll('[data-pick]').forEach(b => b.onclick = () => pickScenario(b.dataset.pick));
}

/* =================== hotspots =================== */
function hotList() {
  const zh = state.scope < 0 ? null : M.PROVS[state.scope], minA = zh ? 800 : 2000, K = CORE.kpiCounty, a = yi(BASE), b = yi(Y1);
  const c = M.county.filter(c => c.A >= minA && (!zh || c.p === zh)).map(c => ({ i: c.i, d: K[c.i][b][0] - K[c.i][a][0] }));
  return { up: [...c].sort((x, y) => y.d - x.d).slice(0, 4).filter(x => x.d > 0), down: [...c].sort((x, y) => x.d - y.d).slice(0, 2).filter(x => x.d < 0) };
}
function renderHot() {
  const hy = [BASE, Y1, state.cmp ? state.yB : state.year]; if (!whenReady('hot', () => M.hasYears(hy), () => M.needYears(hy), renderHot)) return;
  const ul = $('hot'); ul.innerHTML = ''; gPins.innerHTML = ''; mv.fixed = mv.fixed.filter(f => !f.pin);
  const { up, down } = hotList(), k = yi(state.cmp ? state.yB : state.year);
  const add = (h, good) => {
    const c = M.county[h.i], ri = CORE.kpiCounty[h.i][k][0], cl = M.levelOf(ri), li = html('li'), b = html('button');
    b.innerHTML = `<span><b>${c.n}</b><small>${c.p}　${M.fmtInt(c.A)} km²</small></span><span class="chip" style="background:${COL[cl]};color:${cl >= 3 ? '#fff' : '#1B252B'}">${NAMES[cl]}</span><span class="tr ${good ? 'dn' : 'up'}">${good ? '↓' : '↑'} ${Math.abs(h.d).toFixed(3)}</span>`;
    b.title = `风险指数（0–1）${BASE} 年 ${CORE.kpiCounty[h.i][yi(BASE)][0].toFixed(3)} → ${Y1} 年 ${CORE.kpiCounty[h.i][yi(Y1)][0].toFixed(3)}`;
    if (state.county === h.i) b.classList.add('sel'); b.onclick = () => selectCounty(h.i, true); li.appendChild(b); ul.appendChild(li);
    const g = mv.pinGroup(gPins, c.lp[0], c.lp[1]); mv.fixed[mv.fixed.length - 1].pin = true;
    el('rect', { x: -6, y: -6, width: 12, height: 12, transform: 'rotate(45)', fill: good ? DN : '#1B252B', stroke: good ? '#fff' : '#E3A229', 'stroke-width': 2.2 }, g);
    const t = el('text', { x: 11, y: 4, 'font-size': 12.5, 'font-weight': 600, fill: '#1B252B', stroke: '#fff', 'stroke-width': 3.5, 'paint-order': 'stroke', 'stroke-linejoin': 'round' }, g); t.textContent = c.n;
  };
  if (up.length) { ul.appendChild(Object.assign(html('li', 'sub'), { textContent: '风险指数上升最多' })); up.forEach(h => add(h, false)); }
  if (down.length) { ul.appendChild(Object.assign(html('li', 'sub'), { textContent: '风险指数下降最多' })); down.forEach(h => add(h, true)); }
}

/* =================== county card & tooltip =================== */
function selectCounty(i, zoom) {
  state.county = i;
  if (i === null) { selHalo.setAttribute('d', ''); selLine.setAttribute('d', ''); $('ccard').hidden = true; renderHot(); return; }
  const c = M.county[i]; selHalo.setAttribute('d', c.d); selLine.setAttribute('d', c.d);
  if (zoom) { const v = mv.fitBox(c.bb, 60, { right: 300 }); v.s = Math.min(v.s, mv.maxS); mv.setView(v, true); }
  renderCard(); renderHot();
}
function renderCard() {
  const i = state.county; if (i === null) return;
  const pi = M.PROVS.indexOf(M.county[i].p); if (!whenReady('card', () => M.hasProv(pi), () => M.needProv(pi), renderCard)) return;
  const c = M.county[i], yr = state.cmp ? state.yB : state.year, k = yi(yr), K = CORE.kpiCounty[i], cls = CORE.county[i][k], box = $('ccard');
  const pts = YEARS.map((y, j) => [8 + j * (244 / (YEARS.length - 1)), 52 - K[j][0] * 44]), cx = pts[k], bi = yi(BASE), lvl = M.levelOf(K[k][0]);
  box.innerHTML = `<div class="th"><b>${c.n}</b><small>${c.p}　${M.geo.city[c.c].n}</small><button class="x" aria-label="关闭">×</button></div>
   <div class="bd"><div class="kv">
     <span>统计面积</span><b>${M.fmtInt(c.A)} km²</b>
     <span>${yr} 年风险指数</span><b><span class="chip" style="background:${COL[lvl]};color:${lvl >= 3 ? '#fff' : '#1B252B'}">${NAMES[lvl]}</span> ${K[k][0].toFixed(3)}</b>
     <span>荒漠化占比</span><b>${K[k][1].toFixed(1)}%</b>
     <span>重度及以上占比</span><b>${K[k][2].toFixed(1)}%</b>
     <span>${confLabel(yr)}</span><b>${K[k][3].toFixed(1)}%</b></div>
     <div class="bars">${cls.map((a, j) => `<i style="flex:${a};background:${COL[j]}"></i>`).join('')}</div>
     <svg viewBox="0 0 260 66" width="100%" height="66" aria-label="风险指数 2000–2050">
       <line x1="${pts[bi][0]}" x2="${pts[bi][0]}" y1="4" y2="54" stroke="#CDD2CC" stroke-dasharray="2 3"/>
       <path d="M${pts.slice(0, bi + 1).map(p => p.join(',')).join('L')}" fill="none" stroke="#1A3441" stroke-width="2"/>
       <path d="M${pts.slice(bi).map(p => p.join(',')).join('L')}" fill="none" stroke="#B97D12" stroke-width="2" stroke-dasharray="4 3"/>
       <circle cx="${cx[0]}" cy="${cx[1]}" r="4" fill="#E3A229" stroke="#1B252B" stroke-width="1.5"/>
       <text x="8" y="65" font-size="10" fill="#737D82">2000</text><text x="252" y="65" font-size="10" fill="#737D82" text-anchor="end">2050</text>
     </svg>
     <a class="more" href="region.html#a=${c.a}&y=${yr}${M.scn !== 'ssp245' ? '&sc=' + M.scn : ''}">在“地区预测”中查看 ${c.n} ›</a></div>`;
  box.hidden = false; box.querySelector('.x').onclick = () => selectCounty(null);
}
const tip = $('tip'); let hoverRaf = 0, lastEv = null, hovArr = null, hovYear = null, hovBusy = false; const hovKey = y => y + sk(y);
let hov245 = null;
async function ensureHover() { if (hovBusy) return; hovBusy = true; try { if (!CID) CID = await M.cidArr(); const y = state.cmp ? state.yB : state.year; await M.needYears([y]); if (hovYear !== hovKey(y)) { hovArr = await M.classArr(y); hov245 = y > BASE && M.scn !== 'ssp245' ? await M.classArr(y, 'ssp245') : null; hovYear = hovKey(y); } } finally { hovBusy = false; } }
function onHover(e) { lastEv = e; if (!hoverRaf) hoverRaf = requestAnimationFrame(doHover); }
function doHover() {
  hoverRaf = 0; const e = lastEv; if (!e || dragging || state.reveal < 1) { tip.hidden = true; return; }
  const yr = state.cmp ? state.yB : state.year;
  if (!CID || !hovArr || hovYear !== hovKey(yr) || !M.hasYears([yr])) { ensureHover().then(() => { if (lastEv === e) onHover(e); }); return; }
  const r = wrap.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top, [lo, la] = mv.lonlatAt(sx, sy), p = M.cellOf(lo, la);
  if (p < 0 || CID[p] === 65535 || hovArr[p] === 255) { tip.hidden = true; return; }
  const c = M.county[CID[p]], K = CORE.kpiCounty[c.i][yi(yr)], cl = hovArr[p];
  const chip = k => `<span class="chip" style="background:${COL[k]};color:${k >= 3 ? '#fff' : '#1B252B'}">${NAMES[k]}</span>`;
  const rows = `<dt>${state.cmp ? 'B ' : ''}${yr} 年格网等级</dt><dd>${chip(cl)}</dd>${hov245 ? `<dt>同年 SSP2-4.5</dt><dd>${chip(hov245[p])}</dd>` : ''}<dt>县区风险指数</dt><dd>${K[0].toFixed(3)}</dd><dt>县区荒漠化占比</dt><dd>${K[1].toFixed(1)}%</dd>`;
  tip.innerHTML = `<div class="th"><b>${c.n}</b><small>${c.p}　${lo.toFixed(2)}°E ${la.toFixed(2)}°N</small></div><dl>${rows}</dl>`;
  tip.hidden = false; const w = tip.offsetWidth, h = tip.offsetHeight;
  tip.style.left = (sx + 18 + w > mv.VW ? sx - w - 14 : sx + 18) + 'px'; tip.style.top = clamp(sy - h / 2, 8, mv.VH - h - 8) + 'px';
}

/* =================== pointer =================== */
let dragging = null;
wrap.addEventListener('pointerdown', e => {
  if (e.target.closest('.ccard,.cmode,.tip')) return; M.dragStart(e); const r = wrap.getBoundingClientRect();
  if (e.target.closest('#divHandle') || (state.cmp && state.cmpMode === 'swipe' && Math.abs(e.clientX - r.left - state.div * mv.VW) < 12)) { dragging = { type: 'div' }; $('divider').classList.add('drag'); }
  else dragging = { type: 'pan', x: e.clientX, y: e.clientY, v: { ...mv.view }, moved: false };
  wrap.setPointerCapture(e.pointerId); tip.hidden = true;
});
wrap.addEventListener('pointermove', e => {
  if (!dragging) { onHover(e); return; } const r = wrap.getBoundingClientRect();
  if (dragging.type === 'div') { state.div = clamp((e.clientX - r.left) / mv.VW, .02, .98); placeOverlays(); mv.dirty(); return; }
  const dx = e.clientX - dragging.x, dy = e.clientY - dragging.y; if (Math.hypot(dx, dy) > 4) dragging.moved = true;
  if (dragging.moved) { mv.view = { ...dragging.v, cx: dragging.v.cx - dx / mv.view.s, cy: dragging.v.cy - dy / mv.view.s }; mv.apply(); }
});
wrap.addEventListener('pointerup', async e => {
  const d = dragging; dragging = null; $('divider').classList.remove('drag');
  if (d && d.type === 'pan' && !d.moved) { if (!CID) CID = await M.cidArr(); const r = wrap.getBoundingClientRect(), [lo, la] = mv.lonlatAt(e.clientX - r.left, e.clientY - r.top), p = M.cellOf(lo, la);
    selectCounty(p < 0 || CID[p] === 65535 ? null : CID[p], false); }
});
wrap.addEventListener('pointerleave', () => { tip.hidden = true; });
$('divHandle').addEventListener('keydown', e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { state.div = clamp(state.div + (e.key === 'ArrowLeft' ? -.03 : .03), .02, .98); placeOverlays(); mv.dirty(); e.preventDefault(); } });

/* =================== timeline =================== */
const tr = $('track'), ta = $('trackArea'); let TW = 0, TX = () => 0; const tY = 104; const T = {};
function buildTimeline() {
  TW = ta.clientWidth; const TH = ta.clientHeight; tr.innerHTML = ''; tr.setAttribute('viewBox', `0 0 ${TW} ${TH}`);
  const x0 = 46, x1 = TW - 30; TX = y => x0 + (y - Y0) / (Y1 - Y0) * (x1 - x0); T.x0 = x0; T.x1 = x1;
  const ser = YEARS.map((y, k) => { const c = calS(k); return { y, v: W10(c[0]), lo: W10(c[1]), hi: W10(c[2]) }; });
  const anc = state.scope < 0 ? CAL.anchorTotal : CAL.anchorProv[state.scope];
  let mn = Math.min(...ser.map(d => Math.min(d.v, d.lo))), mx = Math.max(...ser.map(d => Math.max(d.v, d.hi))); const pad = (mx - mn) * .12 || 1; mn -= pad; mx += pad;
  const sTop = 24, sBot = 80, Ys = v => sBot - (v - mn) / (mx - mn) * (sBot - sTop);
  const t1 = el('text', { x: x0, y: 15, 'font-size': 11.5, fill: '#737D82' }, tr); t1.textContent = TW < 560 ? `${scopeName()}荒漠化面积（万km²）` : `${scopeName()}荒漠化土地面积（万km²，按 ${CAL.anchorYear} 年官方调查校准）`;
  const t2 = el('text', { x: x1, y: 15, 'font-size': 11.5, fill: '#737D82', 'text-anchor': 'end' }, tr); t2.textContent = TW < 560 ? '' : '阴影为 90% 区间';
  [mn + pad, (mn + mx) / 2, mx - pad].forEach(v => { el('line', { x1: x0, x2: x1, y1: Ys(v), y2: Ys(v), stroke: '#E1E4DF' }, tr); const t = el('text', { x: x0 - 6, y: Ys(v) + 4, 'font-size': 10, 'text-anchor': 'end', fill: '#9AA29C', 'font-family': 'Bahnschrift, Inter, sans-serif' }, tr); t.textContent = v.toFixed(1); });
  const band = arr => 'M' + arr.map(d => `${TX(d.y)},${Ys(d.hi)}`).join('L') + 'L' + [...arr].reverse().map(d => `${TX(d.y)},${Ys(d.lo)}`).join('L') + 'Z';
  const obs = ser.filter(d => d.y <= BASE), fc = ser.filter(d => d.y >= BASE);
  el('path', { d: band(obs), fill: '#1A3441', opacity: .12 }, tr); el('path', { d: band(fc), fill: '#E3A229', opacity: .28 }, tr);
  const ln = arr => 'M' + arr.map(d => `${TX(d.y)},${Ys(d.v)}`).join('L');
  el('path', { d: ln(obs), fill: 'none', stroke: '#1A3441', 'stroke-width': 2 }, tr); el('path', { d: ln(fc), fill: 'none', stroke: '#B97D12', 'stroke-width': 2, 'stroke-dasharray': '5 3' }, tr);
  ser.filter(d => M.isAnchor(d.y)).forEach(d => el('circle', { cx: TX(d.y), cy: Ys(d.v), r: 2.8, fill: d.y <= BASE ? '#1A3441' : '#B97D12' }, tr));
  { const ax = TX(CAL.anchorYear), ay = Ys(W10(anc)), g = el('g', {}, tr); g.appendChild(Object.assign(document.createElementNS('http://www.w3.org/2000/svg', 'title'), { textContent: `${CAL.anchorYear} 年官方荒漠化调查面积 ${f1(W10(anc))} 万km²（校准锚点）` }));
    el('rect', { x: ax - 4.5, y: ay - 4.5, width: 9, height: 9, transform: `rotate(45 ${ax} ${ay})`, fill: '#fff', stroke: '#C8102E', 'stroke-width': 2 }, g);
    const t = el('text', { x: ax, y: ay + 17, 'text-anchor': 'middle', 'font-size': 10.5, 'font-weight': 700, fill: '#C8102E' }, g); t.textContent = `${CAL.anchorYear} 官方 ${f1(W10(anc))}`; }
  el('rect', { x: x0, y: tY - 4, width: x1 - x0, height: 8, fill: '#DCE0DA' }, tr);
  el('rect', { x: x0, y: tY - 4, width: TX(BASE + .5) - x0, height: 8, fill: '#1A3441' }, tr);
  const pat = el('pattern', { id: 'hatch', width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, el('defs', {}, tr));
  el('rect', { width: 6, height: 6, fill: '#F1D79A' }, pat); el('rect', { width: 2.4, height: 6, fill: '#E3A229' }, pat);
  el('rect', { x: TX(BASE + .5), y: tY - 4, width: x1 - TX(BASE + .5), height: 8, fill: 'url(#hatch)' }, tr);
  T.range = el('rect', { y: tY - 6, height: 12, fill: 'none', stroke: '#1B252B', 'stroke-width': 1.5, opacity: 0 }, tr);
  T.labels = [];
  YEARS.forEach(y => { const a = M.isAnchor(y); el('line', { x1: TX(y), x2: TX(y), y1: tY + 7, y2: tY + (a ? 14 : 10), stroke: a ? '#4B575E' : '#B5BBB4' }, tr);
    if (a && (TW >= 560 || y % 10 === 0)) { const t = el('text', { x: TX(y), y: tY + 27, 'font-size': 11, 'text-anchor': 'middle', fill: '#4B575E', 'font-family': 'Bahnschrift, Inter, sans-serif' }, tr); t.textContent = y; T.labels.push({ t, y }); } });
  const c1 = el('text', { x: x0, y: tY + 42, 'font-size': 11.5, fill: '#1A3441', 'font-weight': 600 }, tr); c1.textContent = '代理观测 2000–2025　长刻度为五年锚点';
  const c2 = el('text', { x: x1, y: tY + 42, 'font-size': 11.5, fill: '#9A6408', 'font-weight': 600, 'text-anchor': 'end' }, tr); c2.textContent = `${M.scnName()} 预测 2026–2050`;
  const mk = (color, letter, lc, fill) => { const g = el('g', {}, tr), ln_ = el('line', { y1: sTop - 4, y2: tY, stroke: color, 'stroke-width': 1.2 }, g), dot = el('circle', { r: 4.5, fill: '#fff', stroke: color, 'stroke-width': 2 }, g);
    const lg = el('g', {}, g); el('rect', { width: 56, height: 20, fill: color }, lg); const lt = el('text', { x: 28, y: 14, 'font-size': 12, 'text-anchor': 'middle', fill: '#fff', 'font-weight': 700, 'font-family': 'Bahnschrift, Inter, sans-serif' }, lg);
    const th = el('g', { class: 'thumb' }, g); el('rect', { x: -11, y: tY - 11, width: 22, height: 22, fill, stroke: '#1B252B', 'stroke-width': 2.2 }, th);
    const grip = el('g', {}, th); el('line', { x1: -3, x2: -3, y1: tY - 5, y2: tY + 5, stroke: '#1B252B', 'stroke-width': 1.4 }, grip); el('line', { x1: 3, x2: 3, y1: tY - 5, y2: tY + 5, stroke: '#1B252B', 'stroke-width': 1.4 }, grip);
    const l2 = el('text', { y: tY + 4.5, 'font-size': 12.5, 'text-anchor': 'middle', fill: lc, 'font-weight': 800, 'font-family': 'Bahnschrift, Inter, sans-serif' }, th); l2.textContent = letter;
    const yl = el('text', { y: tY + 27, 'font-size': 12.5, 'text-anchor': 'middle', fill: '#1B252B', 'font-weight': 800, 'font-family': 'Bahnschrift, Inter, sans-serif' }, g);
    return { g, ln: ln_, dot, lg, lt, th, grip, l2, yl }; };
  T.A = mk('#1A3441', 'A', '#fff', '#1A3441'); T.B = mk('#1B252B', 'B', '#1B252B', '#E3A229'); T.Ys = Ys; T.ser = ser; placeThumbs();
}
let dragYear = null;
function placeThumbs() {
  if (!T.B) return;
  const put_ = (o, yv, show) => { o.g.style.display = show ? '' : 'none'; if (!show) return; const x = TX(yv), sy = Math.round(yv), d = T.ser[yi(sy)], cy = T.Ys(d.v);
    o.th.setAttribute('transform', `translate(${x},0)`); o.ln.setAttribute('x1', TX(sy)); o.ln.setAttribute('x2', TX(sy)); o.dot.setAttribute('cx', TX(sy)); o.dot.setAttribute('cy', cy);
    o.lt.textContent = d.v.toFixed(1); o.lg.setAttribute('transform', `translate(${TX(sy) + (TX(sy) > T.x1 - 70 ? -64 : 8)},${cy - 24})`); o.yl.setAttribute('x', x); o.yl.textContent = sy; };
  const bY = state.cmp ? (dragYear && dragYear.k === 'B' ? dragYear.v : state.yB) : (dragYear ? dragYear.v : state.year), aY = dragYear && dragYear.k === 'A' ? dragYear.v : state.yA;
  put_(T.B, bY, true); put_(T.A, aY, state.cmp); T.B.grip.style.display = state.cmp ? 'none' : ''; T.B.l2.style.display = state.cmp ? '' : 'none';
  T.range.style.opacity = state.cmp ? 1 : 0; if (state.cmp) { T.range.setAttribute('x', Math.min(TX(aY), TX(bY))); T.range.setAttribute('width', Math.abs(TX(bY) - TX(aY))); }
  T.labels.forEach(({ t, y }) => { let dm = Math.abs(TX(y) - TX(Math.round(bY))); if (state.cmp) dm = Math.min(dm, Math.abs(TX(y) - TX(Math.round(aY)))); t.style.opacity = dm < 34 ? 0 : 1; });
}
const yearFromX = px => clamp(Y0 + (px - T.x0) / (T.x1 - T.x0) * (Y1 - Y0), Y0, Y1);
ta.addEventListener('pointerdown', e => { M.dragStart(e); ta.focus({ preventScroll: true }); const r = ta.getBoundingClientRect(), yv = yearFromX((e.clientX - r.left) * TW / r.width);
  let k = 'B'; if (state.cmp) k = Math.abs(yv - state.yA) < Math.abs(yv - state.yB) ? 'A' : 'B'; dragYear = { k, v: yv }; ta.setPointerCapture(e.pointerId); stopPlay(); onDragYear(); });
ta.addEventListener('pointermove', e => { if (!dragYear) return; const r = ta.getBoundingClientRect(); dragYear.v = yearFromX((e.clientX - r.left) * TW / r.width); onDragYear(); });
ta.addEventListener('pointerup', () => { if (!dragYear) return; dragYear = null; placeThumbs(); });
function onDragYear() { const sy = Math.round(dragYear.v);
  if (state.cmp) { if (dragYear.k === 'A' && sy !== state.yA) setCompare(sy, state.yB); else if (dragYear.k === 'B' && sy !== state.yB) setCompare(state.yA, sy); }
  else if (sy !== state.year) setYear(sy); placeThumbs(); }
ta.tabIndex = 0; ta.setAttribute('role', 'slider'); ta.setAttribute('aria-label', '年份'); ta.setAttribute('aria-valuemin', Y0); ta.setAttribute('aria-valuemax', Y1);
ta.addEventListener('keydown', e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); const d = (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 5 : 1);
  if (state.cmp) setCompare(state.yA, clamp(state.yB + d, Y0, Y1)); else setYear(clamp(state.year + d, Y0, Y1)); } });

/* =================== setters =================== */
function setYear(y) {
  y = clamp(Math.round(y), Y0, Y1); if (y === state.year) return;
  const from = keyOf(state.layer, state.year); fade = SRC.has(from) && !M.REDUCE ? { from, t0: performance.now() } : null;
  state.year = y; ta.setAttribute('aria-valuenow', y); updateAll(); if (M.scn !== 'ssp245' || location.hash) setHash(); prepare().then(() => { if (fade) fade.t0 = performance.now(); mv.dirty(); });
  prefetch(y + 1);
}
function setCompare(a, b) { state.yA = a; state.yB = b; updateAll(); prepare(); }
function updateAll(rebuild) {
  const y = state.year;
  $('ybY').textContent = y; if ($('hint').textContent && !/可选年份/.test($('hint').textContent)) $('hint').textContent = M.isAnchor(y) ? '' : `${y} 年为${M.statusZh(y)}结果`; $('ybTag').textContent = M.statusZh(y); $('ybSc').textContent = M.scnOf(y);
  $('yb2a').textContent = state.yA; $('yb2b').textContent = state.yB; $('yearIn').value = y; $('selA').value = state.yA; $('selB').value = state.yB;
  $('chipAy').textContent = state.yA; $('chipBy').textContent = state.yB; $('chipAt').textContent = M.statusZh(state.yA); $('chipBt').textContent = M.statusZh(state.yB);
  renderOverview(); renderLegend(); renderScnCmp(); renderHot(); if (state.county !== null) renderCard();
  if (rebuild) buildTimeline(); else placeThumbs(); placeOverlays(); mv.dirty();
}

/* =================== 气候情景 =================== */
let syncScn = () => {};
function pickScenario(c) {
  if (c === M.scn) return; const prev = M.scn, from = state.cmp ? null : keyOf(state.layer, state.year, null, prev);
  if (!M.setScenario(c)) return; syncScn();
  fade = from && SRC.has(from) && !M.REDUCE && state.year > BASE ? { from, t0: performance.now() } : null;
  if (c === 'ssp245' && state.layer === 'sdiff') setLayer('level');
  syncLayerBtns(); setHash(); updateAll(true); prepare().then(() => { if (fade) fade.t0 = performance.now(); mv.dirty(); });
}
function setHash() { const p = new URLSearchParams(); if (M.scn !== 'ssp245') p.set('sc', M.scn); if (state.year !== BASE) p.set('y', state.year);
  const h = p.toString(); history.replaceState(null, '', h ? '#' + h : location.pathname + location.search); }

/* =================== controls =================== */
function syncLayerBtns() {
  const sd = document.querySelector('[data-layer="sdiff"]'); if (!sd) return;
  sd.disabled = M.scn === 'ssp245' || (state.cmp && state.cmpMode === 'diff');
  sd.title = M.scn === 'ssp245' ? '先选择 SSP1-2.6 或 SSP5-8.5，再查看它与 SSP2-4.5 的格网差异' : `${M.scnName()} 与 SSP2-4.5 在同一年份的等级差异`;
}
function setLayer(l) { state.layer = l; state.hi = null; fade = null; document.querySelectorAll('[data-layer]').forEach(x => x.classList.toggle('on', x.dataset.layer === l)); }
document.querySelectorAll('[data-layer]').forEach(b => b.onclick = () => {
  if (state.cmp && state.cmpMode === 'diff') return;
  if (b.dataset.layer === 'sdiff') { if (M.scn === 'ssp245') { M.toast('先在“气候情景”中选择 SSP1-2.6 或 SSP5-8.5'); return; }
    if (state.cmp) setCmp(false); if (state.year <= BASE) { M.toast('2025 年及以前三情景相同，已跳到 2050 年'); state.year = Y1; } }
  document.querySelectorAll('[data-layer]').forEach(x => x.classList.toggle('on', x === b)); state.layer = b.dataset.layer; state.hi = null; fade = null;
  if (state.layer === 'change' && state.year === Y0 && !state.cmp) { M.toast('2000 年为起始年，已显示 2000→2001 年的变化'); state.year = 2001; }
  updateAll(); prepare();
});
function setCmp(on) {
  state.cmp = on; stopPlay(); state.hi = null;
  $('cmpBtn').setAttribute('aria-pressed', on);
  if (on && state.layer === 'sdiff') setLayer('level');
  if (on) { const c = state.year; if (c > BASE) { state.yA = BASE; state.yB = c; } else if (c < BASE) { state.yA = c; state.yB = BASE; } else { state.yA = BASE; state.yB = Y1; } state.div = .5; }
  ['chipA', 'chipB', 'cmode', 'yb2', 'j2'].forEach(id => $(id).hidden = !on); $('yb1').hidden = on; $('j1').hidden = on;
  $('divider').hidden = !on || state.cmpMode === 'diff';
  document.querySelectorAll('[data-layer]').forEach(x => x.disabled = on && state.cmpMode === 'diff'); syncLayerBtns();
  updateAll(); prepare();
}
{ const g = document.querySelector('.map-head [data-scn]'); if (g) { syncScn = M.bindScenario(g.parentNode, () => {}); g.parentNode.querySelectorAll('[data-scn]').forEach(b => b.onclick = () => pickScenario(b.dataset.scn)); } }
$('cmpBtn').onclick = () => setCmp(!state.cmp); $('exitCmp').onclick = () => setCmp(false);
document.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => {
  state.cmpMode = b.dataset.mode; state.hi = null; document.querySelectorAll('[data-mode]').forEach(x => x.classList.toggle('on', x === b));
  $('divider').hidden = state.cmpMode === 'diff'; document.querySelectorAll('[data-layer]').forEach(x => x.disabled = state.cmpMode === 'diff'); syncLayerBtns(); updateAll(); prepare();
});
[$('selA'), $('selB')].forEach(s => YEARS.forEach(y => s.appendChild(Object.assign(document.createElement('option'), { value: y, textContent: y + (y > BASE ? ' 预测' : ' 观测') + (M.isAnchor(y) ? ' ●' : '') }))));
$('selA').onchange = () => setCompare(+$('selA').value, state.yB); $('selB').onchange = () => setCompare(state.yA, +$('selB').value); $('swapBtn').onclick = () => setCompare(state.yB, state.yA);
let playT = 0;
function stopPlay() { state.playing = false; clearTimeout(playT); $('icPlay').style.display = ''; $('icPause').style.display = 'none'; $('playBtn').setAttribute('aria-label', '播放'); }
async function tick() { if (!state.playing) return; if (state.year >= Y1) { stopPlay(); return; }
  const ny = state.year + 1; try { await Promise.all([source(state.layer, ny), M.needYears([ny])]); } catch (e) { stopPlay(); return; } if (!state.playing) return;
  setYear(ny); prefetch(ny + 1); prefetch(ny + 2); playT = setTimeout(tick, 650 / +$('speed').value); }
$('playBtn').onclick = () => { if (state.playing) { stopPlay(); return; } if (state.cmp) setCmp(false);
  state.playing = true; $('icPlay').style.display = 'none'; $('icPause').style.display = ''; $('playBtn').setAttribute('aria-label', '暂停'); if (state.year >= Y1) setYear(Y0); playT = setTimeout(tick, 200); };
$('prevBtn').onclick = () => { stopPlay(); setYear(state.year - 1); }; $('nextBtn').onclick = () => { stopPlay(); setYear(state.year + 1); };
$('yUp').onclick = () => { stopPlay(); setYear(state.year + 1); }; $('yDn').onclick = () => { stopPlay(); setYear(state.year - 1); };
function jump() { const v = parseInt($('yearIn').value, 10), hint = $('hint');
  if (!isFinite(v) || v < Y0 || v > Y1) { hint.textContent = `可选年份为 ${Y0}–${Y1} 年`; $('yearIn').value = state.year; return; }
  hint.textContent = M.isAnchor(v) ? '' : `${v} 年为${M.statusZh(v)}结果`; stopPlay(); setYear(v); }
$('goBtn').onclick = jump; $('yearIn').addEventListener('keydown', e => { if (e.key === 'Enter') jump(); }); $('yearIn').addEventListener('focus', e => e.target.select());
{ const dl = $('countyList'); M.county.forEach(c => dl.appendChild(Object.assign(document.createElement('option'), { value: `${c.n}（${c.p}）` })));
  const go = () => { const v = $('search').value.trim(); if (!v) return; const name = v.replace(/（.*）$/, '');
    let i = M.county.findIndex(c => `${c.n}（${c.p}）` === v); if (i < 0) i = M.county.findIndex(c => c.n === name); if (i < 0) i = M.county.findIndex(c => c.n.includes(name));
    if (i < 0) { M.toast(`没有找到“${v}”，请检查名称`); return; } selectCounty(i, true); };
  $('search').addEventListener('change', go); $('search').addEventListener('keydown', e => { if (e.key === 'Enter') go(); }); }
M.soonLinks();
$('savePng').onclick = async () => {
  const out = document.createElement('canvas'); out.width = mv.canvas.width; out.height = mv.canvas.height; const x = out.getContext('2d');
  x.fillStyle = '#EDEFEB'; x.fillRect(0, 0, out.width, out.height);
  const svgImg = s => new Promise(res => { const c = s.cloneNode(true); c.setAttribute('xmlns', 'http://www.w3.org/2000/svg'); c.setAttribute('font-family', 'Microsoft YaHei, PingFang SC, Noto Sans CJK SC, sans-serif');
    const img = new Image(); img.onload = () => res(img); img.onerror = () => res(null); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(c)); });
  const u = await svgImg(mv.svgU); if (u) x.drawImage(u, 0, 0, out.width, out.height); x.drawImage(mv.canvas, 0, 0);
  const o = await svgImg(mv.svgO); if (o) x.drawImage(o, 0, 0, out.width, out.height);
  x.fillStyle = '#1B252B'; x.font = `${14 * mv.DPR}px Microsoft YaHei, sans-serif`; x.fillText(state.cmp ? `西北荒漠化 ${state.yA} / ${state.yB}` : `西北荒漠化等级 ${state.year} 年（1 km，${M.scnOf(state.year)}）`, 16 * mv.DPR, out.height - 16 * mv.DPR);
  try { const a = document.createElement('a'); a.download = `northwest_${state.cmp ? state.yA + '_' + state.yB : state.year}${state.year > BASE || state.cmp ? '_' + M.scn : ''}.png`; a.href = out.toDataURL('image/png'); a.click(); } catch (err) { M.toast('当前浏览器不支持导出，请改用截图'); }
};
{ const m = CORE.model, v = m.val, VL = window.NW_VAL, fin = VL && VL.models.find(x => x.id === VL.final), base = VL && VL.models.find(x => x.id === VL.baseline);
  $('model').innerHTML = `<b>预测模型</b>　${m.name}，以 ${(m.trainSamples / 1e4).toFixed(0)} 万条 1 km 转移样本训练，耦合 ${m.climate} 气候压力（<a href="model.html" style="text-decoration:underline">模型说明</a>）。2020→2025 年独立时序验证：
    <div class="mt"><div><span>总体精度</span><b>${(v.accuracy * 100).toFixed(1)}%</b></div><div><span>Kappa</span><b>${v.cohen_kappa.toFixed(3)}</b></div><div><span>宏平均 F1</span><b>${(v.macro_f1 * 100).toFixed(1)}%</b></div></div>${fin ? `<p class="mt2">以上为逐像元分类口径。地图采用的最终链路（LightGBM + CA-Markov）：总体精度 ${(fin.m.accuracy * 100).toFixed(1)}%，Kappa ${fin.m.cohen_kappa.toFixed(3)}，略低于“等级保持不变”基线（${(base.m.accuracy * 100).toFixed(1)}%，${base.m.cohen_kappa.toFixed(3)}）。<a href="model.html#m5v" style="text-decoration:underline">混淆矩阵与逐类别指标</a></p>` : ''}
    <p class="disclaimer">荒漠化面积按 ${CAL.anchorYear} 年五省官方调查面积（合计 ${f1(W10(CAL.anchorTotal))} 万km²，<a href="${CAL.sources[0].u}" target="_blank" rel="noopener" style="text-decoration:underline">国家林草局</a>）校准；除该锚点外，逐年数值为模型年度化或预测，不是官方逐年调查值。</p>`; }

/* =================== intro =================== */
function intro() {
  const items = [...document.querySelectorAll('[data-anim]')], navs = [...document.querySelectorAll('.nav-list a, .brand, .nav-foot')];
  if (M.REDUCE || M.internal) { state.reveal = 1; renderOverview(); mv.dirty(); M.reveal(); return; }   // 站内切换回首页：不重播加载动画
  M.reveal();
  document.querySelector('nav.side').animate([{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0 0 0)' }], { duration: 550, easing: 'cubic-bezier(.2,.7,.2,1)' });
  navs.forEach((n, i) => n.animate([{ opacity: 0, transform: 'translateX(-16px)' }, { opacity: 1, transform: 'none' }], { duration: 380, delay: 300 + i * 55, easing: 'ease-out', fill: 'backwards' }));
  items.forEach((n, i) => n.animate([{ opacity: 0, transform: 'translateY(14px)' }, { opacity: 1, transform: 'none' }], { duration: 500, delay: 450 + i * 130, easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'backwards' }));
  provPaths.forEach((p, i) => { const L = p.getTotalLength(); p.animate([{ strokeDasharray: `${L} ${L}`, strokeDashoffset: L }, { strokeDasharray: `${L} ${L}`, strokeDashoffset: 0 }], { duration: 1000, delay: 900 + i * 80, easing: 'ease-in-out', fill: 'backwards' }); });
  [gLab, gPins, gCty, gCity].forEach((g, i) => g.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 500, delay: 2300 + i * 150, fill: 'backwards' }));
  document.querySelectorAll('.lv, .hot li, .ramp i').forEach((n, i) => n.animate([{ opacity: 0, transform: 'translateX(12px)' }, { opacity: 1, transform: 'none' }], { duration: 380, delay: 1200 + i * 60, easing: 'ease-out', fill: 'backwards' }));
  const t0 = performance.now();
  const step = now => { const t = (now - t0) / 1000; state.reveal = clamp((t - 1.3) / 1.1, 0, 1); renderOverview(eo(clamp((t - 1.5) / 1.1, 0, 1))); mv.dirty();
    if (t < 2.7) requestAnimationFrame(step); else { state.reveal = 1; tweens.clear(); renderOverview(); mv.dirty(); } };
  requestAnimationFrame(step);
}

/* =================== init =================== */
(async () => {
  const p = new URLSearchParams(location.hash.slice(1)); const y = +p.get('y'); if (y >= Y0 && y <= Y1) state.year = y;
  if (p.get('sc') && M.setScenario(p.get('sc'))) syncScn(); syncLayerBtns();
  try { await M.needYears([BASE, Y1, state.year]); } catch (e) { M.toast(e.message); }   // 热点县区与悬停提示所需的县区 KPI
  buildTimeline(); updateAll(); M.scaleBar($('scale'), mv);
  try { await Promise.race([source('level', state.year), new Promise(r => setTimeout(r, 900))]); } catch (e) { M.toast(e.message); }
  intro(); prefetch(state.year + 1);
  M.classArr(state.year).then(a => { M.setOccupancy(a); mv.dirty(); });
  M.cidArr().then(a => { CID = a; });
})();
})();
