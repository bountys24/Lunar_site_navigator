/*
 * timeline.js — таймлайн на период: три дорожки (Солнце / Земля / оба),
 * курсор текущего момента, клик = перейти к этому моменту, подсказка при наведении.
 */
window.TimelineView = (function () {
  const NS = 'http://www.w3.org/2000/svg';
  const W = 1000, ML = 110, MR = 12, ROW = 26, GAP = 10, MT = 10;
  const PW = W - ML - MR;
  const H = MT + 3 * ROW + 2 * GAP + 34;

  function el(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  /**
   * opts: { svg, tip, samples, start(Date), stepH, now(Date), labels, lang, onPick(Date), describe(sample)->html }
   */
  function render(o) {
    const { svg, samples, start, stepH, now, labels } = o;
    const n = samples.length;
    const spanMs = n * stepH * 3600e3;
    const x = (ms) => ML + ((ms - start.getTime()) / spanMs) * PW;

    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.innerHTML = '';

    const rows = [
      { key: (s) => s.sun.up, color: '#ffb547', label: labels.sun },
      { key: (s) => s.earth.up, color: '#4cc3ff', label: labels.earth },
      { key: (s) => s.sun.up && s.earth.up, color: '#39d98a', label: labels.both },
    ];

    rows.forEach((r, ri) => {
      const top = MT + ri * (ROW + GAP);
      el('rect', { x: ML, y: top, width: PW, height: ROW, rx: 5, fill: 'rgba(255,255,255,0.05)' }, svg);
      const t = el('text', { x: ML - 10, y: top + ROW / 2 + 4, 'text-anchor': 'end', class: 'tl-label' }, svg);
      t.textContent = r.label;
      let runStart = null;
      for (let i = 0; i <= n; i++) {
        const on = i < n && r.key(samples[i]);
        if (on && runStart === null) runStart = i;
        if (!on && runStart !== null) {
          const x0 = ML + (runStart / n) * PW, x1 = ML + (i / n) * PW;
          el('rect', { x: x0, y: top + 3, width: Math.max(1, x1 - x0), height: ROW - 6, rx: 3, fill: r.color }, svg);
          runStart = null;
        }
      }
    });

    // подписи дней
    const axisY = MT + 3 * ROW + 2 * GAP + 20;
    const days = Math.round(spanMs / 86400e3);
    const every = days > 20 ? 5 : days > 10 ? 2 : 1;
    for (let d = 0; d <= days; d += every) {
      const ms = start.getTime() + d * 86400e3;
      const xx = x(ms);
      el('line', { x1: xx, x2: xx, y1: MT, y2: axisY - 12, stroke: 'rgba(255,255,255,0.08)' }, svg);
      const t = el('text', { x: xx, y: axisY, 'text-anchor': 'middle', class: 'tl-tick' }, svg);
      t.textContent = new Date(ms).toLocaleDateString(o.lang === 'ru' ? 'ru-RU' : 'en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
    }

    // курсор
    const cx = x(now.getTime());
    if (cx >= ML && cx <= ML + PW) {
      el('line', { x1: cx, x2: cx, y1: MT - 6, y2: axisY - 12, stroke: '#fff', 'stroke-width': 2 }, svg);
      el('circle', { cx, cy: MT - 6, r: 4, fill: '#fff' }, svg);
    }

    // интерактив: hover + click
    const hit = el('rect', { x: ML, y: 0, width: PW, height: H, fill: 'transparent', style: 'cursor:pointer' }, svg);
    const toIndex = (evt) => {
      const pt = svg.createSVGPoint(); pt.x = evt.clientX; pt.y = evt.clientY;
      const p = pt.matrixTransform(svg.getScreenCTM().inverse());
      return Math.max(0, Math.min(n - 1, Math.floor(((p.x - ML) / PW) * n)));
    };
    hit.addEventListener('mousemove', (evt) => {
      const s = samples[toIndex(evt)];
      o.tip.innerHTML = o.describe(s);
      o.tip.style.display = 'block';
      const box = svg.getBoundingClientRect();
      const left = Math.min(box.width - 220, Math.max(0, evt.clientX - box.left + 12));
      o.tip.style.left = left + 'px';
      o.tip.style.top = (evt.clientY - box.top + 14) + 'px';
    });
    hit.addEventListener('mouseleave', () => { o.tip.style.display = 'none'; });
    hit.addEventListener('click', (evt) => {
      const i = toIndex(evt);
      o.onPick(new Date(start.getTime() + i * stepH * 3600e3));
    });
  }

  return { render };
})();
