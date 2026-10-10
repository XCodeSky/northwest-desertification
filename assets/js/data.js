/* 西北荒漠化平台 — 数据来源页：目录高亮、复制署名、入场动画 */
'use strict';
(() => {
const N = window.NWNav, $ = id => document.getElementById(id);
N.soonLinks();

/* 目录：点击平滑滚动，滚动时高亮当前章节 */
const links = [...document.querySelectorAll('#toc a')], secs = links.map(a => document.querySelector(a.getAttribute('href')));
const smooth = N.REDUCE ? 'auto' : 'smooth';
document.querySelectorAll('a[href^="#s"], nav.side a[href^="data.html#"]').forEach(a => a.addEventListener('click', e => {
  const h = '#' + a.getAttribute('href').split('#')[1], t = document.querySelector(h); if (!t) return;
  e.preventDefault(); e.stopPropagation(); t.scrollIntoView({ behavior: smooth, block: 'start' }); history.replaceState(null, '', h);
}));
/* 左侧子条目：01–04 概览，05–09 模型，11 署名和免责（10 历史记录资料不对应子条目） */
const subs = [...document.querySelectorAll('nav.side [data-sub^="ds-"]')], group = i => i >= 10 ? 2 : i === 9 ? -1 : i >= 4 ? 1 : 0;
const mark = () => {
  let cur = 0; const y = innerHeight * .32;
  secs.forEach((s, i) => { if (s && s.getBoundingClientRect().top <= y) cur = i; });
  if (innerHeight + scrollY >= document.documentElement.scrollHeight - 4) cur = secs.length - 1;
  links.forEach((a, i) => a.classList.toggle('on', i === cur));
  subs.forEach((a, i) => a.classList.toggle('on', i === group(cur)));
};
addEventListener('scroll', () => requestAnimationFrame(mark), { passive: true }); mark();

/* 复制署名 */
$('copyAttr').onclick = async () => {
  const t = $('attrText').textContent.trim();
  try { await navigator.clipboard.writeText(t); N.toast('署名已复制'); }
  catch (e) { const r = document.createRange(); r.selectNodeContents($('attrText')); const s = getSelection(); s.removeAllRanges(); s.addRange(r); N.toast('已选中署名文字，请按 Ctrl+C 复制'); }
};

/* 入场：站内切换只淡入；首次打开时各板块依次上浮 */
if (location.hash) { const t = document.querySelector(location.hash); if (t) t.scrollIntoView(); }
N.reveal();
if (!N.REDUCE && !N.internal) {
  document.querySelector('nav.side').animate([{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0 0 0)' }], { duration: 500, easing: 'cubic-bezier(.2,.7,.2,1)' });
  document.querySelectorAll('[data-anim]').forEach((n, i) => n.animate([{ opacity: 0, transform: 'translateY(14px)' }, { opacity: 1, transform: 'none' }], { duration: 480, delay: 120 + Math.min(i, 6) * 90, easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'backwards' }));
  document.querySelectorAll('.flow li').forEach((n, i) => n.animate([{ opacity: 0, transform: 'translateX(-10px)' }, { opacity: 1, transform: 'none' }], { duration: 380, delay: 450 + i * 90, easing: 'ease-out', fill: 'backwards' }));
}
})();
