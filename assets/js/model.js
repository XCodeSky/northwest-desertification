/* 西北荒漠化平台 — 模型说明页：目录高亮、示意图与小型交互 */
'use strict';
(() => {
const N = window.NWNav, $ = id => document.getElementById(id);
N.soonLinks();
const NS = 'http://www.w3.org/2000/svg';
const el = (t, a = {}, p) => { const e = document.createElementNS(NS, t); for (const k in a) e.setAttribute(k, a[k]); if (p) p.appendChild(e); return e; };
const txt = (p, x, y, s, a = {}) => { const t = el('text', Object.assign({ x, y, 'font-size': 11, fill: '#737D82', 'font-family': 'Bahnschrift, Inter, sans-serif' }, a), p); t.textContent = s; return t; };
const COL = ['#D3DEC8', '#F0DC9C', '#E2AE52', '#C4702F', '#7E3420'], NAMES = ['稳定', '轻度', '中度', '重度', '极重度'];
const SC = [['SSP1-2.6', '#2E8B57'], ['SSP2-4.5', '#1B252B'], ['SSP5-8.5', '#C8102E']];
const fmt = n => n.toLocaleString('en-US');
const size = svg => { const r = svg.getBoundingClientRect(); return [Math.max(200, r.width), Math.max(80, r.height)]; };

/* ---------- 条形：进入视野后再长出来 ---------- */
const grow = [];
const bar = (track, pct, color) => { const i = document.createElement('i'); if (color) i.style.background = color; i.dataset.w = Math.max(.6, pct) + '%'; track.appendChild(i); grow.push(i); return i; };
const growAll = root => root.querySelectorAll('i[data-w]').forEach(i => { i.style.width = i.dataset.w; });

/* ---------- 03 时间轴 ---------- */
function drawTimeline() {
  const box = $('mtl'); box.innerHTML = ''; const svg = el('svg', {}, box), [W, H] = size(box); svg.setAttribute('viewBox', `0 0 ${W - 32} ${H - 20}`);
  const w = W - 32, x0 = 8, x1 = w - 8, X = y => x0 + (y - 2000) / 50 * (x1 - x0), cy = 30;
  const defs = el('defs', {}, svg), pat = el('pattern', { id: 'tlh', width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, defs);
  el('rect', { width: 6, height: 6, fill: '#F1D79A' }, pat); el('rect', { width: 2.4, height: 6, fill: '#E3A229' }, pat);
  el('rect', { x: X(2000), y: cy - 4, width: X(2025) - X(2000), height: 8, fill: '#1A3441' }, svg);
  el('rect', { x: X(2025), y: cy - 4, width: X(2050) - X(2025), height: 8, fill: 'url(#tlh)' }, svg);
  for (let y = 2000; y <= 2050; y++) { const a = y % 5 === 0; if (a) continue; el('line', { x1: X(y), x2: X(y), y1: cy + 6, y2: cy + 10, stroke: y > 2025 ? '#C99A3F' : '#8FA7B2' }, svg); }
  for (let y = 2000; y <= 2050; y += 5) {
    const f = y > 2025; el('rect', { x: X(y) - 6, y: cy - 7, width: 12, height: 14, fill: f ? '#E3A229' : '#1A3441', stroke: '#1B252B', 'stroke-width': 1.5 }, svg);
    txt(svg, X(y), cy + 24, y, { 'text-anchor': 'middle', 'font-weight': 700, fill: '#1B252B' });
  }
  txt(svg, X(2000), cy - 15, '历史锚点 6 个 · 中间年份年度化', { fill: '#1A3441', 'font-weight': 700, 'font-family': 'inherit' });
  txt(svg, X(2050), cy - 15, '预测锚点 5 个 · 每个情景 25 年', { 'text-anchor': 'end', fill: '#9A6408', 'font-weight': 700, 'font-family': 'inherit' });
  el('line', { x1: X(2025.5), x2: X(2025.5), y1: cy - 12, y2: cy + 12, stroke: '#1B252B', 'stroke-dasharray': '2 2' }, svg);
}

/* ---------- 04 代理标签规则 ---------- */
{
  const MAX = .6, rows = [['耕地', [[0, .20, 2], [.20, .35, 1], [.35, MAX, 0]]], ['灌丛 / 草地', [[0, .18, 3], [.18, .30, 2], [.30, .45, 1], [.45, MAX, 0]]], ['裸地', [[0, .12, 4], [.12, .25, 3], [.25, MAX, 2]]]];
  const r = $('rule'), rg = (a, b) => b >= MAX ? `≥ ${a.toFixed(2)}` : a === 0 ? `< ${b.toFixed(2)}` : `${a.toFixed(2)}–${b.toFixed(2)}`;
  rows.forEach(([n, segs]) => {
    r.insertAdjacentHTML('beforeend', `<div class="lc">${n}</div><div class="bar">${segs.map(([a, b, k]) => `<span class="${k >= 3 ? 'dk' : ''}" style="width:${((b - a) / MAX * 100).toFixed(3)}%;background:${COL[k]}" title="${n}：NDVI ${rg(a, b)} → ${NAMES[k]}">${NAMES[k]}<small>　${rg(a, b)}</small></span>`).join('')}</div>`);
  });
  r.insertAdjacentHTML('beforeend', `<div class="ax">${[0, .1, .2, .3, .4, .5].map(v => `<b style="left:${v / MAX * 100}%">${v.toFixed(1)}</b>`).join('')}<b style="left:100%">0.6+</b><em>NDVI</em></div>`);
}

/* ---------- 05 特征重要性 ---------- */
{
  const G = { s: '#1A3441', v: '#1E7B4D', n: '#C4702F', p: '#8E989C' };
  const F = [['当前等级', 'current_class', 47.70, 's'], ['NDVI', 'ndvi', 15.10, 'v'], ['土地覆盖', 'land_cover', 11.99, 's'], ['重度邻域比例', 'neighbor_severe', 8.56, 'n'], ['中度邻域比例', 'neighbor_moderate', 5.23, 'n'],
    ['轻度邻域比例', 'neighbor_light', 3.22, 'n'], ['NDVI 五年趋势', 'ndvi_5y_trend', 2.45, 'v'], ['经度', 'longitude', 2.21, 'p'], ['纬度', 'latitude', 1.82, 'p'], ['稳定邻域比例', 'neighbor_non', 1.35, 'n'], ['极重度邻域比例', 'neighbor_extreme', .36, 'n']];
  const box = $('fimp');
  F.forEach(([n, c, v, g]) => { box.insertAdjacentHTML('beforeend', `<span class="nm">${n}<code>${c}</code></span><span class="tr"></span><span class="v">${v.toFixed(2)}%</span>`); bar(box.lastElementChild.previousElementSibling, v / 50 * 100, G[g]); });
}
/* ---------- 05 验证设计 ---------- */
{
  const P = ['00→05', '05→10', '10→15', '15→20', '20→25'], c = (cls, t) => `<div class="c ${cls}">314 万<small>${t}</small></div>`;
  $('vd').innerHTML = `<span></span>${P.map(p => `<span class="hd">${p}</span>`).join('')}
    <span class="lb">验证</span>${P.map((p, i) => i < 4 ? c('tr', '训练') : c('ho', '留出')).join('')}<span></span><span class="sum">训练 12,560,908 条 · 留出 3,140,227 条 · 420 棵树</span>
    <span class="lb">最终</span>${P.map(() => c('tr', '训练')).join('')}<span></span><span class="sum">全部 15,701,135 条重训 · 520 棵树</span>`;
}

/* ---------- 06 Markov 矩阵 ---------- */
{
  const MK = [[93.9367, 5.8010, .2406, .0157, .0059], [26.2577, 57.5590, 15.7654, .4178, .0001], [1.7083, 19.5597, 63.3116, 15.3648, .0556], [.2198, .4895, 10.8547, 82.4384, 5.9977], [.0264, .0033, .0872, 3.9033, 95.9798]];
  const box = $('mk'), read = $('mkread');
  const mix = t => { const a = [255, 255, 255], b = [26, 52, 65]; return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(',')})`; };
  const pf = v => v >= 10 ? v.toFixed(1) : v >= 1 ? v.toFixed(2) : v >= .01 ? v.toFixed(2) : '<0.01';
  let h = '<div class="hc cx">当前 ＼ 五年后</div>' + NAMES.map(n => `<div class="hc">${n}</div>`).join('');
  MK.forEach((row, i) => { h += `<div class="hr"><i style="background:${COL[i]}"></i>${NAMES[i]}</div>`;
    row.forEach((v, j) => { const t = Math.log(1 + v) / Math.log(101); h += `<div class="v${i === j ? ' dg' : ''}${t > .55 ? ' lt' : ''}" data-i="${i}" data-j="${j}" tabindex="0" style="background:${mix(t)}">${pf(v)}%</div>`; }); });
  box.innerHTML = h;
  const DEF = `对角线上是“五年后仍在原等级”的比例。<b>稳定</b>和<b>极重度</b>最不容易改变（93.9%、96.0%），<b>中度</b>最活跃，五年里有约 37% 会离开。<small>把鼠标移到任意一格，查看该等级五年后的去向。颜色按对数刻度加深。</small>`;
  read.innerHTML = DEF;
  const show = (i, j) => {
    const r = MK[i], better = r.slice(0, i).reduce((a, b) => a + b, 0), worse = r.slice(i + 1).reduce((a, b) => a + b, 0);
    const top = r.map((v, k) => [v, k]).filter(([, k]) => k !== i).sort((a, b) => b[0] - a[0]).slice(0, 2).map(([v, k]) => `${k < i ? '好转为' : '加重为'}${NAMES[k]} ${pf(v)}%`);
    read.innerHTML = `当前为<b>${NAMES[i]}</b>的格网，五年后 ${pf(r[i])}% 保持${NAMES[i]}${i > 0 ? `，${pf(better)}% 好转` : ''}${i < 4 ? `，${pf(worse)}% 加重` : ''}。去向最多的是：${top.join('、')}。<small>此格：${NAMES[i]} → ${NAMES[j]}，${pf(r[j])}%。</small>`;
    box.classList.add('hl'); box.querySelectorAll('.v').forEach(c => { c.classList.toggle('row', +c.dataset.i === i); c.classList.toggle('on', +c.dataset.i === i && +c.dataset.j === j); });
  };
  const clear = () => { read.innerHTML = DEF; box.classList.remove('hl'); box.querySelectorAll('.v').forEach(c => c.classList.remove('row', 'on')); };
  box.querySelectorAll('.v').forEach(c => { c.addEventListener('pointerenter', () => show(+c.dataset.i, +c.dataset.j)); c.addEventListener('focus', () => show(+c.dataset.i, +c.dataset.j)); });
  box.addEventListener('pointerleave', clear); box.addEventListener('focusout', e => { if (!box.contains(e.relatedTarget)) clear(); });
}

/* ---------- 07 气候修正演示 ---------- */
{
  const db = $('dbars'), cp = $('cp'), AX = [-2, -1, 0, 1, 2], LO = .8, HI = 1.2;
  db.innerHTML = `<div class="base" style="bottom:${(1 - LO) / (HI - LO) * 100}%"><span>×1.00</span></div>` + NAMES.map((n, k) => `<div class="col"><b></b><i style="background:${COL[k]}"></i><span>${n}</span></div>`).join('');
  db.parentNode.classList.add('dbw');
  const upd = () => { const p = +cp.value; $('cpv').textContent = (p > 0 ? '+' : p < 0 ? '−' : '±') + Math.abs(p).toFixed(2);
    db.querySelectorAll('.col').forEach((c, k) => { const m = Math.exp(.08 * p * AX[k]); c.querySelector('i').style.height = ((m - LO) / (HI - LO) * 100).toFixed(1) + '%'; c.querySelector('b').textContent = '×' + m.toFixed(3); }); };
  cp.addEventListener('input', upd); upd();
}

/* ---------- 08 气候节点 ---------- */
const CN = { y: [2025, 2030, 2040, 2050], P: [[236.32, 274.26, 225.50, 293.52], [257.99, 271.69, 292.50, 277.30], [227.58, 284.35, 286.03, 255.93]], T: [[4.51, 4.72, 4.57, 5.07], [4.26, 3.96, 4.76, 4.53], [4.04, 4.76, 5.20, 4.71]] };
function drawClim(id, D, lo, hi, step, dec) {
  const svg = $(id); svg.innerHTML = ''; const [W, H] = size(svg); svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const x0 = 36, x1 = W - 10, y0 = 24, y1 = H - 22, X = y => x0 + (y - 2025) / 25 * (x1 - x0), Y = v => y1 - (v - lo) / (hi - lo) * (y1 - y0);
  for (let v = lo; v <= hi + 1e-9; v += step) { el('line', { x1: x0, x2: x1, y1: Y(v), y2: Y(v), stroke: '#E1E4DF' }, svg); txt(svg, x0 - 6, Y(v) + 4, v.toFixed(dec), { 'text-anchor': 'end', fill: '#9AA29C' }); }
  CN.y.forEach(y => { el('line', { x1: X(y), x2: X(y), y1: y1, y2: y1 + 4, stroke: '#737D82' }, svg); txt(svg, X(y), H - 6, y, { 'text-anchor': 'middle' }); });
  [2035, 2045].forEach(y => txt(svg, X(y), y1 - 4, '插值', { 'text-anchor': 'middle', 'font-size': 9.5, fill: '#B5BBB4', 'font-family': 'inherit' }));
  D.forEach((s, k) => { el('path', { d: 'M' + s.map((v, i) => `${X(CN.y[i]).toFixed(1)},${Y(v).toFixed(1)}`).join('L'), fill: 'none', stroke: SC[k][1], 'stroke-width': k === 1 ? 2.4 : 1.8, 'stroke-dasharray': k === 1 ? '' : '5 3' }, svg);
    s.forEach((v, i) => { const c = el('circle', { cx: X(CN.y[i]), cy: Y(v), r: 3.4, fill: '#fff', stroke: SC[k][1], 'stroke-width': 2 }, svg); const t = el('title', {}, c); t.textContent = `${SC[k][0]} ${CN.y[i]}：${v.toFixed(2)}`; }); });
  let lx = x0; SC.forEach(([n, c], k) => { el('line', { x1: lx, x2: lx + 16, y1: 8, y2: 8, stroke: c, 'stroke-width': 2.2, 'stroke-dasharray': k === 1 ? '' : '4 2' }, svg); txt(svg, lx + 20, 12, n, { fill: c, 'font-weight': 700 }); lx += 82; });
}

/* ---------- 09 年度化示意 ---------- */
function drawAnnu() {
  const svg = $('annu'); svg.innerHTML = ''; const [W, H] = size(svg); svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const n = 20, x0 = 92, x1 = W - 4, rows = 6, y0 = 22, rh = (H - y0 - 4) / rows, cw = (x1 - x0) / n;
  const S = [1, 2, 1, 0, 2, 3, 1, 2, 2, 1, 3, 0, 1, 2, 3, 2, 1, 2, 3, 4], E = [0, 3, 2, 1, 1, 4, 2, 1, 3, 0, 2, 1, 0, 3, 4, 1, 2, 3, 2, 3];
  txt(svg, x0, 12, '← 适宜度高', { fill: '#1B252B', 'font-weight': 700, 'font-family': 'inherit' }); txt(svg, x1, 12, '适宜度低 →', { 'text-anchor': 'end', 'font-family': 'inherit' });
  for (let r = 0; r < rows; r++) {
    const y = y0 + r * rh, yr = 2025 + r, anc = r === 0 || r === rows - 1;
    txt(svg, 0, y + rh / 2 + 4, yr, { fill: '#1B252B', 'font-weight': 800, 'font-size': 12 }); txt(svg, 36, y + rh / 2 + 4, anc ? '锚点' : `第 ${r} 批`, { fill: anc ? '#9A6408' : '#737D82', 'font-family': 'inherit', 'font-weight': anc ? 700 : 400 });
    const g = el('g', { class: 'arow', style: `opacity:${M.REDUCE ? 1 : 0}` }, svg);
    for (let j = 0; j < n; j++) { const done = r > 0 && j < r * 4, k = done ? E[j] : S[j], ch = r > 0 && j >= (r - 1) * 4 && j < r * 4;
      el('rect', { x: x0 + j * cw + 1, y: y + 2, width: cw - 2, height: rh - 4, fill: COL[k], stroke: ch ? '#1B252B' : 'rgba(27,37,43,.18)', 'stroke-width': ch ? 2 : 1 }, g); }
  }
  for (let b = 1; b < 5; b++) el('line', { x1: x0 + b * 4 * cw, x2: x0 + b * 4 * cw, y1: y0 - 2, y2: H - 2, stroke: '#1B252B', 'stroke-dasharray': '2 3', opacity: .4 }, svg);
  annuShown = false;
}
let annuShown = false;
const showAnnu = () => { if (annuShown) return; annuShown = true; $('annu').querySelectorAll('.arow').forEach((g, i) => g.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, delay: i * 160, fill: 'forwards' })); };
const M = { REDUCE: N.REDUCE };

/* ---------- 10 区间包络 ---------- */
{
  const box = $('envb'), V = [['SSP1-2.6', .1618, '#2E8B57'], ['SSP2-4.5', .1037, '#1B252B'], ['SSP5-8.5', .1598, '#C8102E']];
  V.forEach(([n, v, c]) => { box.insertAdjacentHTML('beforeend', `<span class="s" style="color:${c}">${n}</span><span class="tr"></span><b>${v.toFixed(4)}%</b>`); bar(box.children[box.children.length - 2], v / .2 * 100, c); });
}
/* ---------- 11 两两差异 ---------- */
{
  const box = $('pairs'), P = [[0, 1, 74351, 2.3677], [0, 2, 70377, 2.2411], [1, 2, 77904, 2.4808]];
  P.forEach(([a, b, n, p]) => { box.insertAdjacentHTML('beforeend', `<div class="p"><span class="nm"><i style="background:${SC[a][1]}"></i>${SC[a][0]}<em>vs</em><i style="background:${SC[b][1]}"></i>${SC[b][0]}</span><span class="tr"></span><span class="v">${p.toFixed(2)}%</span><span class="c">${fmt(n)} 个格网等级不同</span></div>`); bar(box.lastElementChild.querySelector('.tr'), p / 3 * 100); });
  box.insertAdjacentHTML('beforeend', '<p class="note">条形满格为 3%。研究区共 3,140,227 个格网。</p>');
}
/* ---------- 13 性能 ---------- */
{
  const box = $('perf'), R = [['1 km 完整训练与 2030 推理', 2093.6], ['2000—2050 年度产品构建', 451.6], ['SSP5-8.5 逐年推演', 396.2], ['SSP1-2.6 逐年推演', 395.1], ['最终全样本训练', 347.3]];
  R.forEach(([n, s]) => { box.insertAdjacentHTML('beforeend', `<div class="r"><span>${n}</span><b>${fmt(s)} 秒</b><span class="tr"></span></div>`); bar(box.lastElementChild.querySelector('.tr'), s / 2093.6 * 100); });
}

/* ---------- 绘制与尺寸 ---------- */
const drawSvgs = () => { drawTimeline(); drawClim('cP', CN.P, 200, 300, 25, 0); drawClim('cT', CN.T, 3.8, 5.4, .4, 1); drawAnnu(); if (annuSeen) { annuShown = false; showAnnu(); } };
let annuSeen = false;
drawSvgs();
let rsT = 0; new ResizeObserver(() => { clearTimeout(rsT); rsT = setTimeout(drawSvgs, 150); }).observe(document.querySelector('.ds-col'));

if (N.REDUCE || !('IntersectionObserver' in window)) { grow.forEach(i => { i.style.transition = 'none'; i.style.width = i.dataset.w; }); annuSeen = true; showAnnu(); }
else {
  const io = new IntersectionObserver(es => es.forEach(e => { if (!e.isIntersecting) return; growAll(e.target); if (e.target.id === 'm9') { annuSeen = true; showAnnu(); } io.unobserve(e.target); }), { rootMargin: '0px 0px -12% 0px' });
  document.querySelectorAll('.sec').forEach(s => io.observe(s));
}

/* ---------- 05 时序验证：六种做法对比、五级混淆矩阵、逐类别指标（assets/data/validation.js） ---------- */
(() => {
  const V = window.NW_VAL; if (!V || !$('vcmp')) return;
  const pc = v => (v * 100).toFixed(2) + '%', p1 = v => (v * 100).toFixed(1) + '%';
  const tag = id => id === V.final ? '<em class="vt f">地图采用</em>' : id === V.pixel ? '<em class="vt p">逐像元分类</em>' : id === V.baseline ? '<em class="vt b">基线</em>' : '';
  const cols = [['accuracy', 'Accuracy', pc], ['balanced_accuracy', 'Balanced Acc.', pc], ['macro_f1', 'Macro-F1', pc], ['cohen_kappa', 'Kappa', v => v.toFixed(4)],
    ['ordinal_mae_levels', '等级 MAE', v => v.toFixed(4)], ['within_one_level_accuracy', '相差 ≤ 1 级', pc], ['severe_plus_f1', '重度及以上 F1', v => v.toFixed(4)]];
  const best = cols.map(([k]) => (k === 'ordinal_mae_levels' ? Math.min : Math.max)(...V.models.map(m => m.m[k])));
  $('vcmp').innerHTML = `<thead><tr><th>做法</th>${cols.map(c => `<th class="r">${c[1]}</th>`).join('')}</tr></thead><tbody>${V.models.map(m =>
    `<tr class="${m.id === V.final ? 'fin' : m.id === V.pixel ? 'pix' : ''}"><td><b>${m.name}</b>${tag(m.id)}</td>${cols.map(([k, , f], j) => `<td class="r num${m.m[k] === best[j] ? ' best' : ''}">${f(m.m[k])}</td>`).join('')}</tr>`).join('')}</tbody>`;

  const short = { persistence: '保持不变', markov_mode: 'Markov 众数', markov_ca: 'Markov + CA', lightgbm_no_neighborhood: 'LightGBM 无邻域', lightgbm_full: 'LightGBM 完整', lightgbm_ca_markov: 'LightGBM + CA-Markov' };
  const seg = $('vseg'); let cur = V.final;
  V.models.forEach(m => { const b = document.createElement('button'); b.type = 'button'; b.dataset.id = m.id; b.setAttribute('role', 'tab');
    b.innerHTML = short[m.id] || m.name; if (m.id === V.final) b.title = '网站地图的最终输出'; b.onclick = () => { cur = m.id; draw(); }; seg.appendChild(b); });
  const chip = k => `<i class="sw" style="background:${COL[k]}"></i>${NAMES[k]}`;
  function draw() {
    seg.querySelectorAll('button').forEach(b => { const on = b.dataset.id === cur; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
    const m = V.models.find(x => x.id === cur), M = m.cm, N = V.n, rs = M.map(r => r.reduce((a, b) => a + b, 0)), cs = [0, 1, 2, 3, 4].map(j => M.reduce((a, r) => a + r[j], 0));
    let h = '<div class="h c0">实际 \\ 预测</div>' + NAMES.map((n, j) => `<div class="h">${chip(j)}</div>`).join('') + '<div class="h">合计</div>';
    M.forEach((r, i) => { h += `<div class="h rl">${chip(i)}</div>`;
      r.forEach((v, j) => { const f = v / rs[i], a = Math.min(1, Math.sqrt(f)); const bg = i === j ? `rgba(26,52,65,${.12 + .78 * a})` : `rgba(200,16,46,${v ? .05 + .6 * a : 0})`;
        h += `<div class="v${i === j ? ' d' : ''}${i === j && f > .55 ? ' dk' : ''}" style="background:${bg}" title="实际 ${NAMES[i]} → 预测 ${NAMES[j]}：${fmt(v)} 格（占实际 ${NAMES[i]} 的 ${p1(f)}）"><b>${fmt(v)}</b><small>${p1(f)}</small></div>`; });
      h += `<div class="t"><b>${fmt(rs[i])}</b><small>${p1(rs[i] / N)}</small></div>`; });
    h += '<div class="h rl">合计</div>' + cs.map(v => `<div class="t"><b>${fmt(v)}</b><small>${p1(v / N)}</small></div>`).join('') + `<div class="t"><b>${fmt(N)}</b><small>Acc ${pc(m.m.accuracy)}</small></div>`;
    $('vcm').innerHTML = h;
    const S = [0, 1, 2, 3, 4].map(k => { const tp = M[k][k], fn = rs[k] - tp, fp = cs[k] - tp, tn = N - tp - fn - fp;
      return { act: rs[k], pred: cs[k], share: rs[k] / N, tp, fp, fn, tn, P: tp / (tp + fp), R: tp / (tp + fn), Sp: tn / (tn + fp), F1: 2 * tp / (2 * tp + fp + fn), IoU: tp / (tp + fp + fn), NPV: tn / (tn + fn), FPR: fp / (fp + tn), FNR: fn / (fn + tp), OvR: (tp + tn) / N }; });
    const rows = [['g', '样本'], ['act', '实际样本数', fmt], ['pred', '预测样本数', fmt], ['share', '类别占比', p1], ['g', '计数'], ['tp', 'TP', fmt], ['fp', 'FP', fmt], ['fn', 'FN', fmt], ['tn', 'TN', fmt],
      ['g', '指标'], ['P', '精确率', p1], ['R', '召回率 / 敏感度', p1], ['Sp', '特异度', p1], ['F1', 'F1', v => v.toFixed(3), 'hl'], ['IoU', 'IoU / Jaccard', v => v.toFixed(3)], ['NPV', '阴性预测值', p1],
      ['FPR', '假阳性率', p1], ['FNR', '假阴性率', p1], ['OvR', '一对多准确率', p1]];
    $('vpc').innerHTML = `<thead><tr><th>${short[m.id] || m.name}</th>${NAMES.map((n, k) => `<th class="r">${chip(k)}</th>`).join('')}</tr></thead><tbody>${rows.map(([k, n, f, c]) =>
      k === 'g' ? `<tr class="grp"><td colspan="6">${n}</td></tr>` : `<tr class="${c || ''}"><td>${n}</td>${S.map(o => `<td class="r num">${f(o[k])}</td>`).join('')}</tr>`).join('')}</tbody>`;
  }
  draw();
})();

/* ---------- 目录：点击平滑滚动，滚动时高亮当前章节 ---------- */
const links = [...document.querySelectorAll('#toc a')], secs = links.map(a => document.querySelector(a.getAttribute('href')));
const smooth = N.REDUCE ? 'auto' : 'smooth';
document.querySelectorAll('a[href^="#m"]').forEach(a => a.addEventListener('click', e => {
  const t = document.querySelector(a.getAttribute('href')); if (!t) return;
  e.preventDefault(); t.scrollIntoView({ behavior: smooth, block: 'start' }); history.replaceState(null, '', a.getAttribute('href'));
}));
const mark = () => {
  let cur = 0; const y = innerHeight * .32;
  secs.forEach((s, i) => { if (s && s.getBoundingClientRect().top <= y) cur = i; });
  if (innerHeight + scrollY >= document.documentElement.scrollHeight - 4) cur = secs.length - 1;
  links.forEach((a, i) => a.classList.toggle('on', i === cur));
};
addEventListener('scroll', () => requestAnimationFrame(mark), { passive: true }); mark();

/* 入场：站内切换只淡入；首次打开时各板块依次上浮 */
if (location.hash) { const t = document.querySelector(location.hash); if (t) t.scrollIntoView(); }
N.reveal();
if (!N.REDUCE && !N.internal) {
  document.querySelector('nav.side').animate([{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0 0 0)' }], { duration: 500, easing: 'cubic-bezier(.2,.7,.2,1)' });
  document.querySelectorAll('[data-anim]').forEach((n, i) => n.animate([{ opacity: 0, transform: 'translateY(14px)' }, { opacity: 1, transform: 'none' }], { duration: 480, delay: 120 + Math.min(i, 6) * 90, easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'backwards' }));
  document.querySelectorAll('.flow li').forEach((n, i) => n.animate([{ opacity: 0, transform: 'translateX(-10px)' }, { opacity: 1, transform: 'none' }], { duration: 380, delay: 450 + i * 90, easing: 'ease-out', fill: 'backwards' }));
}
})();
