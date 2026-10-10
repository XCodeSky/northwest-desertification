/* 西北荒漠化平台 — 各页面共用：页面切换过渡、提示条、“建设中”链接。不依赖地图数据，可单独加载。 */
'use strict';
(() => {
const N = window.NWNav = {}, HTML = document.documentElement;
N.REDUCE = matchMedia('(prefers-reduced-motion: reduce)').matches;
N.toast = (() => { let t = 0; return msg => { let e = document.getElementById('toast'); if (!e) { e = document.createElement('div'); e.id = 'toast'; e.className = 'toast'; e.setAttribute('role', 'status'); document.body.appendChild(e); }
  const host = document.querySelector('.mapR.max') || document.body; if (e.parentNode !== host) host.appendChild(e); e.textContent = msg; e.classList.add('show'); clearTimeout(t); t = setTimeout(() => e.classList.remove('show'), 2600); }; })();
N.soonLinks = () => document.querySelectorAll('[data-soon]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); N.toast(`“${a.textContent.replace('建设中', '').trim()}”板块正在建设中`); }));

/* ---------- page transitions between the site's pages ---------- */
N.internal = HTML.classList.contains('internal');
try { sessionStorage.removeItem('nw-nav'); } catch (e) {}
N.reveal = () => requestAnimationFrame(() => HTML.classList.remove('pre'));
N.navigate = href => {
  try { sessionStorage.setItem('nw-nav', '1'); } catch (e) {}
  if (N.REDUCE) { location.href = href; return; }
  HTML.classList.add('leaving'); setTimeout(() => { location.href = href; }, 170);
};
const pageOf = u => decodeURIComponent(new URL(u, location.href).pathname.split('/').pop() || 'index.html');
document.addEventListener('click', e => {
  const a = e.target.closest('a[href]');
  if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || a.target === '_blank' || a.hasAttribute('download') || a.hasAttribute('data-soon')) return;
  const url = new URL(a.href, location.href), pg = pageOf(url.href);
  if (!/\.html$/.test(pg) || pg === pageOf(location.href)) return;
  e.preventDefault();
  document.querySelectorAll('nav.side a.on').forEach(x => { x.classList.remove('on'); x.removeAttribute('aria-current'); });
  const t = [...document.querySelectorAll('nav.side .nav-list > li > a')].find(x => pageOf(x.href) === pg); if (t) t.classList.add('on');
  if (a.dataset.sub) a.classList.add('on');
  N.navigate(url.href);
});
window.addEventListener('pageshow', e => { if (e.persisted) HTML.classList.remove('leaving', 'pre'); });
})();
