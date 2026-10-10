/* 西北荒漠化平台 — 共用地图引擎
 * 经纬度几何解码、Web 墨卡托投影、逐年 1 km 栅格按需加载与解码、任意缩放下的栅格重投影绘制。
 * 依赖：assets/data/geo.js（NW_GEO）、assets/data/core.js（NW_CORE，精简版）；县区逐年数据按需读取 assets/data/year、prov；栅格瓦片位于 assets/tiles/。
 */
'use strict';
(() => {
const G = window.NW_GEO, CORE = window.NW_CORE;
const NS = 'http://www.w3.org/2000/svg';
const M = window.NWMap = {};

/* ---------- constants ---------- */
M.COL = ['#D3DEC8', '#F0DC9C', '#E2AE52', '#C4702F', '#7E3420'];
M.NAMES = ['稳定', '轻度', '中度', '重度', '极重度'];
M.CUTS = [0.32, 0.47, 0.62, 0.76];   // 风险指数（0–1）→ 等级
M.CONF = [{ c: '#F1E3BE', n: '低于 60%' }, { c: '#CFD3BC', n: '60%–70%' }, { c: '#97B4B6', n: '70%–80%' }, { c: '#5A8794', n: '80%–90%' }, { c: '#1A3441', n: '90% 及以上' }];
M.CHG = [{ n: '加重 2 级及以上', c: '#9E1B32' }, { n: '加重 1 级', c: '#E58A99' }, { n: '等级不变', c: '#E3E2D9' }, { n: '减轻 1 级', c: '#8CC5A2' }, { n: '减轻 2 级及以上', c: '#1E7B4D' }];
M.UP = '#C8102E'; M.DN = '#1E7B4D';
M.levelOf = ri => ri < M.CUTS[0] ? 0 : ri < M.CUTS[1] ? 1 : ri < M.CUTS[2] ? 2 : ri < M.CUTS[3] ? 3 : 4;
M.YEARS = CORE.years; M.Y0 = M.YEARS[0]; M.Y1 = M.YEARS[M.YEARS.length - 1]; M.BASE = 2025;
M.isAnchor = y => CORE.anchors.includes(y);
M.isFc = y => y > M.BASE;
M.statusZh = y => CORE.statusZh[y];
/* ---------- 气候情景：三情景共用 2000–2025 年历史，2026–2050 年各自预测 ----------
 * M.setScenario(code) 把 NW_CORE / NW_CAL 中的逐年统计整体切换到该情景，页面其余代码照常读取即可。 */
const SCN = window.NW_SCN, CAL0 = window.NW_CAL;
M.SCN = SCN;
M.SC = SCN ? { codes: SCN.codes, names: SCN.names } : { codes: ['ssp245'], names: ['SSP2-4.5'] };
M.scn = 'ssp245';
M.scnName = (c = M.scn) => M.SC.names[M.SC.codes.indexOf(c)];
M.scnOf = y => y > M.BASE ? M.scnName() : '代理观测';
M.tn = (kind, y, c = M.scn) => y > M.BASE && c !== 'ssp245' ? `${kind}_${c}_${y}` : `${kind}_${y}`;
/* 省级逐年统计随精简版 core.js / scen.js 一起加载；县区、市州逐年数据按需加载（见下方“按需数据”），先放入空表 */
const PF = ['prov', 'provConf', 'provLo', 'provHi', 'kpiProv'], CF = ['county', 'countyConf', 'countyLo', 'countyHi', 'kpiCounty'], TF = ['kpiCity'];
const NY = M.YEARS.length, NH = M.BASE - M.Y0 + 1, NC = G.county.length, NT = G.city.length;
const holes = n => Array.from({ length: n }, () => new Array(NY));
const DATA = {};
M.SC.codes.forEach(c => { DATA[c] = {}; CF.forEach(f => { DATA[c][f] = holes(NC); }); TF.forEach(f => { DATA[c][f] = holes(NT); }); });
PF.forEach(f => { DATA.ssp245[f] = CORE[f]; }); DATA.ssp245.meanConf = CORE.meanConf;
if (CAL0) Object.assign(DATA.ssp245, { calNw: CAL0.nw, calProv: CAL0.prov });
function scnData(c) {
  const d = DATA[c]; if (c === 'ssp245' || d.prov) return d;
  const S = SCN[c], o = DATA.ssp245, m2 = (a, b) => a.map((r, i) => r.slice(0, NH).concat(b[i]));
  PF.forEach(f => { d[f] = m2(o[f], S[f]); });
  d.meanConf = { ...o.meanConf }; SCN.years.forEach((y, k) => { d.meanConf[y] = S.meanConf[k]; });
  if (CAL0) { d.calNw = o.calNw.slice(0, NH).concat(S.calNw); d.calProv = m2(o.calProv, S.calProv); }
  return d;
}
CF.concat(TF).forEach(f => { CORE[f] = DATA.ssp245[f]; });
M.scnCal = c => { const d = scnData(c); return { nw: d.calNw, prov: d.calProv }; };   // 任一情景的官方口径逐年序列（51 年）
const scnHooks = [];
M.onScenario = f => scnHooks.push(f);
M.setScenario = c => {
  if (!M.SC.codes.includes(c) || c === M.scn) return false;
  const d = scnData(c); PF.concat(CF, TF).forEach(f => { CORE[f] = d[f]; }); CORE.meanConf = d.meanConf;
  if (CAL0) { CAL0.nw = d.calNw; CAL0.prov = d.calProv; }
  M.scn = c; scnHooks.forEach(f => f(c)); return true;
};

/* ---------- 按需数据 ----------
 * year/k_YYYY.js（及 k_ssp126_YYYY.js 等）：该年全部县区 KPI，约 9 KB，首页按所看年份加载；
 * prov/p_省代码.js：该省县区、市州逐年等级面积、置信度、区间与 KPI（三情景）；prov/r_省代码.js：该省气象、归因、情景曲线与措施（地区页）。
 * 2025 年及以前三情景共用，读入时同时写入三个情景的表。页面在渲染前用 M.needYears / M.needProv 等待，M.hasYears / M.hasProv 同步判断。 */
const PCODE = { 新疆: '650000', 甘肃: '620000', 青海: '630000', 宁夏: '640000', 陕西: '610000' };
const SELF = (document.currentScript && document.currentScript.src) || '', VQ = (SELF.match(/\?v=[^&#]*/) || [''])[0];
const DBASE = SELF ? SELF.replace(/js\/mapcore\.js.*$/, '') : 'assets/';
const RG0 = window.NW_REGION;
if (RG0) {   // 地区页：分省数据读入后填到这些表里
  RG0.met = holes(NC); RG0.att = holes(NC); RG0.measures = RG0.measures || {};
  SCN.chart.county = new Array(NC); SCN.chart.city = new Array(NT);
  ['ssp126', 'ssp585'].forEach(c => { if (SCN[c]) SCN[c].met = new Array(NC); });
}
const putRow = (c, f, i, row) => {   // row 为 51 年（ssp245）或 25 年（其余情景，仅 2026 年起）
  if (c === 'ssp245') { const dst = DATA.ssp245[f][i]; for (let k = 0; k < row.length; k++) dst[k] = row[k];
    M.SC.codes.forEach(o => { if (o === 'ssp245') return; const r = DATA[o][f][i]; for (let k = 0; k < NH; k++) r[k] = row[k]; }); }
  else { const r = DATA[c][f][i]; for (let k = 0; k < row.length; k++) r[NH + k] = row[k]; }
};
const MERGE = {
  k(name, d) { const m = name.match(/^k_(?:(ssp\d+)_)?(\d{4})$/), c = m[1] || 'ssp245', k = M.yi(+m[2]);
    const tgt = c === 'ssp245' && k < NH ? M.SC.codes : [c]; tgt.forEach(o => { const K = DATA[o].kpiCounty; d.forEach((v, i) => { K[i][k] = v; }); }); },
  p(name, d) { for (const c in d.s) { if (!DATA[c]) continue; const S = d.s[c];
      CF.forEach(f => S[f].forEach((row, j) => putRow(c, f, d.ci[j], row))); TF.forEach(f => S[f].forEach((row, j) => putRow(c, f, d.ti[j], row))); } },
  r(name, d) { if (!RG0) return;
    d.ci.forEach((i, j) => { RG0.met[i] = d.met[j]; RG0.att[i] = d.att[j]; SCN.chart.county[i] = d.chartCounty[j]; for (const c in d.smet) if (SCN[c]) SCN[c].met[i] = d.smet[c][j]; });
    d.ti.forEach((i, j) => { SCN.chart.city[i] = d.chartCity[j]; });
    Object.assign(RG0.measures, d.measures); },
};
const chunkDone = new Set(), chunkWait = new Map();
window.NW_PUT = (name, d) => { MERGE[name[0]](name, d); chunkDone.add(name); };
M.chunk = name => {
  if (chunkDone.has(name)) return Promise.resolve();
  if (chunkWait.has(name)) return chunkWait.get(name);
  const p = new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = DBASE + 'data/' + (name[0] === 'k' ? 'year/' : 'prov/') + name + '.js' + VQ; s.async = true;
    s.onload = () => { s.remove(); chunkWait.delete(name); if (chunkDone.has(name)) res(); else rej(new Error('数据文件内容有误 ' + name)); };
    s.onerror = () => { s.remove(); chunkWait.delete(name); rej(new Error('无法加载数据文件 ' + name)); };
    document.head.appendChild(s);
  });
  chunkWait.set(name, p); return p;
};
const yName = (y, c) => y > M.BASE && c !== 'ssp245' ? `k_${c}_${y}` : `k_${y}`;
const pNames = (pi, region) => { const a = PCODE[M.PROVS[pi]]; return region ? ['p_' + a, 'r_' + a] : ['p_' + a]; };
M.hasYears = (ys, c = M.scn) => ys.every(y => chunkDone.has(yName(y, c)));
M.needYears = (ys, c = M.scn) => Promise.all([...new Set(ys)].map(y => M.chunk(yName(y, c))));
M.hasProv = (pi, region) => pNames(pi, region).every(n => chunkDone.has(n));
M.needProv = (pi, region) => Promise.all(pNames(pi, region).map(M.chunk));
/* 情景选择器：按钮 [data-scn]，并在地址栏 #s= 中保留 */
M.bindScenario = (root, onChange) => {
  const btns = [...root.querySelectorAll('[data-scn]')];
  const sync = () => btns.forEach(b => { const on = b.dataset.scn === M.scn; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
  btns.forEach(b => b.onclick = () => { if (M.setScenario(b.dataset.scn)) { sync(); onChange(b.dataset.scn); } });
  sync(); return sync;
};
M.periodOf = y => Math.min(M.Y1, Math.floor(y / 5) * 5);   // 措施周期（五年）
const clamp = M.clamp = (v, a, b) => Math.max(a, Math.min(b, v));
M.lerp = (a, b, t) => a + (b - a) * t;
M.eo = x => 1 - Math.pow(1 - x, 3);
M.REDUCE = matchMedia('(prefers-reduced-motion: reduce)').matches;
M.el = (t, a = {}, p) => { const e = document.createElementNS(NS, t); for (const k in a) e.setAttribute(k, a[k]); if (p) p.appendChild(e); return e; };
M.fmtInt = v => Math.round(v).toLocaleString('en-US');

/* ---------- projection: Web Mercator（EPSG:3857，与天地图 w 系列瓦片一致）, map units = 1000 × radians, y down ---------- */
const R = Math.PI / 180, MAXLAT = 85.0511287798;
M.proj = (lon, lat) => [1000 * lon * R, -1000 * Math.log(Math.tan(Math.PI / 4 + clamp(lat, -MAXLAT, MAXLAT) * R / 2))];
M.unproj = (x, y) => [x / 1000 / R, (2 * Math.atan(Math.exp(-y / 1000)) - Math.PI / 2) / R];

/* ---------- geometry ---------- */
M.dec = a => { const n = a.length / 2, o = new Float64Array(a.length); let x = a[0], y = a[1]; o[0] = x / 1000; o[1] = y / 1000;
  for (let i = 1; i < n; i++) { x += a[2 * i]; y += a[2 * i + 1]; o[2 * i] = x / 1000; o[2 * i + 1] = y / 1000; } return o; };
function ringPath(a, closed) { const p = M.dec(a); let s = ''; for (let i = 0; i < p.length; i += 2) { const [x, y] = M.proj(p[i], p[i + 1]); s += (i ? 'L' : 'M') + x.toFixed(3) + ',' + y.toFixed(3); } return s + (closed ? 'Z' : ''); }
M.path = (rings, closed = true) => rings.map(r => ringPath(r, closed)).join('');
function bboxOf(rings) { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const r of rings) { const p = M.dec(r); for (let i = 0; i < p.length; i += 2) { const [x, y] = M.proj(p[i], p[i + 1]); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); } } return [x0, y0, x1, y1]; }
M.geo = G;
M.county = G.county.map((c, i) => ({ ...c, i, d: M.path(c.r), bb: bboxOf(c.r), lp: M.proj(c.l[0], c.l[1]) }));
M.city = G.city.map((c, i) => ({ ...c, i, d: M.path(c.o, false), bb: c.m.map(k => M.county[k].bb).reduce((a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]), lp: M.proj(c.l[0], c.l[1]) }));
M.prov = G.prov.map((p, i) => ({ ...p, i, d: M.path(p.r), bb: bboxOf(p.r), lp: M.proj(...G.provLabel[p.n]) }));
M.PROVS = G.prov.map(p => p.n);
M.nwPath = M.path(G.nw); M.nwBB = bboxOf(G.nw);
M.contextPath = M.path(G.context);
M.graticule = (() => { let s = ''; for (let lo = 75; lo <= 110; lo += 5) { s += 'M'; for (let la = 30; la <= 51; la += 1) { const [x, y] = M.proj(lo, la); s += (la > 30 ? 'L' : '') + x.toFixed(2) + ',' + y.toFixed(2); } }
  for (let la = 32; la <= 50; la += 4) { s += 'M'; for (let lo = 70; lo <= 116; lo += 1) { const [x, y] = M.proj(lo, la); s += (lo > 70 ? 'L' : '') + x.toFixed(2) + ',' + y.toFixed(2); } } return s; })();

/* ---------- tiles (JS-wrapped PNG data URIs so pixels stay readable from file://) ---------- */
const GR = G.grid, GW = GR.w, GH = GR.h; M.GW = GW; M.GH = GH;
const tileWait = new Map(), tileImg = new Map(), LIMIT_IMG = 10;
window.NW_TILE = (name, uri) => { const img = new Image(); img.onload = () => { tileImg.set(name, img); (tileWait.get(name) || []).forEach(f => f(img)); tileWait.delete(name); trimImg(); }; img.src = uri; };
function trimImg() { let guard = tileImg.size; while (tileImg.size > LIMIT_IMG && guard-- > 0) { const k = tileImg.keys().next().value; const v = tileImg.get(k); tileImg.delete(k); if (k === 'cid') tileImg.set(k, v); } }
const base = (document.currentScript && document.currentScript.src) ? document.currentScript.src.replace(/js\/mapcore\.js.*$/, '') : 'assets/';
M.tile = name => new Promise((res, rej) => {
  if (tileImg.has(name) && tileImg.get(name)) { const img = tileImg.get(name); tileImg.delete(name); tileImg.set(name, img); return res(img); }
  if (tileWait.has(name)) { tileWait.get(name).push(res); return; }
  tileWait.set(name, [res]);
  const s = document.createElement('script'); s.src = base + 'tiles/' + name + '.js'; s.async = true;
  s.onerror = () => { tileWait.delete(name); rej(new Error('无法加载数据文件 ' + name)); }; s.onload = () => s.remove(); document.head.appendChild(s);
});
M.hasTile = name => tileImg.has(name) && !!tileImg.get(name);
function pixels(img) { const c = document.createElement('canvas'); c.width = GW; c.height = GH; const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0); return x.getImageData(0, 0, GW, GH).data; }
const arrCache = new Map();
function lru(map, k, v, max) { map.set(k, v); while (map.size > max) map.delete(map.keys().next().value); return v; }
const R2CLS = new Int16Array(256).fill(-1); M.COL.forEach((h, k) => { R2CLS[parseInt(h.slice(1, 3), 16)] = k; });
M.classArr = async (y, c = M.scn) => { const name = M.tn('cls', y, c), k = 'c' + name; if (arrCache.has(k)) return arrCache.get(k);
  const d = pixels(await M.tile(name)), o = new Uint8Array(GW * GH).fill(255);
  for (let p = 0, q = 0; p < o.length; p++, q += 4) if (d[q + 3] > 127) { const c = R2CLS[d[q]]; o[p] = c < 0 ? 255 : c; }
  return lru(arrCache, k, o, 10); };
let cidArr = null;
M.cidArr = async () => { if (cidArr) return cidArr; const d = pixels(await M.tile('cid')), o = new Uint16Array(GW * GH).fill(65535);
  for (let p = 0, q = 0; p < o.length; p++, q += 4) if (d[q + 3] > 127) o[p] = d[q] | (d[q + 1] << 8); return (cidArr = o); };
M.cellOf = (lon, lat) => { const j = Math.floor((lon - GR.x0) / GR.res), i = Math.floor((GR.y0 - lat) / GR.res); return (i < 0 || j < 0 || i >= GH || j >= GW) ? -1 : i * GW + j; };
M.cellArea = i => { const lat = GR.y0 - GR.res * (Math.floor(i / GW) + .5); return (6371.0072 * GR.res * Math.PI / 180) ** 2 * Math.cos(lat * R); };
const ROWA = new Float64Array(GH); for (let i = 0; i < GH; i++) ROWA[i] = (6371.0072 * GR.res * Math.PI / 180) ** 2 * Math.cos((GR.y0 - GR.res * (i + .5)) * R);
M.rowArea = ROWA;
/* RGBA canvas (GW×GH) from a per-cell colour function; rgba(i) returns packed 0xAABBGGRR or 0 */
M.gridCanvas = (fill, bbox) => {
  const c = document.createElement('canvas'); c.width = GW; c.height = GH; const x = c.getContext('2d');
  const [j0, i0, j1, i1] = bbox || [0, 0, GW, GH], w = j1 - j0, h = i1 - i0; if (w <= 0 || h <= 0) return c;
  const im = x.createImageData(w, h), u = new Uint32Array(im.data.buffer);
  for (let i = i0, q = 0; i < i1; i++) for (let j = j0; j < j1; j++, q++) { const v = fill(i * GW + j); if (v) u[q] = v; }
  x.putImageData(im, j0, i0); return c; };
/* RGBA canvas covering only bbox [j0,i0,j1,i1]; drawGrid places it via .off */
M.cropCanvas = (w, h, j0, i0) => { const c = document.createElement('canvas'); c.width = Math.max(1, w); c.height = Math.max(1, h); c.off = [j0, i0]; return c; };
M.packRGBA = (hex, a = 255) => (a << 24) | (parseInt(hex.slice(5, 7), 16) << 16) | (parseInt(hex.slice(3, 5), 16) << 8) | parseInt(hex.slice(1, 3), 16);

/* occupancy at 10-cell blocks, to skip empty blocks */
let OCC = null, OW = Math.ceil(GW / 10), OH = Math.ceil(GH / 10);
M.setOccupancy = cls => { OCC = new Uint8Array(OW * OH); for (let i = 0; i < GH; i++) { const r = (i / 10 | 0) * OW; for (let j = 0; j < GW; j++) if (cls[i * GW + j] !== 255) OCC[r + (j / 10 | 0)] = 1; } };
function occupied(i0, j0, i1, j1) { if (!OCC) return true; for (let a = i0 / 10 | 0; a <= ((i1 - 1) / 10 | 0); a++) for (let b = j0 / 10 | 0; b <= ((j1 - 1) / 10 | 0); b++) if (OCC[a * OW + b]) return true; return false; }

/* ---------- MapView ---------- */
class MapView {
  constructor(wrap, { onRender, onView } = {}) {
    this.wrap = wrap; this.onRender = onRender; this.onView = null;
    this.svgU = M.el('svg', { class: 'mv-under', 'aria-hidden': 'true' }); this.canvas = document.createElement('canvas'); this.canvas.className = 'mv-raster';
    this.svgO = M.el('svg', { class: 'mv-over', 'aria-hidden': 'true' });
    wrap.prepend(this.svgO); wrap.prepend(this.canvas); wrap.prepend(this.svgU);
    this.ctx = this.canvas.getContext('2d');
    this.frame = document.createElement('canvas'); this.fx = this.frame.getContext('2d');
    this.view = { cx: 0, cy: 0, s: 1 }; this.minS = 0.1; this.maxS = 1e5; this.raf = 0; this.fixed = []; this.post = [];
    this.layout(); this.onView = onView; new ResizeObserver(() => { this.layout(); }).observe(wrap);
  }
  layout() { const r = this.wrap.getBoundingClientRect(); this.VW = Math.max(1, r.width); this.VH = Math.max(1, r.height); this.DPR = Math.min(2, devicePixelRatio || 1);
    this.canvas.width = this.frame.width = Math.round(this.VW * this.DPR); this.canvas.height = this.frame.height = Math.round(this.VH * this.DPR);
    this.canvas.style.width = this.VW + 'px'; this.canvas.style.height = this.VH + 'px'; this.apply(); }
  fitBox(bb, pad = 30, extra = {}) { const [x0, y0, x1, y1] = bb, l = extra.left || 0, rr = extra.right || 0, t = extra.top || 0, b = extra.bottom || 0;
    const s = Math.min((this.VW - 2 * pad - l - rr) / Math.max(1e-6, x1 - x0), (this.VH - 2 * pad - t - b) / Math.max(1e-6, y1 - y0));
    return { s, cx: (x0 + x1) / 2 - (l - rr) / 2 / s, cy: (y0 + y1) / 2 - (t - b) / 2 / s }; }
  setView(v, animate) {
    const to = { ...v }; to.s = clamp(to.s, this.minS, this.maxS);
    if (!animate || M.REDUCE) { this.view = to; this.apply(); return Promise.resolve(); }
    const from = { ...this.view }, t0 = performance.now(), dur = 600;
    cancelAnimationFrame(this.anim);
    return new Promise(res => { const step = now => { const p = M.eo(clamp((now - t0) / dur, 0, 1)), ls = Math.log(from.s) + (Math.log(to.s) - Math.log(from.s)) * p;
      this.view = { s: Math.exp(ls), cx: M.lerp(from.cx, to.cx, p), cy: M.lerp(from.cy, to.cy, p) }; this.apply(); if (p < 1) this.anim = requestAnimationFrame(step); else res(); };
      this.anim = requestAnimationFrame(step); }); }
  zoomAt(f, sx, sy) { const [mx, my] = this.toMap(sx, sy), s = clamp(this.view.s * f, this.minS, this.maxS);
    this.view = { s, cx: mx - (sx - this.VW / 2) / s, cy: my - (sy - this.VH / 2) / s }; this.apply(); }
  toMap(sx, sy) { const v = this.view; return [v.cx + (sx - this.VW / 2) / v.s, v.cy + (sy - this.VH / 2) / v.s]; }
  toScreen(mx, my) { const v = this.view; return [(mx - v.cx) * v.s + this.VW / 2, (my - v.cy) * v.s + this.VH / 2]; }
  lonlatAt(sx, sy) { return M.unproj(...this.toMap(sx, sy)); }
  apply() {
    const v = this.view, w = this.VW / v.s, h = this.VH / v.s, vb = `${v.cx - w / 2} ${v.cy - h / 2} ${w} ${h}`;
    for (const s of [this.svgU, this.svgO]) { s.setAttribute('viewBox', vb); s.setAttribute('width', this.VW); s.setAttribute('height', this.VH); }
    for (const t of this.fixed) t(v.s);
    for (const f of this.post) f(v);
    this.dirty(); if (this.onView) this.onView(v);
  }
  /* elements whose on-screen size must stay constant */
  label(parent, x, y, text, attrs, fs, sw) { const t = M.el('text', Object.assign({ x, y, 'text-anchor': 'middle', 'paint-order': 'stroke', 'stroke-linejoin': 'round' }, attrs), parent); t.textContent = text;
    const upd = s => { t.setAttribute('font-size', fs / s); if (sw) t.setAttribute('stroke-width', sw / s); }; upd(this.view.s); this.fixed.push(upd); return t; }
  pinGroup(parent, x, y) { const g = M.el('g', {}, parent), inner = M.el('g', {}, g); const upd = s => g.setAttribute('transform', `translate(${x},${y}) scale(${1 / s})`); upd(this.view.s); this.fixed.push(upd); return inner; }
  dirty() { if (!this.raf) this.raf = requestAnimationFrame(() => { this.raf = 0; this.render(); }); }
  render() { const x = this.ctx; x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, this.canvas.width, this.canvas.height); if (this.onRender) this.onRender(this); }
  /* draw a GW×GH grid-aligned source (image/canvas) into ctx (default: the visible canvas), re-projected for the current view */
  drawGrid(src, { ctx = this.ctx, alpha = 1, viaFrame = false, bbox } = {}) {
    if (!src) return;
    const target = viaFrame ? this.fx : ctx, D = this.DPR, v = this.view;
    if (viaFrame) { target.setTransform(1, 0, 0, 1, 0, 0); target.clearRect(0, 0, this.frame.width, this.frame.height); }
    // visible lon/lat range
    let lo0 = 999, lo1 = -999, la0 = 999, la1 = -999;
    for (const [a, b] of [[0, 0], [this.VW, 0], [0, this.VH], [this.VW, this.VH], [this.VW / 2, 0], [this.VW / 2, this.VH], [0, this.VH / 2], [this.VW, this.VH / 2]]) { const [lo, la] = this.lonlatAt(a, b); lo0 = Math.min(lo0, lo); lo1 = Math.max(lo1, lo); la0 = Math.min(la0, la); la1 = Math.max(la1, la); }
    let j0 = clamp(Math.floor((lo0 - GR.x0) / GR.res) - 2, 0, GW), j1 = clamp(Math.ceil((lo1 - GR.x0) / GR.res) + 2, 0, GW);
    let i0 = clamp(Math.floor((GR.y0 - la1) / GR.res) - 2, 0, GH), i1 = clamp(Math.ceil((GR.y0 - la0) / GR.res) + 2, 0, GH);
    const off = src.off || null; if (off) bbox = bbox ? [Math.max(bbox[0], off[0]), Math.max(bbox[1], off[1]), Math.min(bbox[2], off[0] + src.width), Math.min(bbox[3], off[1] + src.height)] : [off[0], off[1], off[0] + src.width, off[1] + src.height];
    if (bbox) { j0 = Math.max(j0, bbox[0]); i0 = Math.max(i0, bbox[1]); j1 = Math.min(j1, bbox[2]); i1 = Math.min(i1, bbox[3]); }
    if (j1 <= j0 || i1 <= i0) return;
    const cellPx = v.s * 1000 * GR.res * R * 0.8;          // approximate on-screen size of one cell
    const B = clamp(Math.floor(40 / Math.max(cellPx, 1e-3)), 2, 200);
    target.imageSmoothingEnabled = cellPx < 1.4; target.imageSmoothingQuality = 'medium';
    const P = (u, w) => { const [x, y] = M.proj(GR.x0 + GR.res * u, GR.y0 - GR.res * w); return [((x - v.cx) * v.s + this.VW / 2) * D, ((y - v.cy) * v.s + this.VH / 2) * D]; };
    for (let bi = i0 - (i0 % B); bi < i1; bi += B) for (let bj = j0 - (j0 % B); bj < j1; bj += B) {
      const u0 = Math.max(bj, j0), w0 = Math.max(bi, i0), u1 = Math.min(bj + B, j1), w1 = Math.min(bi + B, i1);
      if (u1 <= u0 || w1 <= w0 || !occupied(w0, u0, w1, u1)) continue;
      const tl = P(u0, w0), tr = P(u1, w0), bl = P(u0, w1), du = u1 - u0, dw = w1 - w0;
      const a = (tr[0] - tl[0]) / du, b = (tr[1] - tl[1]) / du, c = (bl[0] - tl[0]) / dw, d = (bl[1] - tl[1]) / dw;
      target.setTransform(a, b, c, d, tl[0] - a * u0 - c * w0, tl[1] - b * u0 - d * w0);
      if (off) { const ow = Math.min(off[0] + src.width - u0, du + 1), oh = Math.min(off[1] + src.height - w0, dw + 1); target.drawImage(src, u0 - off[0], w0 - off[1], ow, oh, u0, w0, ow, oh); continue; }
      const ow = Math.min(GW - u0, du + 1), oh = Math.min(GH - w0, dw + 1);
      target.drawImage(src, u0, w0, ow, oh, u0, w0, ow, oh);
    }
    target.setTransform(1, 0, 0, 1, 0, 0);
    if (viaFrame) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = alpha; ctx.drawImage(this.frame, 0, 0); ctx.globalAlpha = 1; }
  }
}
M.MapView = MapView;

/* ---------- 天地图在线矢量底图：vec（底图）在专题栅格之下，cva（注记）在其上；DOM 图片层，不影响专题图层 ---------- */
const TDT = M.TDT = (window.NW_CONFIG && window.NW_CONFIG.tianditu) || {};
const WORLD = 2000 * Math.PI, HALF = WORLD / 2;
M.basemap = (mv, credit) => {
  const wrap = mv.wrap, tk = String(TDT.tk || '').trim();
  const layer = cls => { const d = document.createElement('div'); d.className = 'mv-tiles ' + cls; d.setAttribute('aria-hidden', 'true'); return d; };
  const lv = layer('vec'), lc = layer('cva'); wrap.insertBefore(lv, mv.svgU); wrap.insertBefore(lc, mv.svgO);
  const st = { mode: tk ? 'loading' : 'off', ok: 0, err: 0, want: null }, tiles = new Map();
  const url = (ly, z, x, y) => `https://t${(x + y) % 8}.tianditu.gov.cn/${ly}_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${ly}&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX=${z}&TILEROW=${y}&TILECOL=${x}&tk=${encodeURIComponent(tk)}`;
  const place = (t, v) => { const tw = WORLD / 2 ** t.z, T = tw * v.s; t.img.style.transform = `translate(${(-HALF + t.c * tw - v.cx) * v.s + mv.VW / 2}px,${(-HALF + t.r * tw - v.cy) * v.s + mv.VH / 2}px)`; t.img.style.width = t.img.style.height = (T + .6) + 'px'; };
  const clear = () => { for (const t of tiles.values()) t.img.remove(); tiles.clear(); };
  function setMode(m) { st.mode = m; wrap.classList.toggle('tdt', m === 'on'); if (m === 'off') clear(); renderCredit(); }
  function prune() { if (!st.want) return; for (const k of st.want) { const t = tiles.get(k); if (t && !t.loaded) return; }
    for (const [k, t] of tiles) if (!st.want.has(k)) { t.img.remove(); tiles.delete(k); } }
  function update(v) {
    if (st.mode === 'off') return;
    const z = clamp(Math.round(Math.log2(v.s * WORLD / 256)), 2, 18), n = 2 ** z, tw = WORLD / n;
    const x0 = v.cx - mv.VW / 2 / v.s, x1 = v.cx + mv.VW / 2 / v.s, y0 = v.cy - mv.VH / 2 / v.s, y1 = v.cy + mv.VH / 2 / v.s;
    const c0 = Math.floor((x0 + HALF) / tw), c1 = Math.floor((x1 + HALF) / tw), r0 = clamp(Math.floor((y0 + HALF) / tw), 0, n - 1), r1 = clamp(Math.floor((y1 + HALF) / tw), 0, n - 1);
    const want = new Set();
    for (const [ly, host] of [['vec', lv], ['cva', lc]]) for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      const key = `${ly}/${z}/${c}/${r}`; want.add(key); let t = tiles.get(key);
      if (!t) { const img = new Image(); img.alt = ''; img.draggable = false; img.decoding = 'async'; t = { img, z, c, r, loaded: false }; tiles.set(key, t);
        img.onload = () => { t.loaded = true; img.classList.add('ld'); st.ok++; if (st.mode === 'loading') setMode('on'); prune(); };
        img.onerror = () => { st.err++; img.remove(); tiles.delete(key); if (st.mode === 'loading' && !st.ok && st.err >= 4) setMode('off'); };
        img.src = url(ly, z, ((c % n) + n) % n, r); host.appendChild(img); }
      t.img.style.zIndex = 2; place(t, v);
    }
    st.want = want;
    for (const [k, t] of tiles) if (!want.has(k)) { if (t.z === z) { t.img.remove(); tiles.delete(k); } else { t.img.style.zIndex = 1; place(t, v); } }
    if (tiles.size > 360) for (const [k, t] of tiles) { if (tiles.size <= 300) break; if (!want.has(k)) { t.img.remove(); tiles.delete(k); } }
    prune();
  }
  /* 地图下方说明条：底图名称、审图号、数据来源；专题层声明与不透明度 */
  const txt = document.createElement('span'); txt.className = 'ct';
  const op = document.createElement('label'); op.className = 'op'; op.title = '专题栅格图层（本项目模型结果）的不透明度';
  op.innerHTML = '<span>专题层</span><input type="range" min="0" max="100" value="100" aria-label="专题层不透明度"><b class="num">100%</b>';
  const opIn = op.querySelector('input'), opB = op.querySelector('b');
  opIn.addEventListener('input', () => { mv.canvas.style.opacity = opIn.value / 100; opB.textContent = opIn.value + '%'; });
  function renderCredit() { if (!credit) return;
    const on = st.mode === 'on';
    txt.innerHTML = (on ? `<b>底图：${TDT.name || '天地图'}</b><span>审图号：${TDT.approval || ''}</span><span>数据来源：${TDT.source || ''}</span>`
      : `<b>底图：简化示意底图</b><span>${tk ? (st.mode === 'loading' ? '正在连接天地图…' : '天地图暂时无法访问（离线或密钥无效）') : '未配置天地图密钥（见 assets/js/config.js）'}</span>`)
      + '<em>专题内容为本项目模型结果</em><span class="mut">统计用行政区界线：DataV GeoAtlas</span>'; }
  if (credit) { credit.append(txt, op); }
  wrap.classList.toggle('tdt', false); renderCredit();
  mv.post.push(update); update(mv.view);
  return st;
};

/* ---------- small helpers shared by pages ---------- */
M.scaleBar = (svg, mv) => {
  svg.innerHTML = ''; const lat = M.unproj(mv.view.cx, mv.view.cy)[1], kmpx = mv.view.s * 1000 / (6371.0072 * Math.cos(lat * R)); let km = 1000;   // 墨卡托比例随纬度变化，取视图中心纬度
  for (const t of [1000, 500, 400, 200, 100, 50, 40, 20, 10, 5, 4, 2, 1]) if (t * kmpx <= 180) { km = t; break; }
  const L = km * kmpx, g = M.el('g', { transform: 'translate(34,6)' }, svg);
  M.el('path', { d: 'M12 2l7 22-7-5-7 5z', fill: '#1B252B' }, M.el('g', { transform: 'translate(0,2) scale(.85)' }, svg));
  const n = M.el('text', { x: 10.5, y: 33, 'font-size': 10, 'text-anchor': 'middle', fill: '#1B252B', 'font-weight': 700 }, svg); n.textContent = 'N';
  M.el('rect', { x: 0, y: 4, width: L / 2, height: 6, fill: '#1B252B' }, g); M.el('rect', { x: L / 2, y: 4, width: L / 2, height: 6, fill: '#fff', stroke: '#1B252B', 'stroke-width': 1 }, g);
  [[0, '0', 'middle'], [L / 2, String(km / 2), 'middle'], [L, String(km), 'middle'], [L + 14, 'km', 'start']].forEach(([x, t, a]) => { const e = M.el('text', { x, y: 24, 'font-size': 11, 'text-anchor': a, fill: '#4B575E', 'font-family': 'Bahnschrift, Inter, sans-serif' }, g); e.textContent = t; });
};
/* 页面切换、提示条等见 nav.js */
const HTML = document.documentElement, NV = window.NWNav;
M.toast = NV.toast; M.soonLinks = NV.soonLinks; M.internal = NV.internal; M.reveal = NV.reveal; M.navigate = NV.navigate;
/* drag helper: no text selection while dragging a slider or the map */
M.dragStart = e => { e.preventDefault(); HTML.classList.add('dragging'); const end = () => { HTML.classList.remove('dragging'); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end); }; window.addEventListener('pointerup', end); window.addEventListener('pointercancel', end); };

/* aggregated statistics for a set of counties (or a province) */
M.stats = {
  /* class areas [5], conf %, desLo, desHi for a scope at year index k */
  prov(pi, k) { return { cls: CORE.prov[pi][k], area: CORE.provArea[pi], conf: CORE.provConf[pi][k], lo: CORE.provLo[pi][k], hi: CORE.provHi[pi][k] }; },
  all(k) { const cls = [0, 0, 0, 0, 0]; let area = 0, conf = 0, lo = 0, hi = 0;
    CORE.prov.forEach((p, pi) => { p[k].forEach((v, c) => cls[c] += v); area += CORE.provArea[pi]; conf += CORE.provConf[pi][k] * CORE.provArea[pi]; lo += CORE.provLo[pi][k]; hi += CORE.provHi[pi][k]; });
    return { cls, area, conf: conf / area, lo, hi }; },
  counties(ids, k) { const cls = [0, 0, 0, 0, 0]; let area = 0, conf = 0, lo = 0, hi = 0;
    for (const i of ids) { const a = M.county[i].A; CORE.county[i][k].forEach((v, c) => cls[c] += v); area += a; conf += CORE.countyConf[i][k] * a; lo += CORE.countyLo[i][k]; hi += CORE.countyHi[i][k]; }
    return { cls, area, conf: conf / Math.max(area, 1e-9), lo, hi }; },
};
M.yi = y => M.YEARS.indexOf(y);
})();
