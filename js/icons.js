/* icons.js — единый набор тонких линейных иконок (вместо эмодзи). ICON('sun') → <svg …> */
(function () {
  const P = {
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
    earth: '<circle cx="12" cy="12" r="8"/><path d="M4 12h16M12 4c3 3 3 13 0 16M12 4c-3 3-3 13 0 16"/>',
    moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
    power: '<path d="M13 2L5 13h6l-1 9 8-11h-6z"/>',
    link: '<path d="M5 19a10 10 0 0 1 0-14M19 5a10 10 0 0 1 0 14M8.5 15.5a5 5 0 0 1 0-7M15.5 8.5a5 5 0 0 1 0 7"/><circle cx="12" cy="12" r="1.5"/>',
    warn: '<path d="M12 3l9.5 17h-19z"/><path d="M12 10v4M12 17.5v.1"/>',
    ok: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.7 2.7L16.5 9"/>',
    bad: '<circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/>',
    na: '<circle cx="12" cy="12" r="9"/><path d="M8 12h8"/>',
    mount: '<path d="M2 20l7-12 4 6 3-4 6 10z"/>',
    cal: '<rect x="3" y="5" width="18" height="16" rx="1"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  };
  window.ICON = (name, cls) => `<svg class="ic-l ${cls || ''}" viewBox="0 0 24 24" aria-hidden="true">${P[name] || ''}</svg>`;
})();
// иконки в разметке: <i class="ico" data-ico="sun"></i>
document.querySelectorAll('[data-ico]').forEach((el) => { el.innerHTML = window.ICON(el.dataset.ico); });
