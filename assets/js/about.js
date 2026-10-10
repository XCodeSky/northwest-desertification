/* 西北荒漠化平台 — 关于项目页：目录高亮、入场动画 */
'use strict';
(() => {
const N = window.NWNav;
N.soonLinks();
const links = [...document.querySelectorAll('#toc a')], secs = links.map(a => document.querySelector(a.getAttribute('href')));
const smooth = N.REDUCE ? 'auto' : 'smooth';
document.querySelectorAll('a[href^="#a"], a[href="#team"]').forEach(a => a.addEventListener('click', e => {
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

/* 评审标准权重条：进入视野后长出 */
const crit = document.getElementById('crit');
if (N.REDUCE || !('IntersectionObserver' in window)) crit.classList.add('on');
else { const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { crit.classList.add('on'); io.disconnect(); } }), { rootMargin: '0px 0px -10% 0px' }); io.observe(crit); }

/* 问答：平滑展开 / 收起；右下角导航点击后展开并跳转 */
const QA = [...document.querySelectorAll('.qa')], qlinks = [...document.querySelectorAll('#qnav a')];
const syncQ = () => { qlinks.forEach(a => a.classList.toggle('open', document.getElementById(a.dataset.q).open)); const all = document.getElementById('qaAll'); if (all) all.textContent = QA.every(d => d.open) ? '全部收起' : '全部展开'; };
const setOpen = (d, on) => {
  if (d.open === on) return; const ans = d.querySelector('.ans');
  if (N.REDUCE) { d.open = on; syncQ(); return; }
  if (d._anim) d._anim.cancel();
  if (on) { d.open = true; const h = ans.scrollHeight; d._anim = ans.animate([{ height: '0px', opacity: 0 }, { height: h + 'px', opacity: 1 }], { duration: 260, easing: 'cubic-bezier(.2,.7,.2,1)' }); }
  else { const h = ans.scrollHeight; d._anim = ans.animate([{ height: h + 'px', opacity: 1 }, { height: '0px', opacity: 0 }], { duration: 200, easing: 'ease-in' }); d._anim.onfinish = () => { d.open = false; syncQ(); }; }
  syncQ();
};
QA.forEach(d => d.querySelector('summary').addEventListener('click', e => { e.preventDefault(); setOpen(d, !d.open); }));
const goQ = (id, push) => { const d = document.getElementById(id); if (!d) return; setOpen(d, true); d.scrollIntoView({ behavior: smooth, block: 'center' });
  d.classList.remove('flash'); void d.offsetWidth; d.classList.add('flash'); setTimeout(() => d.classList.remove('flash'), 1200); if (push) history.replaceState(null, '', '#' + id); };
qlinks.forEach(a => a.addEventListener('click', e => { e.preventDefault(); goQ(a.dataset.q, true); }));
const qaAll = document.getElementById('qaAll'); if (qaAll) qaAll.onclick = () => { const open = !QA.every(d => d.open); QA.forEach(d => setOpen(d, open)); };
syncQ();

if (location.hash) { if (/^#q\d+$/.test(location.hash)) goQ(location.hash.slice(1)); else { const t = document.querySelector(location.hash); if (t) t.scrollIntoView(); } }
N.reveal();
if (!N.REDUCE && !N.internal) {
  document.querySelector('nav.side').animate([{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0 0 0)' }], { duration: 500, easing: 'cubic-bezier(.2,.7,.2,1)' });
  document.querySelectorAll('[data-anim]').forEach((n, i) => n.animate([{ opacity: 0, transform: 'translateY(14px)' }, { opacity: 1, transform: 'none' }], { duration: 480, delay: 120 + Math.min(i, 6) * 90, easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'backwards' }));
  document.querySelectorAll('.loop li, .must a').forEach((n, i) => n.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 380, delay: 420 + (i % 4) * 90, easing: 'ease-out', fill: 'backwards' }));
}
})();
