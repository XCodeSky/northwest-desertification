/* 西北荒漠化灾害预测及防护平台 — 地区预测页（省 / 市州 / 县区三级） */
'use strict';
(() => {
const M = window.NWMap, CORE = window.NW_CORE, RG = window.NW_REGION, G = M.geo;
const $ = id => document.getElementById(id);
const { COL, NAMES, CONF, CHG, UP, DN, YEARS, Y0, Y1, BASE, el, clamp, lerp, eo } = M;
const yi = M.yi, GR = G.grid;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const sgn = (v, d) => { const r = +v.toFixed(d); return (r > 0 ? '+' : r < 0 ? '−' : '±') + Math.abs(r).toFixed(d); };
const chip = k => `<span class="chip ${k >= 3 ? 'dk' : 'lt'}" style="background:${COL[k]}">${NAMES[k]}</span>`;
const CAL = window.NW_CAL;
const PROV_FULL = { 新疆: '新疆维吾尔自治区', 甘肃: '甘肃省', 青海: '青海省', 宁夏: '宁夏回族自治区', 陕西: '陕西省' };
const PROV_CODE = { 新疆: '650000', 甘肃: '620000', 青海: '630000', 宁夏: '640000', 陕西: '610000' };
const LV = { '一级（紧急）': ['#9E1B32', '#fff'], '二级（优先）': ['#C4702F', '#fff'], '三级（持续）': ['#E2AE52', '#1B252B'], '四级（监测）': ['#D3DEC8', '#1B252B'] };
const LV_ORDER = Object.keys(LV);
const lvChip = (lv, fs) => { const c = LV[lv] || ['#DDE1DB', '#1B252B']; return `<span class="chip" style="background:${c[0]};color:${c[1]}${fs ? ';font-size:' + fs + 'px' : ''}">${esc(lv)}</span>`; };
const ANCH = CORE.anchors;
const confLabel = y => y <= BASE ? (M.isAnchor(y) ? '数据完整度' : '插值置信度') : '预测置信度';

/* =================== administrative units =================== */
const provIdx = n => M.PROVS.indexOf(n);
const cGB = M.county.map(c => { let lo0 = 999, lo1 = -999, la0 = 999, la1 = -999;
  for (const r of c.r) { const p = M.dec(r); for (let i = 0; i < p.length; i += 2) { lo0 = Math.min(lo0, p[i]); lo1 = Math.max(lo1, p[i]); la0 = Math.min(la0, p[i + 1]); la1 = Math.max(la1, p[i + 1]); } }
  return [clamp(Math.floor((lo0 - GR.x0) / GR.res) - 2, 0, M.GW), clamp(Math.floor((GR.y0 - la1) / GR.res) - 2, 0, M.GH), clamp(Math.ceil((lo1 - GR.x0) / GR.res) + 2, 0, M.GW), clamp(Math.ceil((GR.y0 - la0) / GR.res) + 2, 0, M.GH)]; });
const UNITS = new Map();
function mk(lv, i) {
  const key = (lv === 'county' ? 'k' : lv[0]) + i; if (UNITS.has(key)) return UNITS.get(key); let u;
  if (lv === 'prov') { const p = M.prov[i]; u = { lv, i, key, name: PROV_FULL[p.n], short: p.n, a: PROV_CODE[p.n], pi: i, ci: -1, ids: M.county.filter(c => c.p === p.n).map(c => c.i), bb: p.bb, hole: p.d, A: p.A, lp: p.lp, kpi: k => CORE.kpiProv[i][k] }; }
  else if (lv === 'city') { const c = M.city[i]; u = { lv, i, key, name: c.n, short: c.n, a: c.a, pi: provIdx(c.p), ci: i, ids: c.m, bb: c.bb, hole: c.m.map(k => M.county[k].d).join(''), A: c.A, lp: c.lp, xp: !!c.x || c.m.length === 1, kpi: k => CORE.kpiCity[i][k] }; }
  else { const c = M.county[i]; u = { lv, i, key, name: c.n, short: c.n, a: c.a, pi: provIdx(c.p), ci: c.c, ids: [i], bb: c.bb, hole: c.d, A: c.A, lp: c.lp, kpi: k => CORE.kpiCounty[i][k] }; }
  u.gb = u.ids.map(k => cGB[k]).reduce((a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]);
  UNITS.set(key, u); return u;
}
const unitOfCounty = i => { const ct = M.city[M.county[i].c]; return ct.x || ct.m.length === 1 ? mk('city', ct.i) : mk('county', i); };
const parentOf = u => u.lv === 'county' ? mk('city', u.ci) : u.lv === 'city' ? mk('prov', u.pi) : null;
const childrenOf = u => u.lv === 'prov' ? M.city.filter(c => c.p === u.short).map(c => mk('city', c.i)) : u.lv === 'city' && !u.xp ? u.ids.map(k => mk('county', k)) : [];
const peersOf = u => u.lv === 'prov' ? M.prov.map(p => mk('prov', p.i)) : childrenOf(parentOf(u));
const provPeers = u => u.lv === 'prov' ? peersOf(u) : u.lv === 'city' ? childrenOf(mk('prov', u.pi)) : M.county.filter(c => c.p === M.PROVS[u.pi] && unitOfCounty(c.i).lv === 'county').map(c => mk('county', c.i));
function rankIn(u, list, k) { const arr = list.map(x => [x, x.kpi(k)[0]]).sort((a, b) => b[1] - a[1]); return { r: arr.findIndex(e => e[0] === u) + 1, n: arr.length }; }

/* area-weighted county aggregates, aligned to the KPI basis */
const SCH = M.SCN && M.SCN.chart;   // 情景曲线：[年][情景][风险指数, 90% 下限, 上限, 置信度]，县区 / 地市 / 省级分别计算
/* 县区气象：2026 年起降水、气温随所选情景替换；地下水、大风两项代理指标与归因仍沿用 SSP2-4.5 口径 */
const metOf = (i, k) => { const S = M.SCN && M.SCN[M.scn]; if (k <= yi(BASE) || !S || !S.met) return RG.met[i][k]; const r = RG.met[i][k], q = S.met[i][k - yi(BASE) - 1]; return [q[0], q[1], r[2], r[3], r[4]]; };
function series(u) {
  if (u._s && u._s.sc === M.scn) return u._s;
  const ids = u.ids, W = ids.map(i => M.county[i].A), sw = W.reduce((a, b) => a + b, 0), met = [], att = [], scn = [], comp = [];
  YEARS.forEach((y, k) => {
    const m = [0, 0, 0, 0, 0], a = new Array(8).fill(0), s = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
    ids.forEach((i, j) => { const w = W[j] / sw; metOf(i, k).forEach((v, q) => m[q] += v * w); RG.att[i][k].forEach((v, q) => a[q] += v * w); });
    met.push(m); att.push(a); scn.push(SCH[u.lv][u.lv === 'prov' ? u.pi : u.i][k]);
    const st = u.lv === 'prov' ? M.stats.prov(u.pi, k) : M.stats.counties(ids, k); const tot = st.cls.reduce((p, q) => p + q, 0) || 1; comp.push(st.cls.map(v => v / tot * 100));
  });
  return (u._s = { met, att, scn, comp, sc: M.scn });
}

/* measures table */
const MEAS = RG.measures, countyAd = new Set(M.county.map(c => c.a));
const rec = (u, P) => (MEAS[u.a] || {})[P] || null;
const RT = RG.rt || {};   // 市州排名总数：精简版 region.js 中已预先算好（下面的循环只在完整措施表时生效）
for (const a in MEAS) { if (countyAd.has(a)) continue; const ct = M.city.find(c => c.a === a); if (!ct) continue;
  for (const P in MEAS[a]) { const r = MEAS[a][P]; RT['c|' + P] = Math.max(RT['c|' + P] || 0, r.rn); const kp = 'c|' + P + '|' + ct.p; RT[kp] = Math.max(RT[kp] || 0, r.rp); } }
const totals = (u, P) => countyAd.has(u.a) ? [RG.rankTotal.nw[P], RG.rankTotal.prov[P + '|' + M.PROVS[u.pi]]] : [RT['c|' + P], RT['c|' + P + '|' + M.PROVS[u.pi]]];

/* =================== state =================== */
const state = { lyrOpen: false, u: null, year: BASE, layer: 'level', cmp: false, yA: BASE, yB: 2035, opA: .45, opB: .9, showA: true, showB: true, onlyChg: false, playing: false };
let LBL = [], userView = false; const mapPanel = document.querySelector('.mapR');
const curY = () => state.cmp ? state.yB : state.year, refY = () => state.cmp ? state.yA : BASE;

/* =================== raster sources =================== */
const SRC = new Map(); let CID = null;
const put = (map, k, v, max) => { map.set(k, v); while (map.size > max) map.delete(map.keys().next().value); return v; };
const sk = y => y > BASE ? M.scn : '';   // 2025 年及以前三种情景共用同一套栅格
const keyOf = (layer, y) => (layer === 'level' ? 'L' : layer === 'conf' ? 'C' : 'X') + y + sk(y);
async function source(layer, y) {
  const k = keyOf(layer, y); if (SRC.has(k)) return SRC.get(k);
  if (layer === 'level') return put(SRC, k, await M.tile(M.tn('cls', y)), 8);
  if (layer === 'conf') return put(SRC, k, await M.tile(M.tn('conf', y)), 8);
  const a = await M.classArr(Math.max(Y0, y - 1)), b = await M.classArr(y), pal = CHG.map(d => M.packRGBA(d.c));
  return put(SRC, k, M.gridCanvas(i => { const B = b[i]; if (B === 255) return 0; const d = B - a[i]; return pal[d >= 2 ? 0 : d === 1 ? 1 : d === 0 ? 2 : d === -1 ? 3 : 4]; }), 8);
}

/* overlay comparison inside the selected unit */
let CMP = null;
const cmpKey = () => `${state.u.key}|${state.yA}|${state.yB}|${M.scn}`;
/* 叠加对比数据：A、B 两个等级图层 + 两张变化图（chgH：荒漠扩大 / 缩小，chgD：程度加重 / 减轻），颜色即类型。
   逐行分片计算（每帧约 8 ms），避免切换地区时阻塞缩放动画。 */
const CHG_RGB = { 1: M.packRGBA(UP), 2: M.packRGBA(DN), 3: M.packRGBA(UP), 4: M.packRGBA(DN) };
let cmpBuilding = null;
function buildCmp() {
  const key = cmpKey(); if (CMP && CMP.key === key) return Promise.resolve(CMP);
  if (cmpBuilding && cmpBuilding.key === key) return cmpBuilding.p;
  const job = { key }; job.p = (async () => {
    const u = state.u;
    const [a, b, cid] = await Promise.all([M.classArr(state.yA), M.classArr(state.yB), M.cidArr()]); CID = cid;
    if (key !== cmpKey()) return null;
    const inU = new Uint8Array(M.county.length); u.ids.forEach(i => inU[i] = 1);
    const [j0, i0, j1, i1] = u.gb, w = Math.max(1, j1 - j0), h = Math.max(1, i1 - i0), GW = M.GW;
    const imA = new ImageData(w, h), imB = new ImageData(w, h), imH = new ImageData(w, h), imD = new ImageData(w, h);
    const uA = new Uint32Array(imA.data.buffer), uB = new Uint32Array(imB.data.buffer), uH = new Uint32Array(imH.data.buffer), uD = new Uint32Array(imD.data.buffer);
    const pal = COL.map(c => M.packRGBA(c));
    const Bk = Math.max(2, Math.ceil(Math.max(w, h) / 110)), bw = Math.ceil(w / Bk), bh = Math.ceil(h / Bk), NB = bw * bh;
    const acc = () => ({ a: new Float64Array(NB), n: new Uint16Array(NB), x: new Float64Array(NB), y: new Float64Array(NB) }), BE = acc(), BS = acc();
    let e = 0, sh = 0, wo = 0, be = 0, tot = 0, dA = 0, dB = 0, t0 = performance.now();
    for (let i = i0; i < i1; i++) {
      if (performance.now() - t0 > 8) { await new Promise(requestAnimationFrame); if (key !== cmpKey()) return null; t0 = performance.now(); }
      const ra = M.rowArea[i], lat = GR.y0 - GR.res * (i + .5), bi = ((i - i0) / Bk | 0) * bw, row = (i - i0) * w - j0;
      for (let j = j0; j < j1; j++) {
        const p = i * GW + j, c = cid[p]; if (c === 65535 || !inU[c]) continue; const A = a[p], B = b[p]; if (A === 255 || B === 255) continue;
        const q = row + j; uA[q] = pal[A]; if (B > 0) uB[q] = pal[B]; tot += ra; if (A > 0) dA += ra; if (B > 0) dB += ra;
        let t = 0, T = null;
        if (A === 0 && B > 0) { t = 1; e += ra; T = BE; } else if (A > 0 && B === 0) { t = 2; sh += ra; T = BS; } else if (B > A) { t = 3; wo += ra; } else if (B < A) { t = 4; be += ra; }
        if (t) (t < 3 ? uH : uD)[q] = CHG_RGB[t];
        if (T) { const bk = bi + ((j - j0) / Bk | 0), lon = GR.x0 + GR.res * (j + .5); T.a[bk] += ra; T.n[bk]++; T.x[bk] += lon * ra; T.y[bk] += lat * ra; }
      }
    }
    const cv = im => { const c = M.cropCanvas(w, h, j0, i0); c.getContext('2d').putImageData(im, 0, 0); return c; };
    const comps = (T, type) => {   // connected patches on a coarse block grid
      const thr = Math.max(1, .1 * Bk * Bk), lab = new Int32Array(NB).fill(-1), out = [];
      for (let s0 = 0; s0 < NB; s0++) { if (lab[s0] >= 0 || T.n[s0] < thr) continue;
        const st = [s0]; lab[s0] = out.length; let A = 0, X = 0, Y = 0;
        while (st.length) { const q = st.pop(); A += T.a[q]; X += T.x[q]; Y += T.y[q]; const r = q / bw | 0, c = q % bw;
          for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) { const rr = r + dr, cc = c + dc; if (rr < 0 || cc < 0 || rr >= bh || cc >= bw) continue; const n = rr * bw + cc; if (lab[n] < 0 && T.n[n] >= thr) { lab[n] = out.length; st.push(n); } } }
        out.push({ type, A, lon: X / A, lat: Y / A }); }
      return out.filter(o => o.A >= Math.max(5, tot * .002)).sort((p, q) => q.A - p.A).slice(0, 2);
    };
    if (key !== cmpKey()) return null;
    CMP = { key, w, h, j0, i0, a: cv(imA), b: cv(imB), chgH: cv(imH), chgD: cv(imD), base: null, baseKey: '',
            st: { e, s: sh, wo, be, tot, dA, dB }, comps: [...comps(BE, 'e'), ...comps(BS, 's')], coEls: null };
    CMP.fadeT0 = performance.now(); hatchCache.key = '';
    return CMP;
  })();
  cmpBuilding = job; job.p.finally(() => { if (cmpBuilding === job) cmpBuilding = null; });
  return job.p;
}
/* A（下）+ B（上）按当前不透明度预先合成为一张图，每帧只绘制一次 */
function cmpBase(C) {
  const fA = state.onlyChg ? .16 : state.opA, fB = state.onlyChg ? .2 : state.opB, k = `${state.showA ? fA : 0}|${state.showB ? fB : 0}`;
  if (C.base && C.baseKey === k) return C.base;
  const c = C.base || M.cropCanvas(C.w, C.h, C.j0, C.i0), x = c.getContext('2d'); x.clearRect(0, 0, C.w, C.h);
  if (state.showA) { x.globalAlpha = fA; x.drawImage(C.a, 0, 0); } if (state.showB) { x.globalAlpha = fB; x.drawImage(C.b, 0, 0); } x.globalAlpha = 1;
  C.base = c; C.baseKey = k; return c;
}

let loadTok = 0;
async function prepare() {
  const tok = ++loadTok, need = [];
  if (!state.cmp) need.push(source(state.layer, state.year)); else { need.push(source('level', state.yB)); need.push(buildCmp()); }
  const t = setTimeout(() => { if (tok === loadTok) { $('loading').hidden = false; $('loadingY').textContent = state.cmp ? `${state.yA}/${state.yB}` : state.year; } }, 160);
  try { await Promise.all(need); } catch (e) { M.toast(e.message); }
  clearTimeout(t); if (tok !== loadTok) return; $('loading').hidden = true;
  if (state.cmp) { renderCstat(); renderCallouts(); }
  mv.dirty();
}
const prefetch = y => { if (y >= Y0 && y <= Y1) source(state.layer, y).catch(() => {}); };

/* =================== map =================== */
const wrap = $('mapwrap'), rl = $('rlayer'), leaders = $('leaders');
let fade = null;
const mv = new M.MapView(wrap, { onRender: draw, onView: () => { lastMove = performance.now(); M.scaleBar($('scale'), mv); placeLabels(); renderCallouts(); } });
const drawKey = (k, opt) => { const s = SRC.get(k); if (s) mv.drawGrid(s, opt); return !!s; };
let holeP = null;
function clipOutside(fn) { const x = mv.ctx, v = mv.view, D = mv.DPR; x.save(); x.setTransform(v.s * D, 0, 0, v.s * D, (mv.VW / 2 - v.cx * v.s) * D, (mv.VH / 2 - v.cy * v.s) * D); x.clip(holeP, 'evenodd'); fn(); x.restore(); }
const PATT = {};
function patt(color, kind, rot) { const k = color + kind + rot; if (PATT[k]) return PATT[k]; const c = document.createElement('canvas'), x = c.getContext('2d');
  if (kind === 'hatch') { c.width = c.height = 7; x.fillStyle = color; x.fillRect(0, 0, 2.4, 7); } else { c.width = c.height = 6; x.fillStyle = color; x.beginPath(); x.arc(3, 3, 1.5, 0, 7); x.fill(); }
  const p = mv.ctx.createPattern(c, 'repeat'); if (rot) p.setTransform(new DOMMatrix().rotateSelf(rot)); return (PATT[k] = p); }
/* 斜线 / 点纹在屏幕空间生成：直接用带颜色的变化图做合成（颜色随类型保留），结果按视图缓存 */
const hatchCache = { key: '', cv: document.createElement('canvas'), tmp: document.createElement('canvas') };
function cutPattern(kind) { const k = 'cut' + kind; if (PATT[k]) return PATT[k]; const c = document.createElement('canvas'), x = c.getContext('2d');
  if (kind === 'hatch') { c.width = c.height = 7; x.fillRect(2.4, 0, 4.6, 7); } else { c.width = c.height = 6; x.beginPath(); x.arc(3, 3, 1.6, 0, 7); x.fill(); }
  const p = mv.ctx.createPattern(c, 'repeat'); if (kind === 'hatch') p.setTransform(new DOMMatrix().rotateSelf(45)); return (PATT[k] = p); }
function hatchLayer(C) {
  const v = mv.view, key = `${C.key}|${v.cx.toFixed(4)}|${v.cy.toFixed(4)}|${v.s.toFixed(5)}|${mv.canvas.width}x${mv.canvas.height}`;
  const hc = hatchCache.cv; if (hatchCache.key === key) return hc;
  const W = mv.canvas.width, H = mv.canvas.height, f = mv.frame, fx = mv.fx, o = hatchCache.tmp, d = Math.max(1.5, 1.6 * mv.DPR);
  if (hc.width !== W || hc.height !== H) { hc.width = o.width = W; hc.height = o.height = H; }
  const hx = hc.getContext('2d'), ox = o.getContext('2d'); hx.setTransform(1, 0, 0, 1, 0, 0); hx.clearRect(0, 0, W, H);
  // 程度加重 / 减轻：点纹
  fx.setTransform(1, 0, 0, 1, 0, 0); fx.clearRect(0, 0, W, H); mv.drawGrid(C.chgD, { ctx: fx }); fx.setTransform(1, 0, 0, 1, 0, 0);
  fx.globalCompositeOperation = 'destination-in'; fx.fillStyle = cutPattern('dot'); fx.fillRect(0, 0, W, H); fx.globalCompositeOperation = 'source-over';
  hx.drawImage(f, 0, 0);
  // 荒漠扩大 / 缩小：斜线 + 外轮廓
  fx.clearRect(0, 0, W, H); mv.drawGrid(C.chgH, { ctx: fx }); fx.setTransform(1, 0, 0, 1, 0, 0);
  ox.globalCompositeOperation = 'source-over'; ox.clearRect(0, 0, W, H);
  for (const [a, b] of [[-d, 0], [d, 0], [0, -d], [0, d]]) ox.drawImage(f, a, b);
  ox.globalCompositeOperation = 'destination-out'; ox.drawImage(f, 0, 0); ox.globalCompositeOperation = 'source-over';
  fx.globalCompositeOperation = 'destination-out'; fx.fillStyle = cutPattern('hatch'); fx.fillRect(0, 0, W, H); fx.globalCompositeOperation = 'source-over';
  hx.drawImage(f, 0, 0); hx.drawImage(o, 0, 0);
  fx.clearRect(0, 0, W, H); hatchCache.key = key; return hc;
}
let lastMove = 0, settleT = 0;
function draw() {
  if (!state.u) return;
  if (!state.cmp) {
    const cur = keyOf(state.layer, state.year);
    if (fade && SRC.has(fade.from) && SRC.has(cur) && fade.from !== cur) { const p = clamp((performance.now() - fade.t0) / 360, 0, 1);
      drawKey(fade.from); mv.drawGrid(SRC.get(cur), { viaFrame: true, alpha: eo(p) }); if (p < 1) mv.dirty(); else fade = null; }
    else if (!drawKey(cur) && fade && SRC.has(fade.from)) drawKey(fade.from);
    return;
  }
  const C = CMP && CMP.key === cmpKey() ? CMP : null;
  if (!C) { drawKey(keyOf('level', state.yB)); return; }          // 新地区尚在计算：先显示 B 年完整图层
  clipOutside(() => drawKey(keyOf('level', state.yB)));
  const now = performance.now(), fadeP = clamp((now - C.fadeT0) / 300, 0, 1), x = mv.ctx;
  if (fadeP < 1) { x.globalAlpha = 1 - eo(fadeP); drawKey(keyOf('level', state.yB)); x.globalAlpha = eo(fadeP); mv.dirty(); }
  mv.drawGrid(cmpBase(C));
  if (now - lastMove < 160 || fadeP < 1) {           // 缩放、平移过程中：变化区用纯色快速绘制
    const a0 = x.globalAlpha; x.globalAlpha = a0 * .55; mv.drawGrid(C.chgD); x.globalAlpha = a0 * .8; mv.drawGrid(C.chgH); x.globalAlpha = a0; clearTimeout(settleT); settleT = setTimeout(() => mv.dirty(), 170);
  } else { x.setTransform(1, 0, 0, 1, 0, 0); x.drawImage(hatchLayer(C), 0, 0); }
  x.globalAlpha = 1;
}

/* vector layers */
el('path', { d: M.graticule, fill: 'none', stroke: '#C3C9C1', 'stroke-width': .6, 'stroke-dasharray': '2 4', 'vector-effect': 'non-scaling-stroke' }, mv.svgU);
el('path', { d: M.contextPath, fill: '#D9DCD6', stroke: '#F4F5F2', 'stroke-width': 1.2, 'vector-effect': 'non-scaling-stroke' }, mv.svgU);
const dimPath = el('path', { 'fill-rule': 'evenodd', fill: '#EEF0EC', 'fill-opacity': .66, d: '' }, mv.svgO);
const gCty = el('g', { fill: 'none', stroke: '#FFFFFF', 'stroke-width': .6 }, mv.svgO);
const ctyPaths = M.county.map(c => el('path', { d: c.d, 'vector-effect': 'non-scaling-stroke', 'stroke-opacity': .3 }, gCty));
const gCity = el('g', { fill: 'none', stroke: '#24475A', 'stroke-width': 1, 'stroke-opacity': .55 }, mv.svgO);
M.city.forEach(c => el('path', { d: c.d, 'vector-effect': 'non-scaling-stroke' }, gCity));
const gProv = el('g', { fill: 'none', stroke: '#1B252B', 'stroke-width': 1.6, 'stroke-linejoin': 'round' }, mv.svgO);
M.prov.forEach(p => el('path', { d: p.d, 'vector-effect': 'non-scaling-stroke' }, gProv));
const hovPath = el('path', { d: '', fill: 'none', stroke: '#1B252B', 'stroke-width': 1.4, 'stroke-dasharray': '4 3', 'vector-effect': 'non-scaling-stroke' }, mv.svgO);
const selHalo = el('path', { d: '', fill: 'none', stroke: '#E3A229', 'stroke-width': 6, 'stroke-linejoin': 'round', opacity: .95, 'vector-effect': 'non-scaling-stroke' }, mv.svgO);
const selLine = el('path', { d: '', fill: 'none', stroke: '#1B252B', 'stroke-width': 2, 'stroke-linejoin': 'round', 'vector-effect': 'non-scaling-stroke' }, mv.svgO);
const gLab = el('g', {}, mv.svgO);
for (const [n, ll] of Object.entries(G.ctxLabel)) { const [x, y] = M.proj(...ll); mv.label(gLab, x, y, n, { fill: '#9AA29C', 'letter-spacing': 4, class: 'ctxl' }, 14); }
M.basemap(mv, $('mapCredit'));   // 天地图底图 + 地图下方说明条
for (const [n, ll] of Object.entries(G.desertLabel)) { const [x, y] = M.proj(...ll); mv.label(gLab, x, y, n, { fill: '#4A2E16', stroke: 'rgba(255,255,255,.8)', 'letter-spacing': 2, 'font-weight': 500, opacity: .8 }, 12, 3.5); }

const VIEW0 = mv.fitBox(M.nwBB, 22); mv.minS = VIEW0.s * .8; mv.maxS = VIEW0.s * 140; mv.setView(VIEW0);
const unitView = u => { const rc = $('rcol'), rw = rc.offsetParent ? rc.offsetWidth + 18 : 0, lw = state.cmp && state.lyrOpen && mv.VW > 640 ? 270 : 0;
  const v = mv.fitBox(u.bb, 34, { right: Math.min(rw, mv.VW * .45), left: lw, bottom: 30 }); v.s = clamp(v.s, mv.minS, VIEW0.s * 60); return v; };
$('zoomIn').onclick = () => (userView = true, mv.setView({ ...mv.view, s: mv.view.s * 1.6 }, true));
$('zoomOut').onclick = () => (userView = true, mv.setView({ ...mv.view, s: mv.view.s / 1.6 }, true));
$('zoomReset').onclick = () => { userView = false; mv.setView(unitView(state.u), true); };
wrap.addEventListener('wheel', e => { e.preventDefault(); userView = true; const r = wrap.getBoundingClientRect(); mv.zoomAt(e.deltaY < 0 ? 1.2 : 1 / 1.2, e.clientX - r.left, e.clientY - r.top); }, { passive: false });

/* inset */
{ const s = $('inset'), [x0, y0, x1, y1] = M.nwBB, w = 224, h = 112, pad = 6; s.setAttribute('width', w); s.setAttribute('height', h);
  s.setAttribute('viewBox', `${x0 - pad} ${y0 - pad} ${x1 - x0 + 2 * pad} ${y1 - y0 + 2 * pad}`);
  M.prov.forEach(p => el('path', { d: p.d, fill: '#D2D6D0', stroke: '#F7F8F6', 'stroke-width': .8, 'vector-effect': 'non-scaling-stroke' }, s)); }
const insProv = el('path', { d: '', fill: '#1A3441' }, $('inset')), insUnit = el('path', { d: '', fill: '#E3A229', stroke: '#1B252B', 'stroke-width': .8, 'vector-effect': 'non-scaling-stroke' }, $('inset'));

/* =================== labels & callouts (HTML over the map) =================== */
function buildLabels() {
  rl.querySelectorAll('.rl').forEach(e => e.remove()); LBL = [];
  const u = state.u; let list = u.lv === 'county' ? peersOf(u) : childrenOf(u); if (!list.length) list = [u];
  for (const v of list) { const d = document.createElement('div'); d.className = 'rl' + (v === u ? ' self' : '') + (u.lv === 'county' && v !== u ? ' dim' : '');
    d.innerHTML = `<i class="pin"></i><span class="n">${esc(v.short)}</span><span class="v"></span>`; d.title = `查看${v.name}`;
    d.addEventListener('click', () => go(v)); rl.appendChild(d); LBL.push({ v, d, w: 0, pri: v === u ? 1e12 : v.A }); }
  LBL.sort((a, b) => b.pri - a.pri); updateLabels();
}
function updateLabels() {
  const k = yi(curY());
  for (const L of LBL) { const ri = L.v.kpi(k)[0], lv = M.levelOf(ri), s = L.d.querySelector('.v');
    s.textContent = ri.toFixed(2); s.style.background = COL[lv]; s.style.color = lv >= 3 ? '#fff' : '#1B252B'; L.d.classList.toggle('plain', state.cmp); s.hidden = state.cmp; L.w = 0; }
  placeLabels();
}
function placeLabels() {
  const VW = mv.VW, VH = mv.VH, wr = wrap.getBoundingClientRect(), placed = [];
  const obst = [...$('rcol').children, $('lyrBox')].filter(e => !e.hidden && e.offsetParent).map(e => { const r = e.getBoundingClientRect(); return [r.left - wr.left - 4, r.top - wr.top - 4, r.right - wr.left + 4, r.bottom - wr.top + 4]; });
  for (const L of LBL) {
    if (!L.w) { L.w = L.d.offsetWidth; L.h = L.d.offsetHeight || 22; }
    const [x, y] = mv.toScreen(L.v.lp[0], L.v.lp[1]), bx = [x - 9, y - L.h / 2 - 2, x - 9 + L.w + 2, y + L.h / 2 + 2];
    let ok = bx[0] > 4 && bx[2] < VW - 4 && bx[1] > 4 && bx[3] < VH - 40;
    if (ok) for (const p of obst) if (bx[0] < p[2] && bx[2] > p[0] && bx[1] < p[3] && bx[3] > p[1]) { ok = false; break; }
    if (ok) for (const p of placed) if (bx[0] < p[2] && bx[2] > p[0] && bx[1] < p[3] && bx[3] > p[1]) { ok = false; break; }
    if (ok) placed.push(bx); L.d.classList.toggle('off', !ok); L.d.style.transform = `translate(${(x - 9).toFixed(1)}px,${(y - L.h / 2).toFixed(1)}px)`;
  }
}
function placeName(lon, lat) {
  const p = M.cellOf(lon, lat); let ci = CID && p >= 0 ? CID[p] : 65535;
  if (ci === 65535 || !state.u.ids.includes(ci)) { let best = 1e9; for (const i of state.u.ids) { const c = M.county[i], d = Math.hypot((c.l[0] - lon) * Math.cos(lat * Math.PI / 180), c.l[1] - lat); if (d < best) { best = d; ci = i; } } }
  const c = M.county[ci], dx = (lon - c.l[0]) * Math.cos(lat * Math.PI / 180), dy = lat - c.l[1], size = Math.sqrt(c.A) / 111 / 2;
  if (Math.hypot(dx, dy) < .35 * size) return c.n + '中部';
  return c.n + ['东', '东北', '北', '西北', '西', '西南', '南', '东南'][((Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) % 8) + 8) % 8] + '部';
}
function renderCallouts() {
  const C = state.cmp && CMP && CMP.key === cmpKey() ? CMP : null;
  if (!C || !C.coEls) { rl.querySelectorAll('.co').forEach(e => e.remove()); }
  leaders.textContent = '';
  if (!C) return;
  if (!C.coEls) C.coEls = C.comps.map(c => {   // 元素只创建一次，尺寸只量一次
    const d = document.createElement('div'); d.className = 'co' + (c.type === 's' ? ' dn' : '');
    d.innerHTML = `<div class="t"><b>${c.type === 'e' ? '荒漠扩大' : '荒漠缩小'}</b><small>${esc(c.name || (c.name = placeName(c.lon, c.lat)))}</small></div><div class="a">${c.type === 'e' ? '+' : '−'}${M.fmtInt(c.A)} km²</div>`;
    rl.appendChild(d); return { c, d, w: d.offsetWidth, h: d.offsetHeight, p: M.proj(c.lon, c.lat) }; });
  const VW = mv.VW, VH = mv.VH, rc = $('rcol'), right = rc.offsetParent ? VW - rc.offsetWidth - 26 : VW - 10, boxes = [], lb = $('lyrBox');
  const lbR = lb.hidden ? null : [lb.offsetLeft + lb.offsetWidth + 8, lb.offsetTop + lb.offsetHeight + 8];
  let svg = '';
  for (const E of C.coEls) {
    const { c, d, w, h } = E, [ax, ay] = mv.toScreen(E.p[0], E.p[1]);
    if (ax < 0 || ay < 0 || ax > VW || ay > VH) { d.style.display = 'none'; continue; } d.style.display = '';
    let x = ax > right / 2 ? ax - w - 56 : ax + 56, y = ay - h - 24;
    x = clamp(x, 10, right - w); y = clamp(y, 10, VH - h - 56);
    if (lbR && x < lbR[0] && y < lbR[1]) y = Math.max(y, lbR[1]);
    for (let g = 0; g < 6; g++) { const hit = boxes.find(b => x < b[2] + 6 && x + w > b[0] - 6 && y < b[3] + 6 && y + h > b[1] - 6); if (!hit) break; y = hit[3] + 8; if (y + h > VH - 56) y = hit[1] - h - 8; }
    boxes.push([x, y, x + w, y + h]); d.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px)`;
    const ex = ax < x ? x : ax > x + w ? x + w : ax, ey = ay < y ? y : ay > y + h ? y + h : y + h / 2, col = c.type === 'e' ? UP : DN;
    svg += `<path d="M${ax.toFixed(1)},${ay.toFixed(1)}L${ex.toFixed(1)},${ey.toFixed(1)}" stroke="#1B252B" stroke-width="1.2" fill="none"/><circle cx="${ax.toFixed(1)}" cy="${ay.toFixed(1)}" r="5" fill="#fff" stroke="${col}" stroke-width="2.2"/><circle cx="${ax.toFixed(1)}" cy="${ay.toFixed(1)}" r="1.8" fill="${col}"/>`;
  }
  leaders.innerHTML = svg;
}

/* =================== map side cards =================== */
function renderRank() {
  const u = state.u, k = yi(curY()), list = peersOf(u).map(v => ({ v, ri: v.kpi(k)[0] })).sort((a, b) => b.ri - a.ri), box = $('rank');
  const title = u.lv === 'prov' ? '五省区排名' : u.lv === 'city' ? `${u.short === M.PROVS[u.pi] ? '' : M.PROVS[u.pi]}市州排名` : `${mk('city', u.ci).short}县区排名`;
  const mx = Math.max(...list.map(d => d.ri), .01);
  box.innerHTML = `<h4>${esc(title)}<small>风险指数 · ${curY()}</small></h4><div class="list">${list.map((d, n) => { const lv = M.levelOf(d.ri);
    return `<button class="rk${d.v === u ? ' on' : ''}" data-k="${d.v.key}"><span class="no">${n + 1}</span><span class="nm">${esc(d.v.short)}</span><span class="bar"><i style="width:${(d.ri / mx * 100).toFixed(1)}%;background:${d.v === u ? '#1B252B' : COL[lv]}"></i></span><span class="v">${d.ri.toFixed(2)}</span></button>`; }).join('')}</div>`;
  const L = box.querySelector('.list'); L.style.maxHeight = list.length > 9 ? '218px' : '';
  box.querySelectorAll('.rk').forEach(b => b.onclick = () => go(UNITS.get(b.dataset.k)));
  const on = box.querySelector('.rk.on'); if (on && list.length > 9) L.scrollTop = on.offsetTop - L.offsetTop - 80;
}
function renderMapLegend() {
  const b = $('mapLegend'), y = curY(); let h = '';
  if (state.cmp) {
    h = `<div class="t"><span>叠加对比图例</span><span>${state.yA} → ${state.yB}</span></div><div class="sy">
      <div><i style="background:repeating-linear-gradient(45deg,${UP} 0 2px,#fff 2px 5px)"></i>荒漠扩大</div><div><i style="background:repeating-linear-gradient(45deg,${DN} 0 2px,#fff 2px 5px)"></i>荒漠缩小</div>
      <div><i style="background:radial-gradient(${UP} 1.3px,#fff 1.7px) 0 0/5px 5px"></i>程度加重</div><div><i style="background:radial-gradient(${DN} 1.3px,#fff 1.7px) 0 0/5px 5px"></i>程度减轻</div></div>
      <div class="rampS" style="margin-top:6px">${COL.map(c => `<i style="background:${c}"></i>`).join('')}</div><div class="names">${NAMES.map(n => `<span>${n}</span>`).join('')}</div>
      <div class="nt">下层 A 年以 ${Math.round(state.opA * 100)}% 不透明度显示全部等级；上层 B 年只显示荒漠化等级，稳定区不着色。</div>`;
  } else if (state.layer === 'level') {
    h = `<div class="t"><span>风险等级（1 km 格网）</span><span>${y}</span></div><div class="rampS">${COL.map(c => `<i style="background:${c}"></i>`).join('')}</div><div class="names">${NAMES.map(n => `<span>${n}</span>`).join('')}</div>
      <div class="nt">标签数字为县区风险指数（0–1）。</div>`;
  } else if (state.layer === 'change') {
    h = `<div class="t"><span>年际变化</span><span>${Math.max(Y0, y - 1)} → ${y}</span></div><div class="sy">${CHG.map(d => `<div><i style="background:${d.c}"></i>${d.n}</div>`).join('')}</div>`;
  } else {
    h = `<div class="t"><span>${confLabel(y)}</span><span>${y}</span></div><div class="rampS">${CONF.map(d => `<i style="background:${d.c}"></i>`).join('')}</div><div class="names" style="font-size:10px">${['<60', '60', '70', '80', '≥90'].map(n => `<span>${n}</span>`).join('')}</div>`;
  }
  b.innerHTML = h;
  fitRcol(); updFsYear();
}
function renderLyrBox() {
  const b = $('lyrBox'); b.hidden = !state.cmp; if (!state.cmp) return;
  const eye = '<svg viewBox="0 0 24 24"><path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="2.8"/></svg>';
  const row = (k, y, op, show) => `<div class="lyr ${k}"><i>${k.toUpperCase()}</i><div class="nm"><b>${y}</b>${k === 'b' ? '上层' : '下层'}　${y > BASE ? '模型预测' : '代理观测'}<small>${M.statusZh(y)}</small></div>
    <button class="eye" data-eye="${k}" aria-pressed="${show}" title="显示/隐藏">${eye}</button>
    <div class="op"><span>不透明度</span><input type="range" min="0" max="100" value="${Math.round(op * 100)}" data-op="${k}" aria-label="${k.toUpperCase()} 层不透明度"><b>${Math.round(op * 100)}%</b></div></div>`;
  b.classList.toggle('open', state.lyrOpen);
  b.innerHTML = `<button class="hd" id="lyrTgl" aria-expanded="${state.lyrOpen}" title="${state.lyrOpen ? '收起' : '展开'}图层调节"><span>图层叠加<small>${state.lyrOpen ? '较早年份在下层' : `B ${state.yB} 在上 · A ${state.yA} 在下`}</small></span><i class="pm" aria-hidden="true">${state.lyrOpen ? '−' : '+'}</i></button>
    <div class="lyr-body">${row('b', state.yB, state.opB, state.showB)}${row('a', state.yA, state.opA, state.showA)}
    <button class="tgl" id="onlyChg" aria-pressed="${state.onlyChg}"><span>仅显示荒漠化区域变化</span><span class="sw"></span></button></div>`;
  $('lyrTgl').onclick = () => { state.lyrOpen = !state.lyrOpen; renderLyrBox(); placeLabels(); renderCallouts(); };
  b.querySelectorAll('[data-op]').forEach(s => s.addEventListener('input', () => { const k = s.dataset.op; state[k === 'a' ? 'opA' : 'opB'] = s.value / 100; s.nextElementSibling.textContent = s.value + '%'; if (k === 'a') renderMapLegend(); mv.dirty(); }));
  b.querySelectorAll('[data-eye]').forEach(e => e.onclick = () => { const k = e.dataset.eye === 'a' ? 'showA' : 'showB'; state[k] = !state[k]; e.setAttribute('aria-pressed', state[k]); mv.dirty(); });
  $('onlyChg').onclick = () => { state.onlyChg = !state.onlyChg; $('onlyChg').setAttribute('aria-pressed', state.onlyChg); mv.dirty(); };
}
function fitRcol() {   // 右侧卡片放不下时依次隐藏：位置小图 → 图例说明 → 图例
  const r = $('rcol'); if (!r) return; r.classList.remove('f1', 'f2', 'f3');
  for (const c of ['f1', 'f2', 'f3']) { if (r.scrollHeight - r.clientHeight <= 1) break; r.classList.add(c); }
}
function renderCstat() {
  const b = $('cstat'); b.hidden = !state.cmp; $('rank').hidden = state.cmp; if (!state.cmp) { fitRcol(); return; }
  if (!CMP || CMP.key !== cmpKey()) { b.innerHTML = `<h4>变化统计<small>${state.yA} → ${state.yB}</small></h4><p class="nt" style="font-size:12px;color:var(--ink-3)">计算中…</p>`; return; }
  const s = CMP.st, rows = [['荒漠扩大', s.e, `repeating-linear-gradient(45deg,${UP} 0 2px,#fff 2px 5px)`, UP], ['程度加重', s.wo, `radial-gradient(${UP} 1.3px,#fff 1.7px) 0 0/5px 5px`, '#E58A99'],
    ['荒漠缩小', s.s, `repeating-linear-gradient(45deg,${DN} 0 2px,#fff 2px 5px)`, DN], ['程度减轻', s.be, `radial-gradient(${DN} 1.3px,#fff 1.7px) 0 0/5px 5px`, '#8CC5A2']], mx = Math.max(...rows.map(r => r[1]), 1), net = s.e - s.s;
  b.innerHTML = `<h4>变化统计<small>${state.yA} → ${state.yB}</small></h4>${rows.map(r => `<div class="cs-row"><span class="sw" style="background:${r[2]}"></span><span>${r[0]}</span><b>${M.fmtInt(r[1])}<small>km²</small></b><span class="br"><i style="width:${(r[1] / mx * 100).toFixed(1)}%;background:${r[3]}"></i></span></div>`).join('')}
    <div class="net"><span>荒漠化面积净变化</span><b class="${net > 0 ? 'up' : 'dn'}">${net > 0 ? '+' : '−'}${M.fmtInt(Math.abs(net))} km²</b></div>`;
  fitRcol();
}

/* =================== profile =================== */
const tweens = new Map();
function tween(node, to, f, dur = 420) { const from = tweens.has(node) ? tweens.get(node).cur : to, t0 = performance.now(), o = { cur: from }; tweens.set(node, o);
  if (M.REDUCE || from === to) { o.cur = to; node.textContent = f(to); return; }
  const step = now => { if (tweens.get(node) !== o) return; const p = eo(clamp((now - t0) / dur, 0, 1)); o.cur = lerp(from, to, p); node.textContent = f(o.cur); if (p < 1) requestAnimationFrame(step); }; requestAnimationFrame(step); }
function fitProf() {   // 逐级压缩“地区概况”，直到不需要滚动条
  const p = document.querySelector('.prof'); if (!p) return; p.classList.remove('fit1', 'fit2', 'fit3', 'fits');
  if (getComputedStyle(p).overflowY === 'visible') return;
  const over = () => p.scrollHeight - p.clientHeight > 1;
  for (const c of ['fit1', 'fit2', 'fit3']) { if (!over()) break; p.classList.add(c); }
  if (!over()) p.classList.add('fits');
}
function renderMiniProf() {   // 地图铺满窗口时右侧的简化地区概况
  const box = $('miniProf'); if (!box) return; const on = mapPanel.classList.contains('max'); box.hidden = !on; if (!on) return;
  const u = state.u, Y = curY(), R = refY(), k = yi(Y), kr = yi(R), K = u.kpi(k), KR = u.kpi(kr), lv = M.levelOf(K[0]), m = series(u).met[k];
  const pr = rankIn(u, provPeers(u), k), dR = K[0] - KR[0], same = !state.cmp && Y === BASE;
  const a = series(u).att[k], top = RG.factors.map((n, q) => ({ n, v: a[q], d: RG.factorDir[q] })).sort((p, q) => q.v - p.v)[0];
  box.style.setProperty('--bg', COL[lv]); box.classList.toggle('dk', lv >= 3);
  box.innerHTML = `<div class="mh"><div><small>${Y} 年 · ${M.scnOf(Y)}</small><b>${esc(u.name)}</b></div>
      <div class="ri"><span class="num">${K[0].toFixed(2)}</span>${chip(lv)}</div></div>
    <dl><dt>${state.cmp ? `较 ${R} 年` : `较 ${BASE} 年`}</dt><dd class="${same || Math.abs(dR) < 5e-4 ? '' : dR > 0 ? 'up' : 'dn'}">${same ? '基准年' : sgn(dR, 3)}</dd>
      <dt>${u.lv === 'prov' ? '五省区排名' : '省内排名'}</dt><dd>${pr.r} / ${pr.n}</dd>
      <dt>荒漠化占比</dt><dd>${K[1].toFixed(1)}%</dd><dt>重度及以上</dt><dd>${K[2].toFixed(1)}%</dd>
      <dt>年降水 · 气温</dt><dd>${m[0].toFixed(0)} mm · ${m[1].toFixed(1)} °C</dd><dt>${confLabel(Y)}</dt><dd>${K[3].toFixed(0)}%</dd></dl>
    <div class="mf"><span>首要驱动</span><b class="${top.d > 0 ? 'up' : 'dn'}">${top.n} ${top.v.toFixed(0)}%</b></div>`;
}
function renderProfile() {
  const u = state.u, Y = curY(), R = refY(), k = yi(Y), kr = yi(R), K = u.kpi(k), KR = u.kpi(kr), lv = M.levelOf(K[0]), S = series(u), r = rec(u, M.periodOf(Y));
  $('profTag').textContent = state.cmp ? `${state.yA} → ${state.yB}　${M.scnOf(state.yB)}` : `${Y} 年　${M.scnOf(Y)}`;
  const path = u.lv === 'prov' ? '西北五省区' : u.lv === 'city' ? PROV_FULL[M.PROVS[u.pi]] : `${PROV_FULL[M.PROVS[u.pi]]}　${mk('city', u.ci).name}`;
  const sub = u.lv === 'prov' ? `下辖 ${childrenOf(u).length} 个市州、${u.ids.length} 个县区` : (r ? r.rt : '');
  const pr = rankIn(u, provPeers(u), k), pk = u.lv === 'prov' ? '五省区风险排名' : '省内风险排名';
  const dR = K[0] - KR[0], same = !state.cmp && Y === BASE;
  const hero = $('hero'); hero.style.backgroundColor = COL[lv]; hero.classList.toggle('dk', lv >= 3); hero.title = `底色对应 ${Y} 年风险等级：${NAMES[lv]}`;
  hero.innerHTML = `<div><span class="k">当前选择</span><div class="city${u.name.length > 7 ? ' long' : ''}">${esc(u.name)}</div><div class="sub">${esc(path)}<br>${esc(sub)}</div></div>
    <div><span class="k">综合风险指数</span>${state.cmp ? `<div class="big cmpv"><span>${KR[0].toFixed(2)}</span><em>→</em><span id="hRi"></span>${chip(lv)}</div>` : `<div class="big"><span id="hRi"></span>${chip(lv)}</div>`}
      <div class="bnote" title="风险指数 0–1；分级阈值 0.32 / 0.47 / 0.62 / 0.76">阈值 .32 / .47 / .62 / .76</div></div>
    <div class="pair"><div><span>${state.cmp ? `较 A 年（${R}）` : `较 ${BASE} 年`}</span><b class="${same || Math.abs(dR) < 5e-4 ? '' : dR > 0 ? 'up' : 'dn'}">${same ? '基准年' : sgn(dR, 3)}</b></div>
      <div><span>${pk}</span><b>${pr.r}<small> / ${pr.n}</small></b></div><div><span>${confLabel(Y)}</span><b>${K[3].toFixed(0)}<small>%</small></b></div></div>`;
  tween($('hRi'), K[0], v => v.toFixed(2));
  fitProf(); renderMiniProf(); fitRcol();
  const m = S.met[k], mr = S.met[kr], dl = (v, d, unit, badUp) => { if (same) return '基准年'; const c = Math.abs(v) < Math.pow(10, -d) / 2 ? '' : (v > 0) === badUp ? 'up' : 'dn'; return `较 ${R} 年 <b class="${c}">${sgn(v, d)}${unit}</b>`; };
  const cells = [
    ['荒漠化土地占比', '', K[1].toFixed(1), '%', u.lv === 'prov' && CAL ? `官方口径 ${(CAL.prov[u.pi][k][0] / 1e4).toFixed(1)} 万km²　` + dl(K[1] - KR[1], 1, '', true).replace(/^较 \d+ 年 /, '') : `约 ${M.fmtInt(K[1] / 100 * u.A)} km²　` + dl(K[1] - KR[1], 1, '', true)],
    ['重度及以上占比', '', K[2].toFixed(1), '%', dl(K[2] - KR[2], 1, '', true)],
    ['年降水量', '', m[0].toFixed(0), 'mm', dl(m[0] - mr[0], 0, ' mm', false)],
    ['年均气温', '', m[1].toFixed(1), '°C', dl(m[1] - mr[1], 1, ' °C', true)],
    ['地下水位变化', '代理', m[2].toFixed(2), 'm/年', dl(m[2] - mr[2], 2, '', false)],
    ['大风日数', '代理', m[3].toFixed(0), '天/年', dl(m[3] - mr[3], 0, ' 天', true)],
  ];
  $('kpis').innerHTML = cells.map(c => `<div class="kpi"${c[1] ? ' title="参数化代理指标，不是监测井或气象站实测"' : ''}><div class="l">${c[0]}${c[1] ? `<em>${c[1]}</em>` : ''}</div><div class="v">${c[2]}<small>${c[3]}</small></div><div class="d">${c[4]}</div></div>`).join('');
  // attribution
  const a = S.att[k], F = RG.factors, D = RG.factorDir, up = [], dn = [];
  F.forEach((n, q) => (D[q] > 0 ? up : dn).push({ n, v: a[q] })); up.sort((p, q) => q.v - p.v); dn.sort((p, q) => q.v - p.v);
  const mx = Math.max(...a, 1), su = up.reduce((s, d) => s + d.v, 0), sd = dn.reduce((s, d) => s + d.v, 0), top = [...up, ...dn].sort((p, q) => q.v - p.v)[0].n;
  $('drv').innerHTML = `<h3>风险驱动因子贡献<small>${Y} 年　代理归因，各因子合计 100%</small></h3>
    <div class="dside"><span>促进荒漠缩小 <b class="dn">${sd.toFixed(0)}%</b></span><span>促进荒漠扩大 <b class="up">${su.toFixed(0)}%</b></span></div>
    ${up.map((d, q) => { const e = dn[q]; return `<div class="dpair"><div class="L${e.n === top ? ' top' : ''}"><span class="nm">${e.n}</span><span class="v">${e.v.toFixed(1)}</span><span class="b"><i style="width:${(e.v / mx * 100).toFixed(1)}%"></i></span></div>
      <div class="R${d.n === top ? ' top' : ''}"><span class="b"><i style="width:${(d.v / mx * 100).toFixed(1)}%"></i></span><span class="v">${d.v.toFixed(1)}</span><span class="nm">${d.n}</span></div></div>`; }).join('')}
    <p class="ft" title="降水、气温为 CMIP6 IITM-ESM 县区均值（锚点年插值）；标“代理”的地下水、大风为参数化指标，非实测；归因为可复算的代理归因，不是因果识别。详见页面底部“数据与口径说明”。"><b>口径：</b>气象为 CMIP6 县区均值；“代理”项为参数化指标，非实测；归因为代理归因，非因果识别${u.lv !== 'county' ? '；市州、省级为县区面积加权' : ''}。</p>`;
}

/* =================== charts =================== */
const NS = 'http://www.w3.org/2000/svg';
const size = svg => { const r = svg.parentNode.getBoundingClientRect(); return [Math.max(10, r.width), Math.max(10, r.height)]; };
let EV = null;
function renderEvo() {
  const svg = $('evo'), [W, H] = size(svg), u = state.u, S = series(u); svg.innerHTML = ''; svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const x0 = 44, x1 = W - 14, y0 = 20, y1 = H - 22, X = y => x0 + (y - Y0) / (Y1 - Y0) * (x1 - x0), Yp = v => y1 - v / 100 * (y1 - y0);
  $('evoCap').textContent = `${u.name}各等级面积占比（1 km 栅格），${Y0}–${Y1}`;
  for (let c = 0; c < 5; c++) {   // stacked from 稳定 (bottom) to 极重度 (top)
    const lo = YEARS.map((y, k) => S.comp[k].slice(0, c).reduce((a, b) => a + b, 0)), hi = YEARS.map((y, k) => lo[k] + S.comp[k][c]);
    el('path', { d: 'M' + YEARS.map((y, k) => `${X(y).toFixed(1)},${Yp(hi[k]).toFixed(1)}`).join('L') + 'L' + YEARS.map((y, k) => `${X(y).toFixed(1)},${Yp(lo[k]).toFixed(1)}`).reverse().join('L') + 'Z', fill: COL[c] }, svg);
  }
  el('rect', { x: X(BASE), y: y0, width: x1 - X(BASE), height: y1 - y0, fill: '#fff', opacity: .12 }, svg);
  [0, 50, 100].forEach(v => { const t = el('text', { x: x0 - 6, y: Yp(v) + 4, 'text-anchor': 'end', 'font-size': 10.5, fill: '#737D82', 'font-family': 'Bahnschrift, Inter, sans-serif' }, svg); t.textContent = v + '%'; });
  for (let y = Y0; y <= Y1; y += 10) { const t = el('text', { x: X(y), y: H - 6, 'text-anchor': 'middle', 'font-size': 10.5, fill: '#737D82', 'font-family': 'Bahnschrift, Inter, sans-serif' }, svg); t.textContent = y; }
  el('line', { x1: X(BASE), x2: X(BASE), y1: y0 - 6, y2: y1, stroke: '#1B252B', 'stroke-dasharray': '3 3', 'stroke-width': 1 }, svg);
  const l1 = el('text', { x: X(BASE) - 6, y: y0 - 8, 'text-anchor': 'end', 'font-size': 11, 'font-weight': 600, fill: '#1A3441' }, svg); l1.textContent = '代理观测';
  const l2 = el('text', { x: X(BASE) + 6, y: y0 - 8, 'font-size': 11, 'font-weight': 600, fill: '#9A6408' }, svg); l2.textContent = M.scnName() + ' 预测';
  const mkLine = (col, letter) => { const g = el('g', {}, svg); el('line', { y1: y0 - 2, y2: y1, stroke: col, 'stroke-width': 1.6 }, g); if (letter) { el('rect', { x: -9, y: y0 - 2, width: 18, height: 16, fill: col }, g); const t = el('text', { y: y0 + 10, 'text-anchor': 'middle', 'font-size': 11, 'font-weight': 800, fill: letter === 'B' ? '#E3A229' : '#fff', 'font-family': 'Bahnschrift, Inter, sans-serif' }, g); t.textContent = letter; } return g; };
  EV = { X, x0, x1, W, H, A: mkLine('#1A3441', 'A'), B: mkLine('#1B252B', 'B'), C: mkLine('#1B252B', null), hover: null };
  const hit = el('rect', { x: x0, y: y0, width: x1 - x0, height: y1 - y0, fill: 'transparent', style: 'cursor:pointer' }, svg);
  const yAt = e => { const r = svg.getBoundingClientRect(); return Math.round(clamp(Y0 + ((e.clientX - r.left) * W / r.width - x0) / (x1 - x0) * (Y1 - Y0), Y0, Y1)); };
  hit.addEventListener('pointermove', e => { EV.hover = yAt(e); evoMarks(); });
  hit.addEventListener('pointerleave', () => { EV.hover = null; evoMarks(); });
  hit.addEventListener('click', e => { const y = yAt(e); stopPlay(); if (state.cmp) { Math.abs(y - state.yA) < Math.abs(y - state.yB) ? setCompare(y, state.yB) : setCompare(state.yA, y); } else setYear(y); });
  evoMarks();
}
function evoMarks() {
  if (!EV) return; const S = series(state.u), tip = $('evoTip');
  const at = (g, y) => { g.style.display = ''; g.setAttribute('transform', `translate(${EV.X(y)},0)`); };
  EV.A.style.display = EV.B.style.display = EV.C.style.display = 'none';
  if (state.cmp) { at(EV.A, state.yA); at(EV.B, state.yB); } else at(EV.C, state.year);
  const y = EV.hover ?? curY(), k = yi(y), c = S.comp[k];
  tip.innerHTML = `<b>${y} 年${EV.hover != null ? '' : state.cmp ? '（B）' : ''}</b>` + [4, 3, 2, 1, 0].map(q => `<div><i style="background:${COL[q]}"></i><span>${NAMES[q]}</span><span>${c[q].toFixed(1)}%</span></div>`).join('');
  tip.hidden = false; const x = EV.X(y), w = tip.offsetWidth || 160; tip.style.left = (x + 12 + w > EV.W - 6 ? x - w - 12 : x + 12) + 'px';
}
let TK = null;
function renderTrack() {
  const svg = $('track'), [W, H] = size(svg); svg.innerHTML = ''; svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const x0 = 16, x1 = W - 16, cy = 22, X = y => x0 + (y - Y0) / (Y1 - Y0) * (x1 - x0);
  const defs = el('defs', {}, svg), pat = el('pattern', { id: 'rh', width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, defs);
  el('rect', { width: 6, height: 6, fill: '#F1D79A' }, pat); el('rect', { width: 2.4, height: 6, fill: '#E3A229' }, pat);
  el('rect', { x: x0, y: cy - 3, width: X(BASE + .5) - x0, height: 6, fill: '#1A3441' }, svg);
  el('rect', { x: X(BASE + .5), y: cy - 3, width: x1 - X(BASE + .5), height: 6, fill: 'url(#rh)' }, svg);
  const labs = [];
  YEARS.forEach(y => { const a = M.isAnchor(y); el('line', { x1: X(y), x2: X(y), y1: cy + 6, y2: cy + (a ? 12 : 9), stroke: a ? '#4B575E' : '#B5BBB4' }, svg);
    if (y % 10 === 0) { const t = el('text', { x: X(y), y: cy + 25, 'text-anchor': 'middle', 'font-size': 10.5, fill: '#4B575E', 'font-family': 'Bahnschrift, Inter, sans-serif' }, svg); t.textContent = y; labs.push({ t, y }); } });
  const th = (fill, letter, lc) => { const g = el('g', { style: 'cursor:grab' }, svg); el('rect', { x: -10, y: cy - 10, width: 20, height: 20, fill, stroke: '#1B252B', 'stroke-width': 2 }, g);
    const t = el('text', { y: cy + 4.5, 'text-anchor': 'middle', 'font-size': 11.5, 'font-weight': 800, fill: lc, 'font-family': 'Bahnschrift, Inter, sans-serif' }, g); t.textContent = letter;
    const yl = el('text', { y: cy + 25, 'text-anchor': 'middle', 'font-size': 11.5, 'font-weight': 800, fill: '#1B252B', 'font-family': 'Bahnschrift, Inter, sans-serif' }, g); return { g, t, yl }; };
  TK = { X, x0, x1, W, labs, A: th('#1A3441', 'A', '#fff'), B: th('#E3A229', '', '#1B252B') }; placeTrack();
}
function placeTrack() {
  if (!TK) return; const put = (o, y, show, letter) => { o.g.style.display = show ? '' : 'none'; if (!show) return; o.g.setAttribute('transform', `translate(${TK.X(y)},0)`); o.yl.textContent = y; o.t.textContent = letter; };
  put(TK.B, curY(), true, state.cmp ? 'B' : '‖'); put(TK.A, state.yA, state.cmp, 'A');
  TK.labs.forEach(({ t, y }) => { let d = Math.abs(TK.X(y) - TK.X(curY())); if (state.cmp) d = Math.min(d, Math.abs(TK.X(y) - TK.X(state.yA))); t.style.opacity = d < 30 ? 0 : 1; });
}
{ const ta = $('trackArea'); let drag = null;
  const yAt = e => { const r = ta.getBoundingClientRect(); return Math.round(clamp(Y0 + ((e.clientX - r.left) * TK.W / r.width - TK.x0) / (TK.x1 - TK.x0) * (Y1 - Y0), Y0, Y1)); };
  const apply = y => { if (drag === 'A') { if (y !== state.yA) setCompare(y, state.yB); } else if (state.cmp) { if (y !== state.yB) setCompare(state.yA, y); } else if (y !== state.year) setYear(y); };
  ta.addEventListener('pointerdown', e => { if (!TK) return; M.dragStart(e); ta.focus({ preventScroll: true }); stopPlay(); const y = yAt(e); drag = state.cmp && Math.abs(y - state.yA) < Math.abs(y - state.yB) ? 'A' : 'B'; ta.setPointerCapture(e.pointerId); apply(y); });
  ta.addEventListener('pointermove', e => { if (drag) apply(yAt(e)); });
  ta.addEventListener('pointerup', () => { drag = null; });
  ta.tabIndex = 0; ta.setAttribute('role', 'slider'); ta.setAttribute('aria-label', '年份'); ta.setAttribute('aria-valuemin', Y0); ta.setAttribute('aria-valuemax', Y1);
  ta.addEventListener('keydown', e => { if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return; e.preventDefault(); const d = (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 5 : 1);
    if (state.cmp) setCompare(state.yA, clamp(state.yB + d, Y0, Y1)); else setYear(clamp(state.year + d, Y0, Y1)); }); }

const SC_COL = ['#2E8B57', '#1B252B', '#C8102E'];
function renderScn() {
  const svg = $('scn'), [W, H] = size(svg), S = series(state.u).scn; svg.innerHTML = ''; svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const x0 = 40, x1 = W - 96, y0 = 22, y1 = H - 24, b0 = yi(BASE);
  let mn = 1, mx = 0; S.forEach((r, k) => r.forEach(s => { mn = Math.min(mn, s[0], s[1]); mx = Math.max(mx, s[0], s[2]); }));
  const pad = Math.max(.01, (mx - mn) * .12); mn = Math.max(0, mn - pad); mx = Math.min(1, mx + pad);
  const X = y => x0 + (y - Y0) / (Y1 - Y0) * (x1 - x0), Yp = v => y1 - (v - mn) / (mx - mn) * (y1 - y0);
  const nt = 4; for (let q = 0; q <= nt; q++) { const v = mn + (mx - mn) * q / nt; el('line', { x1: x0, x2: x1, y1: Yp(v), y2: Yp(v), stroke: '#E1E4DF' }, svg); const t = el('text', { x: x0 - 6, y: Yp(v) + 4, 'text-anchor': 'end', 'font-size': 10.5, fill: '#9AA29C', 'font-family': 'Bahnschrift, Inter, sans-serif' }, svg); t.textContent = v.toFixed(2); }
  for (let y = Y0; y <= Y1; y += 10) { const t = el('text', { x: X(y), y: H - 6, 'text-anchor': 'middle', 'font-size': 10.5, fill: '#737D82', 'font-family': 'Bahnschrift, Inter, sans-serif' }, svg); t.textContent = y; }
  el('rect', { x: X(Y0), y: y0, width: X(BASE) - X(Y0), height: y1 - y0, fill: '#1A3441', opacity: .04 }, svg);
  const tA = el('text', { x: X(Y0) + 6, y: y1 - 6, 'font-size': 11, fill: '#1A3441', 'font-weight': 600 }, svg); tA.textContent = '代理观测';
  const fy = YEARS.slice(b0), ai = Math.max(0, M.SC.codes.indexOf(M.scn)), order = [0, 1, 2].filter(q => q !== ai).concat(ai), NM = M.SC.names;
  const band = si => si === 1 ? '#E3A229' : SC_COL[si];
  order.forEach(si => el('path', { d: 'M' + fy.map(y => `${X(y)},${Yp(S[yi(y)][si][2])}`).join('L') + 'L' + fy.map(y => `${X(y)},${Yp(S[yi(y)][si][1])}`).reverse().join('L') + 'Z', fill: band(si), opacity: si === ai ? (si === 1 ? .3 : .17) : .06 }, svg));
  el('path', { d: 'M' + YEARS.slice(0, b0 + 1).map(y => `${X(y)},${Yp(S[yi(y)][1][0])}`).join('L'), fill: 'none', stroke: '#1A3441', 'stroke-width': 2 }, svg);
  const ends = [];
  order.forEach(si => { const on = si === ai; el('path', { d: 'M' + fy.map(y => `${X(y)},${Yp(S[yi(y)][si][0])}`).join('L'), fill: 'none', stroke: SC_COL[si], 'stroke-width': on ? 2.4 : 1.4, 'stroke-dasharray': on ? '' : '5 3', opacity: on ? 1 : .75 }, svg); ends.push({ si, y: Yp(S[yi(Y1)][si][0]), v: S[yi(Y1)][si][0] }); });
  ends.sort((a, b) => a.y - b.y); for (let q = 1; q < ends.length; q++) if (ends[q].y - ends[q - 1].y < 14) ends[q].y = ends[q - 1].y + 14;
  ends.forEach(e => { el('circle', { cx: x1, cy: Yp(e.v), r: 3, fill: SC_COL[e.si] }, svg); const t = el('text', { x: x1 + 6, y: e.y + 4, 'font-size': 11, 'font-weight': e.si === ai ? 800 : 600, fill: SC_COL[e.si], 'font-family': 'Bahnschrift, Inter, sans-serif' }, svg); t.textContent = `${NM[e.si]} ${e.v.toFixed(2)}`; });
  const vline = (y, col, lab) => { el('line', { x1: X(y), x2: X(y), y1: y0 - 4, y2: y1, stroke: col, 'stroke-width': 1.5 }, svg); const t = el('text', { x: X(y), y: y0 - 7, 'text-anchor': 'middle', 'font-size': 11, 'font-weight': 700, fill: col === '#E3A229' ? '#9A6408' : col, 'font-family': 'Bahnschrift, Inter, sans-serif' }, svg); t.textContent = lab; };
  if (state.cmp) { vline(state.yA, '#1A3441', 'A ' + state.yA); vline(state.yB, '#E3A229', 'B ' + state.yB); } else vline(state.year, '#E3A229', state.year);
  const Y = curY(), k = yi(Y);
  if (Y > BASE) order.forEach(si => el('circle', { cx: X(Y), cy: Yp(S[k][si][0]), r: si === ai ? 4.2 : 3.2, fill: '#fff', stroke: SC_COL[si], 'stroke-width': 2 }, svg));
  const d50 = [0, 2].map(si => S[yi(Y1)][si][0] - S[yi(Y1)][1][0]);
  $('scLeg').innerHTML = [0, 1, 2].map(si => `<button type="button" class="${si === ai ? 'on' : ''}" data-sc="${M.SC.codes[si]}" aria-pressed="${si === ai}" title="${si === ai ? '当前情景' : '切换到 ' + NM[si]}"><i style="border-color:${SC_COL[si]};${si !== ai ? 'border-top-style:dashed' : ''}"></i>${NM[si]} <b class="num">${S[k][si][0].toFixed(3)}</b></button>`).join('')
    + `<p>${Y} 年数值${Y <= BASE ? '（2025 年及以前三种情景相同）' : ''}。三条曲线都是 1 km 模型逐年结果在本地区的面积加权汇总；到 ${Y1} 年，SSP1-2.6 与 SSP5-8.5 分别比 SSP2-4.5 ${sgn(d50[0], 3)}、${sgn(d50[1], 3)}。90% 区间在每个五年预测步内逐年变宽，到下一锚点收窄。点击图例可切换整页情景。${state.u.lv !== 'county' ? '市州、省级与上方风险指数对齐。' : ''}</p>`;
  $('scLeg').querySelectorAll('[data-sc]').forEach(b => b.onclick = () => pickScenario(b.dataset.sc));
}

/* =================== measures =================== */
const PER = ANCH;
function renderPeriods() {
  const box = $('periods'), P = M.periodOf(curY());
  box.innerHTML = PER.map(p => `${p === 2030 ? '<span class="sep"></span>' : ''}<button role="tab" class="${p > BASE ? 'fc' : ''}${p === P ? ' on' : ''}" aria-selected="${p === P}" data-p="${p}" title="${p > BASE ? '模型建议措施' : '历史评估与实际案例'}">${p}</button>`).join('');
  box.querySelectorAll('button').forEach(b => b.onclick = () => { const p = +b.dataset.p; stopPlay(); if (state.cmp) setCompare(Math.min(state.yA, p), p === state.yA ? Math.min(Y1, p + 5) : p); else setYear(p); });
}
const did = id => id.replace(/^S/, 'D');   // 与“数据来源”页编号一致（措施表中的 S01–S19 即 D01–D19）
const srcItem = id => { const s = RG.sources[id]; if (!s) return ''; return `<li><span class="id">${did(id)}</span><div>${s.u ? `<a href="${esc(s.u)}" target="_blank" rel="noopener">${esc(s.t)}</a>` : `<b>${esc(s.t)}</b>`}<small>${esc(s.k)}　${esc(s.p)}</small></div></li>`; };
const caseCard = id => { const s = RG.sources[id]; return `<article class="case"><div class="ch"><b>${did(id)}</b>${esc(s.k)}<span>${esc(s.p)}</span></div><div class="cb"><strong>${esc(s.t)}</strong><small>实际案例文件（来源 ${did(id)}）</small>${s.u ? `<a href="${esc(s.u)}" target="_blank" rel="noopener">查看原文 ↗</a>` : ''}</div></article>`; };
function plist(units, P, cur, max = 12) {
  const rows = units.map(v => ({ v, r: rec(v, P) })).filter(d => d.r).sort((a, b) => b.r.sc - a.r.sc);
  let show = rows.slice(0, max); const ci = rows.findIndex(d => d.v === cur); if (ci >= max) show = [...rows.slice(0, max - 1), rows[ci]];
  return `<ul class="plist">${show.map(d => `<li class="${d.v === cur ? 'on' : ''}"><button data-k="${d.v.key}"><span class="no">${rows.indexOf(d) + 1}</span><span class="nm">${esc(d.v.short)}</span>${lvChip(d.r.lv, 11)}<span class="sc">${d.r.sc.toFixed(1)}</span></button></li>`).join('')}</ul>`;
}
function renderMeasures() {
  renderPeriods();
  const u = state.u, Y = curY(), P = M.periodOf(Y), fc = P > BASE, body = $('measBody'), end = Math.min(Y1, P + 4);
  $('measCap').textContent = `${P}${end > P ? '–' + end : ''} 周期　${fc ? '模型建议（SSP2-4.5 风险）' : '历史评估 · 实际案例'}`;
  $('pilotLink').hidden = u.a !== '620621';   // 民勤县：90 天验证试点，链接到“关于项目”的验证计划
  let h = '';
  if (u.lv === 'prov') {
    const ks = [...new Set(u.ids.map(unitOfCounty))].filter(v => rec(v, P)), cnt = LV_ORDER.map(l => ks.filter(v => rec(v, P).lv === l).length), mx = Math.max(...cnt, 1);
    const top = ks.map(v => ({ v, r: rec(v, P) })).sort((a, b) => b.r.sc - a.r.sc).slice(0, 8);
    const cs = RG.caseSources.filter(id => Object.keys(MEAS).some(a => { const c = M.county.find(x => x.a === a); return c && c.p === u.short && Object.values(MEAS[a]).some(r => r.cs && r.cs.includes(id)); }));
    h = `<section><h4>省内县区优先等级<small>${P} 年 · ${ks.length} 个县区</small></h4><div class="lvdist">${LV_ORDER.map((l, q) => `<div class="row">${lvChip(l)}<span class="bar"><i style="width:${cnt[q] / mx * 100}%;background:${LV[l][0]}"></i></span><b>${cnt[q]}</b></div>`).join('')}</div>
        <p class="mcap">优先分 = 风险指数×65 + 重度以上占比×0.25 + 荒漠化占比×0.10 + 五年上升量×40（措施表口径）。省级不单独生成措施，请选择市州或县区查看。</p></section>
      <section class="span2"><h4>省内优先治理县区<small>按 ${P} 年优先分排序</small></h4><div class="pcards">${top.map(d => `<button class="pcard" data-k="${d.v.key}"><div class="r1"><b>${esc(d.v.short)}</b><small>${esc(mk('city', d.v.ci).short)}</small>${lvChip(d.r.lv)}</div>
        <div class="m">优先分 ${d.r.sc.toFixed(1)}　风险指数 ${d.r.ri.toFixed(3)}　荒漠化 ${d.r.ds.toFixed(1)}%</div><p>${esc(d.r.rt)}${fc && d.r.tx != null ? '：' + esc(RG.texts[d.r.tx].split('；')[0]) : ''}</p></button>`).join('')}</div></section>
      <section><h4>省内实际案例文件<small>2000–2025</small></h4>${cs.length ? `<ul class="srcs">${cs.map(srcItem).join('')}</ul>` : '<div class="empty"><b>暂无实际案例记录</b>本省未收录可核实的县级治理案例文件。</div>'}</section>`;
  } else {
    const r = rec(u, P);
    if (!r) h = `<section class="span2"><div class="empty"><b>暂无措施记录</b>措施表中没有 ${esc(u.name)} ${P} 年的记录。</div></section>`;
    else {
      const [tn, tp] = totals(u, P);
      h = `<section><h4>优先评估<small>${P} 年措施表</small></h4>
        <div class="plv"><span class="lvb chip" style="background:${LV[r.lv][0]};color:${LV[r.lv][1]}">${esc(r.lv)}</span><span class="sc">${r.sc.toFixed(1)}<small>优先分</small></span></div>
        <div class="kvs"><span>西北同级排名</span><b>${r.rn} / ${tn}</b><span>省内同级排名</span><b>${r.rp} / ${tp}</b><span>风险等级</span><b class="tx">${esc(r.sv)}</b>
          <span>风险指数</span><b>${r.ri.toFixed(3)}</b><span>五年变化</span><b class="${r.ch > 0.0005 ? 'up' : r.ch < -0.0005 ? 'dn' : ''}">${sgn(r.ch, 3)}</b><span>荒漠化占比</span><b>${r.ds.toFixed(1)}%</b><span>重度及以上</span><b>${r.ss.toFixed(1)}%</b><span>${P > BASE ? '预测置信度' : '数据完整度'}</span><b>${r.cf.toFixed(1)}%</b></div>
        <p class="mcap">风险类型：<b>${esc(r.rt)}</b><br>排名为优先分降序（1 = 最需优先治理），${countyAd.has(u.a) ? '在县级单元中比较' : '在市州单元中比较'}。</p></section>`;
      if (fc) {
        const items = RG.texts[r.tx].split(/[；;]/).map(s => s.trim().replace(/。$/, '')).filter(Boolean);
        h += `<section><h4>建议措施<small>${P}–${end} 年</small></h4><div class="mtags">${r.mt.split('+').map((t, q) => `<span class="${q === 0 ? 'hi' : ''}">${esc(t)}</span>`).join('')}</div>
          <ol class="steps">${items.map(s => `<li>${esc(s)}。</li>`).join('')}</ol><p class="gen">由模型风险等级与措施模板生成，供规划参考，不是已批复的工程项目。</p></section>
          <section><h4>参考依据<small>${r.src.length} 份文件</small></h4><ul class="srcs">${r.src.map(srcItem).join('')}</ul></section>`;
      } else {
        h += `<section class="span2"><h4>往年措施：实际案例<small>${r.cs && r.cs.length ? r.cs.length + ' 份案例文件' : ''}</small></h4>${r.cs && r.cs.length ? `<div class="cases">${r.cs.map(caseCard).join('')}</div><p class="gen">仅列出与本地区直接相关、可核实的治理案例文件；措施表中的模板化历史描述不作展示。</p>`
          : `<div class="empty"><b>暂无实际案例记录</b>${esc(u.name)}在 2000–2025 年没有收录到可核实的治理案例文件。<br>措施表中的模板化历史描述不作展示。切换到 2030 年及以后可查看模型建议措施。</div>`}</section>`;
      }
    }
    const par = parentOf(u), sib = u.lv === 'county' ? peersOf(u) : childrenOf(u).length ? childrenOf(u) : provPeers(u);
    const ttl = u.lv === 'county' ? `${par.short}县区优先序` : childrenOf(u).length ? `${u.short}下辖县区优先序` : `${M.PROVS[u.pi]}市州优先序`;
    h += `<section><h4>${esc(ttl)}<small>${P} 年优先分</small></h4>${plist(sib, P, u)}</section>`;
  }
  body.innerHTML = h;
  body.querySelectorAll('[data-k]').forEach(b => b.onclick = () => { go(UNITS.get(b.dataset.k)); $('mapwrap').scrollIntoView({ behavior: M.REDUCE ? 'auto' : 'smooth', block: 'center' }); });
}
$('notesList').innerHTML = [CORE.kpiNote, RG.notes.met, RG.notes.proxy, RG.notes.att,
  '气候情景：SSP1-2.6、SSP2-4.5、SSP5-8.5 三种情景共用 2000–2025 年代理观测，2026–2050 年为同一 1 km 模型分别驱动的逐年结果；可在地图标题栏或情景曲线图例中切换。',
  '切换到 SSP1-2.6 或 SSP5-8.5 时，地图、风险指数、荒漠化占比、降水与气温随之切换；地下水位、大风日数两项代理指标、驱动因子归因和措施表仍为 SSP2-4.5 口径。',
  '气候情景曲线：市州、省级为县区面积加权，并与上方风险指数对齐；阴影为 90% 区间。',
  '地图叠加对比的面积统计为 1 km 栅格逐像元结果，与上方按措施表口径的荒漠化占比可能略有差异。',
  '代理字段只用于网站原型和模型敏感性展示，不应表述为县级实测气象、水文或因果归因。',
  '历史“往年措施”只展示实际案例文件（D16–D19）；其余县区显示“暂无实际案例记录”。来源编号与“数据来源”页一致。'].map(t => `<li>${esc(t)}</li>`).join('')
  + (CAL ? `<li>省级“官方口径”面积：${esc(CAL.areaDef)}；${CAL.anchorYear} 年五省合计 ${(CAL.anchorTotal / 1e4).toFixed(2)} 万km²。${esc(CAL.warning)}</li>
  <li>官方调查资料（A01、A02）及全部数据来源见 <a href="data.html">“数据来源”页</a>。</li>` : '');

/* =================== header, selectors, hash =================== */
const selP = $('selProv'), selC = $('selCity'), selK = $('selCounty');
M.prov.forEach(p => selP.appendChild(new Option(PROV_FULL[p.n], p.i)));
function renderHeader() {
  const u = state.u, p = mk('prov', u.pi), c = u.lv === 'prov' ? null : u.lv === 'city' ? u : mk('city', u.ci);
  selP.value = u.pi;
  selC.innerHTML = ''; selC.appendChild(new Option('全部市州', -1)); childrenOf(p).forEach(v => selC.appendChild(new Option(v.name, v.i))); selC.value = c ? c.i : -1;
  selK.innerHTML = ''; const kids = c ? childrenOf(c) : [];
  selK.appendChild(new Option(c && c.xp ? '（市辖即县级）' : '全部区县', -1)); kids.forEach(v => selK.appendChild(new Option(v.name, v.i))); selK.value = u.lv === 'county' ? u.i : -1; selK.disabled = !kids.length;
  const parts = [`<a href="index.html">西北五省区</a>`]; const chain = []; for (let v = u; v; v = parentOf(v)) chain.unshift(v);
  chain.forEach((v, n) => parts.push(n === chain.length - 1 ? `<b>${esc(v.name)}</b>` : `<a href="#a=${v.a}" data-k="${v.key}">${esc(v.name)}</a>`));
  $('crumb').innerHTML = parts.join('<i>/</i>'); $('crumb').querySelectorAll('[data-k]').forEach(a => a.onclick = e => { e.preventDefault(); go(UNITS.get(a.dataset.k)); });
  $('pageTitle').textContent = `${u.name}荒漠化风险预测`; document.title = `${u.name} · 地区预测 · 西北荒漠化平台`;
  $('mapTitle').textContent = `${u.short}及周边`;
  const par = parentOf(u); $('backTxt').textContent = par ? `返回${par.short}` : '返回西北全区';
}
selP.onchange = () => go(mk('prov', +selP.value));
selC.onchange = () => go(+selC.value < 0 ? mk('prov', +selP.value) : mk('city', +selC.value));
selK.onchange = () => go(+selK.value < 0 ? mk('city', +selC.value) : mk('county', +selK.value));
$('backBtn').onclick = () => { const p = parentOf(state.u); if (p) go(p); else M.navigate('index.html'); };
const hashStr = () => `#a=${state.u.a}&y=${curY()}${state.cmp ? `&c=${state.yA}-${state.yB}` : ''}${M.scn !== 'ssp245' ? `&sc=${M.scn}` : ''}`;
let hashT = 0; const writeHash = () => { clearTimeout(hashT); hashT = setTimeout(() => history.replaceState(null, '', hashStr()), 150); };
function unitFromAd(a) {
  const pv = Object.keys(PROV_CODE).find(k => PROV_CODE[k] === a); if (pv) return mk('prov', provIdx(pv));
  const ct = M.city.find(c => c.a === a); if (ct) return mk('city', ct.i);
  const k = M.county.findIndex(c => c.a === a); return k >= 0 ? unitOfCounty(k) : null;
}
function readHash() {
  const p = new URLSearchParams(location.hash.slice(1)), u = unitFromAd(p.get('a') || ''), y = +p.get('y'), c = (p.get('c') || '').split('-').map(Number);
  return { u, s: p.get('s'), sc: M.SC.codes.includes(p.get('sc')) ? p.get('sc') : 'ssp245', y: y >= Y0 && y <= Y1 ? y : null, c: c.length === 2 && c.every(v => v >= Y0 && v <= Y1) && c[0] !== c[1] ? c : null };
}
window.addEventListener('hashchange', () => { if (location.hash === hashStr()) return; const h = readHash();
  if (h.sc !== M.scn) pickScenario(h.sc);
  if (h.u && h.u !== state.u) go(h.u);
  if (h.c) setCmp(true, h.c); else { if (state.cmp) setCmp(false); if (h.y) setYear(h.y); } });

/* =================== navigation & setters =================== */
let goTok = 0;
function go(u, first) {
  if (!u) return;
  if (!M.hasProv(u.pi, true)) { const tok = ++goTok; M.needProv(u.pi, true).then(() => { if (tok === goTok) go(u, first); }, e => M.toast(e.message)); return; }   // 先加载该省数据
  ++goTok; const same = state.u === u; state.u = u; stopPlay();
  holeP = new Path2D('M-5000,-5000H5000V5000H-5000Z' + u.hole);
  dimPath.setAttribute('d', 'M-5000,-5000H5000V5000H-5000Z' + u.hole);
  const inU = new Set(u.ids), inP = M.PROVS[u.pi]; ctyPaths.forEach((p, i) => p.setAttribute('stroke-opacity', inU.has(i) ? .9 : M.county[i].p === inP ? .45 : .22));
  const line = u.lv === 'city' ? M.city[u.i].d : u.hole; selHalo.setAttribute('d', line); selLine.setAttribute('d', line);
  insProv.setAttribute('d', M.prov[u.pi].d); insUnit.setAttribute('d', u.lv === 'prov' ? '' : u.hole);
  renderHeader(); buildLabels(); renderAll(!first); if (state.cmp) { renderCstat(); prepare(); }
  if (!same) { userView = false; mv.setView(unitView(u), !first && !M.REDUCE); }
  writeHash();
  if (!first && !M.REDUCE) document.querySelectorAll('.prof .hero, .prof .kpis, .prof .drv, #measBody').forEach((n, i) => n.animate([{ opacity: .25, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 380, delay: i * 70, easing: 'cubic-bezier(.2,.7,.2,1)' }));
}
function renderAll(defer) {
  const Y = curY(); $('ybY').textContent = state.year; $('ybTag').textContent = M.statusZh(state.year); $('ybSc').textContent = M.scnOf(state.year);
  $('yb2a').textContent = state.yA; $('yb2b').textContent = state.yB; $('yearIn').value = state.year; $('selA').value = state.yA; $('selB').value = state.yB;
  $('trackArea').setAttribute('aria-valuenow', Y);
  renderProfile(); renderRank(); renderMapLegend(); updateLabels(); mv.dirty();
  // 下方图表与措施稍后分帧绘制，让地图缩放动画先流畅进行
  const tok = ++lowerTok, run = fns => { if (tok !== lowerTok || !fns.length) return; fns.shift()(); setTimeout(() => run(fns), 16); };
  if (defer && !M.REDUCE) setTimeout(() => run([renderEvo, renderTrack, renderScn, renderMeasures]), 120); else run([renderEvo, renderTrack, renderScn, renderMeasures]);
}
let lowerTok = 0;
function setYear(y) {
  y = clamp(Math.round(y), Y0, Y1); if (y === state.year && !state.cmp) return;
  const from = keyOf(state.layer, state.year); fade = SRC.has(from) && !M.REDUCE ? { from, t0: performance.now() } : null;
  const pOld = M.periodOf(state.year); state.year = y;
  quickUpdate(pOld !== M.periodOf(y)); prepare().then(() => { if (fade) fade.t0 = performance.now(); mv.dirty(); }); prefetch(y + 1); writeHash();
}
function quickUpdate(measures) {
  $('ybY').textContent = state.year; $('ybTag').textContent = M.statusZh(state.year); $('ybSc').textContent = M.scnOf(state.year); $('yearIn').value = state.year;
  $('yb2a').textContent = state.yA; $('yb2b').textContent = state.yB; $('selA').value = state.yA; $('selB').value = state.yB; $('trackArea').setAttribute('aria-valuenow', curY());
  renderProfile(); renderRank(); renderMapLegend(); updateLabels(); evoMarks(); placeTrack(); renderScn(); if (measures) renderMeasures(); else renderPeriods(); mv.dirty();
}
function setCompare(a, b) {
  a = clamp(a, Y0, Y1); b = clamp(b, Y0, Y1); if (a === b) { M.toast('A、B 两个年份不能相同'); renderAll(); return; }
  if (a > b) [a, b] = [b, a];
  const pOld = M.periodOf(state.yB); state.yA = a; state.yB = b; renderLyrBox(); renderCstat(); renderCallouts(); quickUpdate(pOld !== M.periodOf(b)); prepare(); writeHash();
}
function setCmp(on, ab) {
  state.cmp = on; stopPlay(); $('cmpBtn').setAttribute('aria-pressed', on);
  if (on) { if (ab) { state.yA = ab[0]; state.yB = ab[1]; } else { const c = state.year; if (c > BASE) { state.yA = BASE; state.yB = c; } else if (c < BASE) { state.yA = c; state.yB = BASE; } else { state.yA = BASE; state.yB = 2035; } } }
  else state.year = state.yB;
  $('yb1').hidden = on; $('yb2').hidden = !on; $('yinOne').hidden = on; $('yinAB').hidden = !on;
  document.querySelectorAll('[data-layer]').forEach(b => { b.disabled = on; b.classList.toggle('on', !on && b.dataset.layer === state.layer); });
  renderLyrBox(); renderCstat(); renderCallouts(); renderAll(); buildLabels(); prepare(); writeHash();
  mv.setView(unitView(state.u), true);
}
document.querySelectorAll('[data-layer]').forEach(b => b.onclick = () => {
  if (state.cmp) return; document.querySelectorAll('[data-layer]').forEach(x => x.classList.toggle('on', x === b)); state.layer = b.dataset.layer; fade = null;
  if (state.layer === 'change' && state.year === Y0) { M.toast('2000 年为起始年，已显示 2000→2001 年的变化'); state.year = 2001; quickUpdate(false); }
  renderMapLegend(); prepare(); writeHash();
});
$('cmpBtn').onclick = () => setCmp(!state.cmp);
/* 气候情景切换：只影响 2026 年及以后；统计、曲线与地图一并换算 */
const syncScn = M.bindScenario($('scnSeg'), () => {});
$('scnSeg').querySelectorAll('[data-scn]').forEach(b => b.onclick = () => pickScenario(b.dataset.scn));
function pickScenario(c, quiet) {
  if (c === M.scn) return; const from = state.cmp ? null : keyOf(state.layer, state.year);
  if (!M.setScenario(c)) return; syncScn();
  UNITS.forEach(u => { u._s = null; }); CMP = null; hovYear = hovAY = null; hatchCache.key = '';
  if (quiet) return;
  const to = keyOf(state.layer, state.year); fade = from && from !== to && SRC.has(from) && !M.REDUCE ? { from, t0: performance.now() } : null;
  renderAll(); if (state.cmp) { renderCstat(); renderCallouts(); }
  prepare().then(() => { if (fade) fade.t0 = performance.now(); mv.dirty(); }); writeHash();
  if (curY() <= BASE && !state.cmp) M.toast(`已切换到 ${M.scnName()}；${BASE} 年及以前三种情景相同，拖到 ${BASE + 1} 年以后可见差异`);
}
[$('selA'), $('selB')].forEach(s => YEARS.forEach(y => s.appendChild(new Option(y + (y > BASE ? ' 预测' : ' 观测'), y))));
$('selA').onchange = () => setCompare(+$('selA').value, state.yB); $('selB').onchange = () => setCompare(state.yA, +$('selB').value);
{ const yin = $('yearIn'); const jump = () => { const v = parseInt(yin.value, 10); if (!isFinite(v) || v < Y0 || v > Y1) { M.toast(`可选年份为 ${Y0}–${Y1} 年`); yin.value = state.year; return; } stopPlay(); setYear(v); };
  yin.addEventListener('keydown', e => { if (e.key === 'Enter') jump(); if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); stopPlay(); setYear(state.year + (e.key === 'ArrowUp' ? 1 : -1)); } });
  yin.addEventListener('change', jump); yin.addEventListener('focus', () => yin.select()); }
let playT = 0;
function stopPlay() { if (!state.playing) return; state.playing = false; const fp = $('fsPlay'); if (fp) fp.classList.remove('on'); clearTimeout(playT); $('icPlay').style.display = ''; $('icPause').style.display = 'none'; $('playBtn').setAttribute('aria-label', '播放'); }
async function tick() { if (!state.playing) return; if (state.year >= Y1) { stopPlay(); return; }
  const ny = state.year + 1; try { await source(state.layer, ny); } catch (e) { stopPlay(); return; } if (!state.playing) return;
  setYear(ny); prefetch(ny + 1); playT = setTimeout(tick, 700); }
$('playBtn').onclick = () => { if (state.playing) { stopPlay(); return; } if (state.cmp) setCmp(false);
  state.playing = true; $('icPlay').style.display = 'none'; $('icPause').style.display = ''; $('playBtn').setAttribute('aria-label', '暂停'); if (state.year >= Y1) setYear(Y0); playT = setTimeout(tick, 150); };
$('prevBtn').onclick = () => { stopPlay(); state.cmp ? setCompare(state.yA, state.yB - 1) : setYear(state.year - 1); };
$('nextBtn').onclick = () => { stopPlay(); state.cmp ? setCompare(state.yA, state.yB + 1) : setYear(state.year + 1); };
$('copyLink').onclick = async () => { history.replaceState(null, '', hashStr()); try { await navigator.clipboard.writeText(location.href); M.toast('链接已复制'); } catch (e) { M.toast('无法访问剪贴板，请从地址栏复制'); } };
document.querySelectorAll('nav.side [data-sub="measures"]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); $('measures').scrollIntoView({ behavior: M.REDUCE ? 'auto' : 'smooth' }); }));
if ('IntersectionObserver' in window) { const sub = document.querySelector('nav.side [data-sub="measures"]');
  new IntersectionObserver(es => es.forEach(en => sub && sub.classList.toggle('on', en.isIntersecting)), { rootMargin: '0px 0px -45% 0px' }).observe($('measures')); }
M.soonLinks();

/* =================== hover & click =================== */
const tip = $('tip'); let hovArr = null, hovYear = null, hovA = null, hovAY = null, raf = 0, lastEv = null, dragging = null;
async function ensureHover() { if (!CID) CID = await M.cidArr(); const y = curY(); await M.needYears([y]); if (hovYear !== y) { hovArr = await M.classArr(y); hovYear = y; } if (state.cmp && hovAY !== state.yA) { hovA = await M.classArr(state.yA); hovAY = state.yA; } }
function doHover() {
  raf = 0; const e = lastEv; if (!e || dragging) { tip.hidden = true; return; }
  if (!CID || hovYear !== curY() || !M.hasYears([curY()]) || (state.cmp && hovAY !== state.yA)) { ensureHover().then(() => { if (lastEv === e && !raf) raf = requestAnimationFrame(doHover); }); return; }
  const r = wrap.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top, [lo, la] = mv.lonlatAt(sx, sy), p = M.cellOf(lo, la);
  if (p < 0 || CID[p] === 65535 || hovArr[p] === 255) { tip.hidden = true; hovPath.setAttribute('d', ''); return; }
  const c = M.county[CID[p]], Y = curY(), K = CORE.kpiCounty[c.i][yi(Y)], cl = hovArr[p], inside = state.u.ids.includes(c.i);
  hovPath.setAttribute('d', c.d);
  let rows = state.cmp ? `<dt>A ${state.yA} 年格网</dt><dd>${hovA[p] === 255 ? "—" : chip(hovA[p])}</dd><dt>B ${Y} 年格网</dt><dd>${chip(cl)}</dd>` : `<dt>${Y} 年格网等级</dt><dd>${chip(cl)}</dd>`;
  rows += `<dt>县区风险指数</dt><dd>${K[0].toFixed(3)}</dd><dt>县区荒漠化占比</dt><dd>${K[1].toFixed(1)}%</dd>`;
  const nxt = clickTarget(c.i), act = nxt && nxt !== state.u ? `<div class="go">点击切换至 ${esc(nxt.name)} ›</div>` : '';
  tip.innerHTML = `<div class="th"><b>${esc(c.n)}</b><small>${esc(M.geo.city[c.c].n)}　${lo.toFixed(2)}°E ${la.toFixed(2)}°N</small></div><dl>${rows}</dl>${act}`;
  tip.hidden = false; tip.style.opacity = inside ? 1 : .92; const w = tip.offsetWidth, h = tip.offsetHeight;
  tip.style.left = (sx + 18 + w > mv.VW ? sx - w - 14 : sx + 18) + 'px'; tip.style.top = clamp(sy - h / 2, 8, mv.VH - h - 8) + 'px';
}
function clickTarget(ci) {
  const c = M.county[ci], u = state.u;
  if (u.lv === 'prov') return c.p === u.short ? mk('city', c.c) : mk('prov', provIdx(c.p));
  if (u.lv === 'city') return c.c === u.i ? unitOfCounty(ci) : mk('city', c.c);
  return unitOfCounty(ci);
}
const onUI = t => t.closest('.rl,.rcol,.lyrbox,.tip,.co');
wrap.addEventListener('pointerdown', e => { if (onUI(e.target)) return; M.dragStart(e); dragging = { x: e.clientX, y: e.clientY, v: { ...mv.view }, moved: false }; wrap.setPointerCapture(e.pointerId); tip.hidden = true; });
wrap.addEventListener('pointermove', e => {
  if (!dragging) { if (onUI(e.target)) { tip.hidden = true; return; } lastEv = e; if (!raf) raf = requestAnimationFrame(doHover); return; }
  const dx = e.clientX - dragging.x, dy = e.clientY - dragging.y; if (Math.hypot(dx, dy) > 4) dragging.moved = true;
  if (dragging.moved) { userView = true; mv.view = { ...dragging.v, cx: dragging.v.cx - dx / mv.view.s, cy: dragging.v.cy - dy / mv.view.s }; mv.apply(); }
});
wrap.addEventListener('pointerup', async e => { const d = dragging; dragging = null; if (!d || d.moved) return; if (!CID) CID = await M.cidArr();
  const r = wrap.getBoundingClientRect(), [lo, la] = mv.lonlatAt(e.clientX - r.left, e.clientY - r.top), p = M.cellOf(lo, la);
  if (p >= 0 && CID[p] !== 65535) { const t = clickTarget(CID[p]); if (t && t !== state.u) go(t); } });
wrap.addEventListener('pointerleave', () => { tip.hidden = true; hovPath.setAttribute('d', ''); lastEv = null; });

/* =================== 地图全屏 =================== */
function updFsYear() { const y = $('fsY'); if (!y) return; y.textContent = state.cmp ? `${state.yA} → ${state.yB}` : state.year; $('fsLab').textContent = state.cmp ? '对比年份' : M.statusZh(state.year); }
/* 平滑过渡：面板先切换为铺满窗口，再用裁剪框从原位置展开（退出时反向收回）。
   过渡期间保持同一地点停在同一屏幕位置，结束后再平滑缩放到适合当前地区的视图。 */
let fsBusy = false;
const rectOf = n => n.getBoundingClientRect();
const insetOf = r => `inset(${Math.max(0, r.top)}px ${Math.max(0, innerWidth - r.right)}px ${Math.max(0, innerHeight - r.bottom)}px ${Math.max(0, r.left)}px)`;
const swapMax = on => { mapPanel.classList.toggle('max', on); document.documentElement.classList.toggle('mapmax', on); };
const keepGeo = (v, a, b) => ({ s: v.s, cx: v.cx + ((b.left + b.width / 2) - (a.left + a.width / 2)) / v.s, cy: v.cy + ((b.top + b.height / 2) - (a.top + a.height / 2)) / v.s });
const fsSync = () => { lastSz = wrap.clientWidth + 'x' + wrap.clientHeight; tip.hidden = true; updFsYear(); renderMiniProf(); fitRcol(); };
const fsRefit = () => { if (!userView) mv.setView(unitView(state.u), !M.REDUCE); };
function setMax(on) {
  if (fsBusy || mapPanel.classList.contains('max') === on) return;
  $('fsBtn').setAttribute('aria-pressed', on); $('fsBtn').title = on ? '还原地图（Esc）' : '地图铺满窗口（Esc 退出）';
  const anim = !M.REDUCE && typeof mapPanel.animate === 'function', W0 = rectOf(wrap), v0 = { ...mv.view };
  if (on) {
    const P0 = rectOf(mapPanel);
    swapMax(true); mv.layout(); mv.view = keepGeo(v0, W0, rectOf(wrap)); mv.apply(); fsSync();
    if (!anim) { fsRefit(); return; }
    fsBusy = true;
    const a = mapPanel.animate([{ clipPath: insetOf(P0) }, { clipPath: 'inset(0px 0px 0px 0px)' }], { duration: 360, easing: 'cubic-bezier(.2,.7,.2,1)' });
    a.finished.then(() => { fsBusy = false; fsRefit(); });
  } else {
    swapMax(false); const P1 = rectOf(mapPanel), W1 = rectOf(wrap); swapMax(true);
    const done = () => { swapMax(false); mv.layout(); mv.view = keepGeo(v0, W0, W1); mv.apply(); fsSync(); fsRefit(); };
    if (!anim) { done(); return; }
    fsBusy = true; tip.hidden = true;
    const a = mapPanel.animate([{ clipPath: 'inset(0px 0px 0px 0px)' }, { clipPath: insetOf(P1) }], { duration: 320, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' });
    a.finished.then(() => { done(); a.cancel(); fsBusy = false; });
  }
}
$('fsBtn').onclick = () => setMax(!mapPanel.classList.contains('max'));
document.addEventListener('keydown', e => { if (e.key === 'Escape' && mapPanel.classList.contains('max')) setMax(false); });
$('fsPrev').onclick = () => $('prevBtn').click(); $('fsNext').onclick = () => $('nextBtn').click();
$('fsPlay').onclick = () => { $('playBtn').click(); $('fsPlay').classList.toggle('on', state.playing); };

/* =================== export =================== */
$('savePng').onclick = async () => {
  const out = document.createElement('canvas'); out.width = mv.canvas.width; out.height = mv.canvas.height; const x = out.getContext('2d'), D = mv.DPR;
  x.fillStyle = '#EDEFEB'; x.fillRect(0, 0, out.width, out.height);
  const svgImg = s => new Promise(res => { const c = s.cloneNode(true); c.setAttribute('xmlns', NS); c.setAttribute('font-family', 'Microsoft YaHei, PingFang SC, Noto Sans CJK SC, sans-serif');
    const img = new Image(); img.onload = () => res(img); img.onerror = () => res(null); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(c)); });
  const u = await svgImg(mv.svgU); if (u) x.drawImage(u, 0, 0, out.width, out.height); x.drawImage(mv.canvas, 0, 0);
  const o = await svgImg(mv.svgO); if (o) x.drawImage(o, 0, 0, out.width, out.height);
  x.font = `600 ${12.5 * D}px Microsoft YaHei, sans-serif`; x.textBaseline = 'middle';
  for (const L of LBL) { if (L.d.classList.contains('off')) continue; const [sx, sy] = mv.toScreen(L.v.lp[0], L.v.lp[1]), t = L.v.short, w = x.measureText(t).width + 12 * D;
    x.fillStyle = L.v === state.u ? '#1B252B' : '#fff'; x.fillRect(sx * D, sy * D - 11 * D, w, 22 * D); x.strokeStyle = '#1B252B'; x.strokeRect(sx * D, sy * D - 11 * D, w, 22 * D);
    x.fillStyle = L.v === state.u ? '#fff' : '#1B252B'; x.fillText(t, sx * D + 6 * D, sy * D); }
  x.fillStyle = '#1B252B'; x.font = `${14 * D}px Microsoft YaHei, sans-serif`; x.textBaseline = 'alphabetic';
  x.fillText(`${state.u.name}　${state.cmp ? `${state.yA} → ${state.yB} 叠加对比` : `${state.year} 年荒漠化等级（1 km）`}${curY() > BASE ? '　' + M.scnName() : ''}`, 16 * D, out.height - 16 * D);
  try { const a = document.createElement('a'); a.download = `${state.u.a}_${state.cmp ? state.yA + '_' + state.yB : state.year}${curY() > BASE ? '_' + M.scn : ''}.png`; a.href = out.toDataURL('image/png'); a.click(); } catch (err) { M.toast('当前浏览器不支持导出，请改用截图'); }
};

/* =================== resize =================== */
let rsT = 0, lastSz = '';
const rsObs = new ResizeObserver(() => { clearTimeout(rsT); rsT = setTimeout(() => { if (!state.u) return; renderEvo(); renderTrack(); renderScn();
  fitProf(); fitRcol();
  const sz = wrap.clientWidth + 'x' + wrap.clientHeight; if (sz !== lastSz) { lastSz = sz; if (!userView) mv.setView(unitView(state.u)); } placeLabels(); renderCallouts(); }, 120); });
rsObs.observe(document.querySelector('main')); rsObs.observe(wrap);

/* =================== init =================== */
(async () => {
  const h = readHash();
  if (h.y) state.year = h.y;
  if (h.sc !== M.scn) pickScenario(h.sc, true);
  const u0 = h.u || unitFromAd('620600');
  try { await M.needProv(u0.pi, true); } catch (e) { M.toast(e.message); }   // 所选地区所在省的逐年数据
  M.scaleBar($('scale'), mv);
  go(u0, true);
  if (h.c) setCmp(true, h.c);
  history.replaceState(null, '', hashStr());
  // 等第一张栅格就绪再显示，避免空白闪动（最多等 700 ms）
  await Promise.race([prepare(), new Promise(r => setTimeout(r, 700))]);
  if (h.s === 'measures') $('measures').scrollIntoView();
  M.reveal();
  if (!M.REDUCE && !M.internal) document.querySelectorAll('[data-anim]').forEach((n, i) => n.animate([{ opacity: 0, transform: 'translateY(14px)' }, { opacity: 1, transform: 'none' }], { duration: 480, delay: 60 + i * 100, easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'backwards' }));
  M.classArr(curY()).then(a => { M.setOccupancy(a); mv.dirty(); });
  M.cidArr().then(a => { CID = a; });
  prefetch(state.year + 1);
})();
})();
