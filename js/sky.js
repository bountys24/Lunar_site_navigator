/*
 * sky.js — панорама «вид с места посадки».
 * Ось X = азимут 0–360°, ось Y = возвышение (масштаб растянут: у полюса всё
 * происходит в пределах нескольких градусов над горизонтом).
 * Сверху — звёздное небо, снизу — настоящий силуэт гор по NASA LOLA.
 * Путь Солнца и Земли показан на ближайшие дни с отметками каждых суток.
 */
window.SkyView = (function () {
  const NS = 'http://www.w3.org/2000/svg';
  const W = 1000, H = 360, ML = 46, MR = 12, MT = 14, MB = 34;
  const PW = W - ML - MR, PH = H - MT - MB;
  const D2R = Math.PI / 180;

  function el(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function niceStep(range) {
    const raw = range / 5;
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    const n = raw / p;
    return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * p;
  }
  // детерминированный генератор — звёзды не «прыгают» при перерисовке
  function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

  // единичный вектор из азимута/возвышения
  const vec = (p) => [Math.cos(p.el * D2R) * Math.sin(p.az * D2R), Math.cos(p.el * D2R) * Math.cos(p.az * D2R), Math.sin(p.el * D2R)];

  /**
   * svg — <svg>, samples — массив skyState (шаг 1 ч), now — текущий skyState,
   * site — место (horizon), labels — подписи, opts — { i0: индекс «сейчас», days: дней пути }.
   */
  function render(svg, samples, now, site, labels, opts) {
    opts = opts || {};
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.innerHTML = '';
    const E = window.LunarEngine;
    const hMask = site.horizon && site.horizon.length ? site.horizon : null;
    const hor = (az) => (hMask ? E.horizonAt(site, ((az % 360) + 360) % 360) : 0);

    // путь на ближайшие дни
    const i0 = Math.max(0, Math.min(samples.length - 1, opts.i0 || 0));
    const days = opts.days || 5;
    const path = samples.slice(i0, Math.min(samples.length, i0 + days * 24 + 1));

    // ---- вертикальный масштаб: небо крупно, подземная часть — узкая полоса ----
    let mMin = 0, mMax = 0;
    if (hMask) { mMin = Math.min(...hMask); mMax = Math.max(...hMask); }
    let top = Math.max(mMax + 1.5, 4);

    for (const k of ['sun', 'earth']) if (now[k].el > now[k].horizon - 0.5) top = Math.max(top, now[k].el + 3);
    const base = Math.min(mMin, 0);
    const hi = Math.min(95, top + (top - base) * 0.14);   // запас сверху под подписи
    const lo = base - Math.max(1.2, (hi - base) * 0.3);

    const x = (az) => ML + (az / 360) * PW;
    const y = (e) => MT + (1 - (e - lo) / (hi - lo)) * PH;
    const yClamp = (e) => Math.min(MT + PH - 34, Math.max(MT + 14, y(e)));

    // ---- defs ----
    const defs = el('defs', {}, svg);
    const clip = el('clipPath', { id: 'skyClip' }, defs);
    el('rect', { x: ML, y: MT, width: PW, height: PH, rx: 8 }, clip);

    const skyG = el('linearGradient', { id: 'skyGrad', x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
    el('stop', { offset: '0%', 'stop-color': '#03050a' }, skyG);
    el('stop', { offset: '100%', 'stop-color': '#0b1120' }, skyG);

    // грунт подсвечен со стороны Солнца (если Солнце над горизонтом или чуть ниже)
    const sunAz = now.sun.az, sunLit = now.sun.el > now.sun.horizon - 1;
    const gr = el('linearGradient', { id: 'groundLit', x1: 0, y1: 0, x2: 1, y2: 0 }, defs);
    for (let a = 0; a <= 360; a += 15) {
      let d = Math.abs(((a - sunAz + 540) % 360) - 180);          // угол до Солнца по азимуту
      const k = sunLit ? Math.pow(Math.max(0, Math.cos(d * D2R)), 2) : 0;
      const c = Math.round(58 + 92 * k), cb = Math.round(64 + 84 * k);
      el('stop', { offset: (a / 360 * 100).toFixed(1) + '%', 'stop-color': `rgb(${c},${c},${cb})` }, gr);
    }
    const shade = el('linearGradient', { id: 'groundShade', x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
    el('stop', { offset: '0%', 'stop-color': '#000', 'stop-opacity': 0 }, shade);
    el('stop', { offset: '100%', 'stop-color': '#000', 'stop-opacity': 0.75 }, shade);

    const grain = el('filter', { id: 'grain', x: 0, y: 0, width: '100%', height: '100%' }, defs);
    el('feTurbulence', { type: 'fractalNoise', baseFrequency: '0.9', numOctaves: 2, seed: 7, result: 'n' }, grain);
    el('feColorMatrix', { in: 'n', type: 'matrix', values: '0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.55 0' }, grain);

    const glow = el('filter', { id: 'glow', x: '-150%', y: '-150%', width: '400%', height: '400%' }, defs);
    el('feGaussianBlur', { stdDeviation: 6, result: 'b' }, glow);
    const fm = el('feMerge', {}, glow);
    el('feMergeNode', { in: 'b' }, fm); el('feMergeNode', { in: 'SourceGraphic' }, fm);

    const sunG = el('radialGradient', { id: 'sunGrad' }, defs);
    el('stop', { offset: '0%', 'stop-color': '#fffdf4' }, sunG);
    el('stop', { offset: '45%', 'stop-color': '#ffe6a3' }, sunG);
    el('stop', { offset: '100%', 'stop-color': '#ffb547' }, sunG);
    const haloG = el('radialGradient', { id: 'haloGrad' }, defs);
    el('stop', { offset: '0%', 'stop-color': '#ffd27a', 'stop-opacity': 0.55 }, haloG);
    el('stop', { offset: '100%', 'stop-color': '#ffb547', 'stop-opacity': 0 }, haloG);
    const earthG = el('radialGradient', { id: 'earthGrad', cx: '40%', cy: '35%' }, defs);
    el('stop', { offset: '0%', 'stop-color': '#bfe9ff' }, earthG);
    el('stop', { offset: '55%', 'stop-color': '#3aa0e8' }, earthG);
    el('stop', { offset: '100%', 'stop-color': '#1d5fa8' }, earthG);

    const root = el('g', { 'clip-path': 'url(#skyClip)' }, svg);

    // ---- небо и звёзды ----
    el('rect', { x: ML, y: MT, width: PW, height: PH, fill: 'url(#skyGrad)' }, root);
    const r = rng(20261114);
    const stars = el('g', { class: 'sky-stars' }, root);
    for (let i = 0; i < 260; i++) {
      const sx = ML + r() * PW, sy = MT + r() * PH, b = r();
      el('circle', { cx: sx.toFixed(1), cy: sy.toFixed(1), r: (b > 0.97 ? 1.5 : b > 0.85 ? 1 : 0.6), fill: '#fff', opacity: (0.25 + 0.6 * r()).toFixed(2),
        class: b > 0.9 ? 'twinkle' : '', style: b > 0.9 ? `animation-delay:${(r() * 4).toFixed(2)}s` : '' }, stars);
    }

    // сетка по возвышению (только над горизонтом — она для экспертов)
    const step = niceStep(hi - lo);
    for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) {
      el('line', { x1: ML, x2: ML + PW, y1: y(v), y2: y(v), stroke: 'rgba(160,190,255,0.08)', 'stroke-dasharray': v === 0 ? '' : '2 6' }, root);
      const t = el('text', { x: ML - 8, y: y(v) + 4, 'text-anchor': 'end', class: 'sky-tick' }, svg);
      t.textContent = (Math.abs(v) < 1e-9 ? 0 : +v.toFixed(2)) + '°';
    }
    [0, 90, 180, 270, 360].forEach((az) => el('line', { x1: x(az), x2: x(az), y1: MT, y2: MT + PH, stroke: 'rgba(160,190,255,0.06)' }, root));

    // ---- путь Солнца и Земли: ярко над горизонтом, бледно под ним ----
    function track(key, color) {
      let dUp = '', dDown = '', prev = null, prevUp = null;
      for (const s of path) {
        const p = s[key], up = p.el > p.horizon;
        const jump = prev === null || Math.abs(p.az - prev.az) > 180;
        const px = x(p.az).toFixed(1), py = y(p.el).toFixed(1);
        if (up) { dUp += (jump || prevUp === false ? 'M' : 'L') + px + ',' + py + ' '; }
        else { dDown += (jump || prevUp === true ? 'M' : 'L') + px + ',' + py + ' '; }
        // стык: продолжаем линию до точки смены, чтобы не было разрыва
        if (!jump && prevUp !== null && prevUp !== up) {
          const ppx = x(prev.az).toFixed(1), ppy = y(prev.el).toFixed(1);
          if (up) dUp = dUp.replace(/M([^M]*)$/, `M${ppx},${ppy} L$1`); else dDown = dDown.replace(/M([^M]*)$/, `M${ppx},${ppy} L$1`);
        }
        prev = p; prevUp = up;
      }
      if (dDown) el('path', { d: dDown, fill: 'none', stroke: color, 'stroke-width': 1.2, 'stroke-dasharray': '2 5', opacity: 0.28 }, root);
      if (dUp) el('path', { d: dUp, fill: 'none', stroke: color, 'stroke-width': 2.2, opacity: 0.9, 'stroke-linecap': 'round' }, root);
    }

    // ---- грунт: силуэт гор LOLA, подсветка со стороны Солнца, зернистость ----
    let g = `M${ML},${MT + PH} `, hl = '';
    for (let az = 0; az <= 360; az += 0.5) {
      const py = y(hor(az)).toFixed(1), px = x(az).toFixed(1);
      g += `L${px},${py} `; hl += `${az ? 'L' : 'M'}${px},${py} `;
    }
    g += `L${ML + PW},${MT + PH} Z`;
    el('path', { d: g, fill: 'url(#groundLit)' }, root);
    el('path', { d: g, fill: 'url(#groundShade)' }, root);
    el('path', { d: g, fill: '#fff', filter: 'url(#grain)', opacity: 0.18 }, root);
    el('path', { d: hl, fill: 'none', stroke: 'rgba(235,240,255,0.85)', 'stroke-width': 1.4 }, root);
    if (sunLit) el('path', { d: hl, fill: 'none', stroke: '#ffd99a', 'stroke-width': 2.4, opacity: 0.35, filter: 'url(#glow)' }, root);
    const gl = el('text', { x: ML + 10, y: MT + PH - 10, class: 'sky-label' }, root);
    gl.textContent = labels.horizon;

    // ---- текущие положения ----
    function tag(cx, cy, text, color, below) {
      const t = el('text', { x: cx, y: cy, 'text-anchor': 'middle', class: 'sky-body', fill: color }, svg);
      t.textContent = text;
      // подпись не должна вылезать за края графика
      let w = 0; try { w = t.getComputedTextLength(); } catch (e) { w = 0; }
      if (!w) w = text.length * 9;
      t.setAttribute('x', Math.min(ML + PW - 8 - w / 2, Math.max(ML + 8 + w / 2, cx)));
      if (below) t.setAttribute('opacity', 0.8);
    }
    const fEl = (e) => `${e >= 0 ? '+' : '−'}${Math.abs(e).toFixed(2)}°`;

    // Солнце
    const s = now.sun, sx = x(s.az);
    if (s.up || (s.above && s.eclipse > 0.5)) {
      const sy = y(s.el);
      el('circle', { cx: sx, cy: sy, r: 34, fill: 'url(#haloGrad)' }, root);
      el('circle', { cx: sx, cy: sy, r: 11, fill: 'url(#sunGrad)', filter: 'url(#glow)' }, root);
      tag(sx, sy - 24, `${labels.sun} ${fEl(s.el)}${s.eclipse > 0.5 ? ' · ' + labels.eclipse : ''}`, '#ffc766');
    } else {
      const sy = yClamp(s.el);
      el('circle', { cx: sx, cy: sy, r: 9, fill: 'none', stroke: '#ffb547', 'stroke-width': 1.4, 'stroke-dasharray': '3 3', opacity: 0.7 }, svg);
      tag(sx, sy + 24, `${labels.sun} ${fEl(s.el)} · ${s.el > 0 ? labels.mountains : labels.below}`, '#ffb547', true);
    }

    // Земля — с фазой, как её видно с Луны (светлая сторона смотрит на Солнце)
    const e = now.earth, ex = x(e.az);
    const vs = vec(s), ve = vec(e);
    const elong = Math.acos(Math.max(-1, Math.min(1, vs[0] * ve[0] + vs[1] * ve[1] + vs[2] * ve[2])));
    const lit = (1 - Math.cos(elong)) / 2;   // освещённая доля диска Земли
    if (e.up) {
      const ey = y(e.el), R = 10;
      el('circle', { cx: ex, cy: ey, r: R + 6, fill: '#4cc3ff', opacity: 0.12 }, root);
      el('circle', { cx: ex, cy: ey, r: R, fill: '#0d1a2b', stroke: 'rgba(120,200,255,0.5)', 'stroke-width': 1 }, root);
      // направление на Солнце в экранных координатах
      let dx = x(s.az) - ex; if (dx > PW / 2) dx -= PW; if (dx < -PW / 2) dx += PW;
      const ang = Math.atan2(y(s.el) - ey, dx) * 180 / Math.PI;
      const k = 1 - 2 * lit;                 // полуось терминатора (−1…1)
      const rx = Math.abs(k) * R;
      const sweep = k > 0 ? 0 : 1;
      const dPh = `M0,${-R} A${R},${R} 0 0 1 0,${R} A${rx.toFixed(2)},${R} 0 0 ${sweep} 0,${-R} Z`;
      el('path', { d: dPh, fill: 'url(#earthGrad)', transform: `translate(${ex},${ey}) rotate(${ang.toFixed(1)})` }, root);
      tag(ex, ey - 20, `${labels.earth} ${fEl(e.el)}`, '#7fd4ff');
    } else {
      const ey = yClamp(e.el);
      el('circle', { cx: ex, cy: ey, r: 8, fill: 'none', stroke: '#4cc3ff', 'stroke-width': 1.4, 'stroke-dasharray': '3 3', opacity: 0.7 }, svg);
      tag(ex, ey + 23, `${labels.earth} ${fEl(e.el)} · ${e.el > 0 ? labels.mountains : labels.below}`, '#4cc3ff', true);
    }

    // рамка и стороны света
    el('rect', { x: ML, y: MT, width: PW, height: PH, rx: 8, fill: 'none', stroke: 'rgba(160,190,255,0.14)' }, svg);
    [[0, labels.N], [90, labels.E], [180, labels.S], [270, labels.W], [360, labels.N]].forEach(([az, name]) => {
      const t = el('text', { x: x(az), y: H - 12, 'text-anchor': 'middle', class: 'sky-dir' }, svg);
      t.textContent = name;
    });

    // легенда

    return { earthLit: lit };
  }

  return { render };
})();
