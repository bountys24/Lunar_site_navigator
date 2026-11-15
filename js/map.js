/*
 * map.js — интерактивная карта южного полюса (теневой рельеф NASA LOLA).
 * Колесо / кнопки: зум, перетаскивание: сдвиг, клик: выбрать точку посадки.
 */
window.PoleMap = (function () {
  'use strict';
  const T = window.Terrain;
  let cv, ctx, img, W = 0, H = 0;
  let view = { cx: 0, cy: 0, z: 1 };     // центр в пикселях карты, масштаб (экранных px на px карты)
  let point = null, sites = [], overlay = null, onPick = () => {}, hover = null;

  function init(canvas, opts) {
    cv = canvas; ctx = cv.getContext('2d');
    onPick = opts.onPick; sites = opts.sites || [];
    img = new Image();
    img.onload = () => { fit(); draw(); };
    img.src = opts.image;
    new ResizeObserver(() => { resize(); draw(); }).observe(cv.parentElement);
    resize();

    let drag = null, moved = false;
    cv.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, cx: view.cx, cy: view.cy }; moved = false; cv.setPointerCapture(e.pointerId); });
    cv.addEventListener('pointermove', (e) => {
      const r = cv.getBoundingClientRect();
      hover = toMap(e.clientX - r.left, e.clientY - r.top);
      if (drag) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
        view.cx = drag.cx - dx / view.z; view.cy = drag.cy - dy / view.z;
      }
      draw();
      if (opts.onHover) opts.onHover(hoverLatLon());
    });
    cv.addEventListener('pointerup', (e) => {
      if (drag && !moved) {
        const r = cv.getBoundingClientRect();
        const m = toMap(e.clientX - r.left, e.clientY - r.top);
        if (m.x >= 0 && m.y >= 0 && m.x < T.width && m.y < T.height) {
          const [lat, lon] = T.toLatLon(m.y, m.x);
          if (T.covers(lat, lon)) onPick({ lat, lon });
        }
      }
      drag = null;
    });
    cv.addEventListener('pointerleave', () => { hover = null; draw(); if (opts.onHover) opts.onHover(null); });
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = cv.getBoundingClientRect();
      zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.25 : 0.8);
    }, { passive: false });
  }

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    W = cv.parentElement.clientWidth; H = cv.parentElement.clientHeight;
    cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function fit() { view = { cx: T.width / 2, cy: T.height / 2, z: Math.min(W, H) / T.width * 0.98 }; }
  const toMap = (sx, sy) => ({ x: view.cx + (sx - W / 2) / view.z, y: view.cy + (sy - H / 2) / view.z });
  const toScreen = (mx, my) => ({ x: W / 2 + (mx - view.cx) * view.z, y: H / 2 + (my - view.cy) * view.z });
  function zoomAt(sx, sy, k) {
    const m = toMap(sx, sy);
    view.z = Math.max(Math.min(W, H) / T.width * 0.6, Math.min(12, view.z * k));
    view.cx = m.x - (sx - W / 2) / view.z; view.cy = m.y - (sy - H / 2) / view.z;
    draw();
  }
  function hoverLatLon() {
    if (!hover || hover.x < 0 || hover.y < 0 || hover.x >= T.width || hover.y >= T.height) return null;
    const [lat, lon] = T.toLatLon(hover.y, hover.x);
    return { lat, lon, h: T.heightPx(hover.y, hover.x), slope: T.slopeAt(lat, lon) };
  }

  function latlonToScreen(lat, lon) { const [L, S] = T.toPixel(lat, lon); return toScreen(S, L); }

  function draw() {
    if (!ctx) return;
    ctx.fillStyle = '#05070a'; ctx.fillRect(0, 0, W, H);
    if (img.complete && img.naturalWidth) {
      const a = toScreen(0, 0);
      ctx.imageSmoothingEnabled = view.z < 2;
      ctx.drawImage(img, a.x, a.y, T.width * view.z, T.height * view.z);
    }
    if (overlay) overlay(ctx, latlonToScreen, view);

    // сетка широт/долгот
    ctx.strokeStyle = 'rgba(61,214,208,0.22)'; ctx.lineWidth = 1; ctx.fillStyle = 'rgba(61,214,208,0.7)';
    ctx.font = '11px "JetBrains Mono", monospace';
    [-80, -82, -84, -86, -88].forEach((lat) => {
      ctx.beginPath();
      for (let lon = 0; lon <= 360; lon += 3) { const p = latlonToScreen(lat, lon); lon ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); }
      ctx.stroke();
      const p = latlonToScreen(lat, 45); ctx.fillText(lat + '°', p.x + 3, p.y - 3);
    });
    for (let lon = 0; lon < 360; lon += 30) {
      const a = latlonToScreen(-90, lon), b = latlonToScreen(-80, lon);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      const c = latlonToScreen(-80.4, lon); ctx.fillText(lon + '°E', c.x - 14, c.y);
    }

    // известные места
    ctx.font = '12px Inter, sans-serif';
    sites.forEach((s) => {
      if (s.lat > -80) return;
      const p = latlonToScreen(s.lat, s.lon);
      ctx.fillStyle = '#ff8a3d'; ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, 7); ctx.fill();
      ctx.strokeStyle = '#05070a'; ctx.lineWidth = 1.5; ctx.stroke();
      if (view.z > 0.45) { ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fillText(s.label(), p.x + 7, p.y + 4); }
    });

    // выбранная точка
    if (point) {
      const p = latlonToScreen(point.lat, point.lon);
      ctx.strokeStyle = '#3dd6d0'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(p.x, p.y, 11, 0, 7); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(p.x - 18, p.y); ctx.lineTo(p.x - 6, p.y); ctx.moveTo(p.x + 6, p.y); ctx.lineTo(p.x + 18, p.y);
      ctx.moveTo(p.x, p.y - 18); ctx.lineTo(p.x, p.y - 6); ctx.moveTo(p.x, p.y + 6); ctx.lineTo(p.x, p.y + 18);
      ctx.stroke();
    }

    // масштабная линейка
    const km = [1, 2, 5, 10, 20, 50, 100].find((k) => k * 1000 / T.meta.scale_m * view.z > 70) || 100;
    const len = km * 1000 / T.meta.scale_m * view.z;
    ctx.fillStyle = 'rgba(5,7,10,0.7)'; ctx.fillRect(12, H - 34, len + 20, 24);
    ctx.strokeStyle = '#e6edf3'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(22, H - 18); ctx.lineTo(22 + len, H - 18); ctx.stroke();
    ctx.fillStyle = '#e6edf3'; ctx.font = '11px "JetBrains Mono", monospace'; ctx.fillText(km + ' km', 22, H - 22);
  }

  function setPoint(p, center) {
    point = p;
    if (p && center && T.covers(p.lat, p.lon)) {
      const [L, S] = T.toPixel(p.lat, p.lon);
      view.cx = S; view.cy = L; view.z = Math.max(view.z, 1.2);
    }
    draw();
  }

  return {
    init, setPoint, draw,
    zoomIn: () => zoomAt(W / 2, H / 2, 1.5), zoomOut: () => zoomAt(W / 2, H / 2, 1 / 1.5),
    reset: () => { fit(); draw(); },
    setOverlay: (fn) => { overlay = fn; draw(); },
    latlonToScreen,
  };
})();
