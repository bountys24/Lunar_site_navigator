/*
 * extras2.js — «Брифинг миссии» (карточка PNG одной кнопкой) и «История посадок» (лента времени).
 * Все цифры берутся из того же расчёта, что и вердикт на сайте.
 */
(function () {
  'use strict';
  const L = () => window.LSN;
  const $ = (id) => document.getElementById(id);
  const ru = () => L().state.lang === 'ru';

  // ======================= БРИФИНГ МИССИИ =======================
  function briefing() {
    const r = L().state.res; if (!r) return;
    const W = 1600, H = 900, c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d');
    const MINT = '#7dffd2', HI = '#e9fff7', SUN = '#ffcf6b', EARTH = '#5cc8ff', MONO = '"JetBrains Mono", "DejaVu Sans Mono", Consolas, monospace';
    const vcol = { ok: '#9dffde', warn: '#ffd98a', bad: '#ff8a7a' }[r.verdict];
    const vtxt = { ok: ru() ? 'МОЖНО САДИТЬСЯ' : 'GO FOR LANDING', warn: ru() ? 'ОСТОРОЖНО' : 'GO WITH CAUTION', bad: ru() ? 'НЕЛЬЗЯ' : 'NO GO' }[r.verdict];
    const name = L().siteName();
    const f = (sz, w) => `${w || 400} ${sz}px ${MONO}`;
    const text = (s, x, y, sz, col, w, al, ls) => { g.font = f(sz, w); g.fillStyle = col; g.textAlign = al || 'left'; if ('letterSpacing' in g) g.letterSpacing = (ls || 0) + 'px'; g.fillText(s, x, y); };

    // фон
    const bg = g.createRadialGradient(W * 0.6, H * 0.4, 50, W * 0.6, H * 0.4, W);
    bg.addColorStop(0, '#06141a'); bg.addColorStop(1, '#010305'); g.fillStyle = bg; g.fillRect(0, 0, W, H);
    let s = 7; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 380; i++) { g.fillStyle = `rgba(255,255,255,${0.15 + rnd() * 0.5})`; g.fillRect(rnd() * W, rnd() * H, rnd() < 0.1 ? 2 : 1, rnd() < 0.1 ? 2 : 1); }
    g.strokeStyle = MINT; g.lineWidth = 3;
    [[30, 30, 1, 1], [W - 30, 30, -1, 1], [30, H - 30, 1, -1], [W - 30, H - 30, -1, -1]].forEach(([x, y, dx, dy]) => { g.beginPath(); g.moveTo(x, y + dy * 60); g.lineTo(x, y); g.lineTo(x + dx * 60, y); g.stroke(); });

    // шапка
    text('LUNAR SITE NAVIGATOR · ' + (ru() ? 'БРИФИНГ МИССИИ' : 'MISSION BRIEFING'), 80, 92, 15, MINT, 400, 'left', 5);
    text(name.toUpperCase(), 80, 140, name.length > 30 ? 30 : 38, HI, 600, 'left', 4);
    const d = r.start.toISOString();
    text((ru() ? 'ПОСАДКА · UTC' : 'LANDING · UTC'), W - 80, 92, 15, MINT, 400, 'right', 4);
    text(d.slice(0, 10) + '  ' + d.slice(11, 16), W - 80, 138, 34, HI, 600, 'right', 3);
    text((ru() ? 'МИССИЯ ' : 'MISSION ') + r.missionDays + (ru() ? ' ДН.' : ' DAYS'), W - 80, 168, 14, MINT, 400, 'right', 3);
    g.fillStyle = 'rgba(125,255,210,.35)'; g.fillRect(80, 190, W - 160, 1);

    // вердикт-печать
    g.save(); g.translate(270, 300); g.rotate(-0.05);
    g.strokeStyle = vcol; g.lineWidth = 4; g.shadowColor = vcol; g.shadowBlur = 18; g.strokeRect(-190, -62, 380, 124); g.shadowBlur = 0;
    text(ru() ? 'ВЕРДИКТ' : 'VERDICT', 0, -26, 14, vcol, 400, 'center', 6);
    text(ru() ? 'ПРЕДВАРИТЕЛЬНАЯ ОЦЕНКА' : 'PRELIMINARY ASSESSMENT', 0, 92, 12, vcol, 400, 'center', 3);
    text(vtxt, 0, 28, vtxt.length > 12 ? 30 : 40, vcol, 700, 'center', 5);
    g.restore();

    // шкалы
    const gauge = (cx, cy, v, col, label) => {
      g.lineWidth = 12; g.strokeStyle = 'rgba(125,255,210,.14)'; g.beginPath(); g.arc(cx, cy, 62, 0, Math.PI * 2); g.stroke();
      g.strokeStyle = col; g.lineCap = 'round'; g.beginPath(); g.arc(cx, cy, 62, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0.001, v / 100)); g.stroke(); g.lineCap = 'butt';
      text(Math.round(v) + '%', cx, cy + 11, 30, HI, 600, 'center');
      text(label, cx, cy + 100, 13, MINT, 400, 'center', 3);
    };
    gauge(170, 500, r.mission.sunPct, SUN, ru() ? 'СОЛНЦЕ' : 'SUNLIGHT');
    gauge(370, 500, r.mission.earthPct, EARTH, ru() ? 'ВИДИМОСТЬ ЗЕМЛИ' : 'EARTH IN VIEW');

    // проверки
    const fmt = { slope: (c) => c.value == null || isNaN(c.value) ? '—' : c.value.toFixed(1) + '°', landLight: (c) => c.value ? (ru() ? 'ДА' : 'YES') : (ru() ? 'НЕТ' : 'NO'),
      craters: (c) => c.value.steepPct + '%', sunset: (c) => c.value === 0 ? '—' : L().fmt.fSunset(c.value * 3600e3).toUpperCase(),
      sun: (c) => Math.round(c.value) + '%', earth: (c) => Math.round(c.value) + '%' };
    const ico = { ok: '✓', warn: '!', bad: '✗', na: '—' }, icol = { ok: '#5cffa8', warn: SUN, bad: '#ff6b5c', na: '#888' };
    let y = 618;
    text(ru() ? 'ПРОВЕРКИ' : 'CHECKS', 80, y - 24, 13, MINT, 400, 'left', 4);
    r.checks.forEach((ck) => {
      text(ico[ck.level], 84, y, 16, icol[ck.level], 700);
      text(L().t('ck.' + ck.key).toUpperCase().slice(0, 30), 112, y, 13.5, HI, 400);
      text(fmt[ck.key] ? fmt[ck.key](ck) : '', 470, y, 13.5, icol[ck.level], 600, 'right');
      y += 27;
    });

    // панорама горизонта с путями Солнца и Земли за миссию
    const PX = 560, PY = 230, PW = 960, PH = 300;
    const mask = r.site.horizon && r.site.horizon.length ? r.site.horizon : new Array(360).fill(0);
    const S = r.S.slice(0, Math.round(r.missionDays * 24));
    let hi = Math.max(4, ...mask) , lo = Math.min(0, ...mask);
    S.forEach((q) => { ['sun', 'earth'].forEach((k) => { if (q[k].up) hi = Math.max(hi, q[k].el + 1); }); });
    hi = Math.min(90, hi * 1.12 + 0.5); lo = lo - (hi - lo) * 0.25;
    const X = (az) => PX + az / 360 * PW, Y = (e) => PY + (1 - (e - lo) / (hi - lo)) * PH;
    g.fillStyle = 'rgba(0,10,14,.65)'; g.fillRect(PX, PY, PW, PH); g.strokeStyle = 'rgba(125,255,210,.35)'; g.lineWidth = 1; g.strokeRect(PX, PY, PW, PH);
    text(ru() ? 'ГОРИЗОНТ С МЕСТА ПОСАДКИ (NASA LOLA) · ПУТИ СОЛНЦА И ЗЕМЛИ ЗА МИССИЮ' : 'HORIZON FROM THE SITE (NASA LOLA) · SUN & EARTH PATHS DURING MISSION', PX, PY - 14, 12.5, MINT, 400, 'left', 2);
    g.save(); g.beginPath(); g.rect(PX, PY, PW, PH); g.clip();
    const path = (k, col) => {
      g.strokeStyle = col; g.lineWidth = 2.2; g.beginPath(); let prev = null;
      S.forEach((q) => { const p = q[k]; const x = X(p.az), yy = Y(p.el); if (!prev || Math.abs(p.az - prev.az) > 180) g.moveTo(x, yy); else g.lineTo(x, yy); prev = p; });
      g.stroke();
    };
    path('earth', EARTH); path('sun', SUN);
    const gr = g.createLinearGradient(0, PY, 0, PY + PH); gr.addColorStop(0, '#8d8a84'); gr.addColorStop(1, '#1d1d20');
    g.fillStyle = gr; g.beginPath(); g.moveTo(PX, PY + PH);
    for (let a = 0; a <= 360; a++) g.lineTo(X(a), Y(mask[a % 360]));
    g.lineTo(PX + PW, PY + PH); g.closePath(); g.fill();
    g.strokeStyle = '#eef'; g.lineWidth = 1.2; g.beginPath(); for (let a = 0; a <= 360; a++) { const x = X(a), yy = Y(mask[a % 360]); a ? g.lineTo(x, yy) : g.moveTo(x, yy); } g.stroke();
    g.restore();
    ['N', 'E', 'S', 'W', 'N'].forEach((n, i) => text(L().t('dir.' + n), X(i * 90), PY + PH + 22, 13, HI, 600, 'center'));

    // полоса 30 дней: свет и связь по часам
    const BX = 560, BY = 640, BW = 960;
    text(ru() ? '30 ДНЕЙ ПО ЧАСАМ' : 'NEXT 30 DAYS, HOURLY', BX, BY - 16, 12.5, MINT, 400, 'left', 2);
    const n = r.S.length, cw = BW / n;
    r.S.forEach((q, i) => {
      g.fillStyle = q.sun.up ? SUN : 'rgba(255,207,107,.08)'; g.fillRect(BX + i * cw, BY, cw + 0.4, 26);
      g.fillStyle = q.earth.up ? EARTH : 'rgba(92,200,255,.08)'; g.fillRect(BX + i * cw, BY + 34, cw + 0.4, 26);
    });
    const mw = Math.min(n, r.missionDays * 24) * cw;
    g.strokeStyle = '#9dffde'; g.lineWidth = 2; g.strokeRect(BX - 2, BY - 4, mw + 4, 68);
    text(ru() ? 'МИССИЯ' : 'MISSION', BX + mw / 2, BY + 86, 12, '#9dffde', 600, 'center', 3);
    text('■ ' + (ru() ? 'свет' : 'sunlight'), BX, BY + 112, 13, SUN, 400); text('■ ' + (ru() ? 'Земля в прямой видимости' : 'Earth line of sight'), BX + 140, BY + 112, 13, EARTH, 400);
    for (let dd = 0; dd <= 30; dd += 5) text('+' + dd + (ru() ? 'д' : 'd'), BX + dd * 24 * cw, BY + 86, 11, 'rgba(233,255,247,.6)', 400, 'center');

    // подвал
    const p = r.p;
    const elev = r.terrain.covered ? Math.round(r.terrain.elev) + ' m' : '—';
    text(`${Math.abs(p.lat).toFixed(4)}°${p.lat < 0 ? 'S' : 'N'}  ${(((p.lon % 360) + 360) % 360).toFixed(4)}°E  ·  ${ru() ? 'ВЫСОТА' : 'ELEV'} ${elev}  ·  ${r.terrain.covered ? 'NASA ' + r.terrain.source : ''}`, 80, H - 48, 13, HI, 400, 'left', 1);
    text('NASA LOLA (80 M TERRAIN, 5 M HAZARDS) · JPL HORIZONS (0.004°) · SPACE APPS 2026', W - 80, H - 48, 12, MINT, 400, 'right', 2);

    showModal(c.toDataURL('image/png'), 'briefing-' + (L().state.siteId || 'site') + '-' + d.slice(0, 10) + '.png');
  }

  function showModal(url, fname) {
    let m = $('briefModal');
    if (!m) {
      m = document.createElement('div'); m.id = 'briefModal'; m.className = 'brief-modal';
      m.innerHTML = `<div class="brief-box"><img id="briefImg" alt=""><div class="brief-btns"><a id="briefDl" class="btn primary"></a><button id="briefClose" class="btn"></button></div></div>`;
      document.body.appendChild(m);
      m.addEventListener('click', (e) => { if (e.target === m || e.target.id === 'briefClose') m.classList.add('hidden'); });
    }
    $('briefImg').src = url; $('briefDl').href = url; $('briefDl').download = fname;
    $('briefDl').textContent = ru() ? '⬇ Скачать PNG' : '⬇ Download PNG';
    $('briefClose').textContent = ru() ? 'Закрыть' : 'Close';
    m.classList.remove('hidden');
  }

  // ======================= ИСТОРИЯ ПОСАДОК =======================
  const HISTORY = [
    ['a11', '1969'], ['a12', '1969'], ['a14', '1971'], ['a15', '1971'], ['a16', '1972'], ['a17', '1972'],
    ['ce4', '2019'], ['ce5', '2020'], ['ch3', '2023'], ['slim', '2024'], ['im1', '2024'], ['ce6', '2024'],
    ['bg1', '2025'], ['im2', '2025'], ['change7', '2026'], ['ridge', 'ARTEMIS'], ['haworth', 'ARTEMIS'], ['malapert', 'ARTEMIS'],
  ];
  function renderHistory() {
    const el = $('history'); if (!el) return;
    const cur = L().state.siteId;
    el.innerHTML = `<span class="h-lab">${ru() ? 'ИСТОРИЯ ПОСАДОК' : 'LANDING HISTORY'}</span><div class="h-line">` + HISTORY.map(([id, yr], i) => {
      const s = L().siteMeta(id); if (!s) return '';
      const showYr = ['a11', 'ce4', 'slim', 'bg1', 'ridge'].includes(id);
      return `<button class="h-dot ${id === cur ? 'on' : ''} ${yr === 'ARTEMIS' ? 'plan' : ''}" data-id="${id}" title="${s.name[L().state.lang]} · ${yr}"><i></i>${showYr ? `<em>${yr === 'ARTEMIS' ? (ru() ? 'план' : 'plan') : yr}</em>` : ''}</button>`;
    }).join('') + `</div><span class="h-name" id="hName"></span>`;
    const nm = L().siteMeta(cur); $('hName').textContent = nm && HISTORY.some((h) => h[0] === cur) ? nm.name[L().state.lang] : '';
    el.querySelectorAll('.h-dot').forEach((b) => {
      b.addEventListener('click', () => { const s = L().siteMeta(b.dataset.id); L().selectPoint({ lat: s.lat, lon: s.lon }, s.id, true); });
      b.addEventListener('mouseenter', () => { $('hName').textContent = L().siteMeta(b.dataset.id).name[L().state.lang]; });
      b.addEventListener('mouseleave', () => { const m2 = L().siteMeta(L().state.siteId); $('hName').textContent = m2 && HISTORY.some((h) => h[0] === m2.id) ? m2.name[L().state.lang] : ''; });
    });
  }

  function init() {
    if (!window.LSN) return setTimeout(init, 100);
    const b = $('btnBrief'); if (b) b.addEventListener('click', briefing);
    L().on((ev) => { if (ev === 'analysis' || ev === 'lang') { renderHistory(); const bb = $('btnBriefTxt'); if (bb) bb.textContent = ru() ? 'Брифинг миссии' : 'Mission briefing'; } });
    renderHistory();
    const bb = $('btnBriefTxt'); if (bb) bb.textContent = ru() ? 'Брифинг миссии' : 'Mission briefing';
  }
  init();
  window.Briefing = { make: briefing };
})();
