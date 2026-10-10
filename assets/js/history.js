/* 西北荒漠化平台 — 历史记录页：章节时间带、滚动出现、图片淡入、前后对比滑块 */
'use strict';
(() => {
const N = window.NWNav, root = document.documentElement;
N.soonLinks();
const smooth = N.REDUCE ? 'auto' : 'smooth';

/* 图片载入后淡入；载入失败时给出提示 */
document.querySelectorAll('.frame img, .cmp-frame img').forEach(img => {
  const ok = () => img.classList.add('ok');
  if (img.complete && img.naturalWidth) ok(); else img.addEventListener('load', ok, { once: true });
  img.addEventListener('error', () => { img.classList.add('ok'); img.alt = '影像未能载入：' + img.getAttribute('src'); }, { once: true });
});

/* 章节滚动出现（只在首次进入视口时） */
const secs = [...document.querySelectorAll('.reveal')];
if ('IntersectionObserver' in window && !N.REDUCE) {
  root.classList.add('io');
  const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -8% 0px', threshold: .04 });
  secs.forEach(s => io.observe(s));
}

/* 时间带：点击滑动，滚动时高亮当前章节 */
const era = [...document.querySelectorAll('#era a')], chs = era.map(a => document.querySelector(a.getAttribute('href')));
era.forEach(a => a.addEventListener('click', e => { const t = document.querySelector(a.getAttribute('href')); if (!t) return; e.preventDefault(); t.classList.add('in'); t.scrollIntoView({ behavior: smooth, block: 'start' }); history.replaceState(null, '', a.getAttribute('href')); }));
const mark = () => {
  let cur = -1; const y = innerHeight * .35;
  chs.forEach((s, i) => { if (s && s.getBoundingClientRect().top <= y) cur = i; });
  if (innerHeight + scrollY >= root.scrollHeight - 4) cur = chs.length - 1;
  era.forEach((a, i) => a.classList.toggle('on', i === cur));
};
addEventListener('scroll', () => requestAnimationFrame(mark), { passive: true }); mark();

/* 前后对比滑块 */
document.querySelectorAll('.cmp-frame').forEach(f => {
  const r = f.querySelector('input'), set = v => f.style.setProperty('--p', v + '%');
  r.addEventListener('input', () => set(r.value)); set(r.value);
  r.addEventListener('pointerdown', () => root.classList.add('dragging'));
  addEventListener('pointerup', () => root.classList.remove('dragging'));
});

/* 入场：站内切换只淡入；首次打开时页头依次出现 */
if (location.hash) { const t = document.querySelector(location.hash); if (t) { t.classList.add('in'); t.scrollIntoView(); } }
N.reveal();
if (!N.REDUCE && !N.internal) {
  document.querySelector('nav.side').animate([{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0 0 0)' }], { duration: 500, easing: 'cubic-bezier(.2,.7,.2,1)' });
  document.querySelectorAll('.hs-head .ttl, #era li').forEach((n, i) => n.animate([{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'none' }], { duration: 460, delay: 100 + i * 70, easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'backwards' }));
}
})();
