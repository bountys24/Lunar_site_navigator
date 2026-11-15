/*
 * extras.js — шаги 4–6:
 *   «Рядом»      — карта чувствительности: как меняются свет/связь/уклон, если сдвинуть точку
 *   «Даты»       — перенос посадки на N дней + поиск лучших дат
 *   «Год»        — свет и связь по дням за год (сезоны)
 *   «Сравнение»  — 2–3 сценария рядом
 *   «Луна и Земля» — объяснения простыми словами
 *   CSV-выгрузка, режим «Презентация» (автотур для видео)
 */
(function () {
  'use strict';
  const L = window.LSN, E = window.LunarEngine, A = window.Analysis, T = window.Terrain;
  const $ = (id) => document.getElementById(id);
  const t = (k) => L.t(k), f = L.fmt;
  const HOUR = 3600e3, R_KM = 1737.4;
  const keyOf = () => { const s = L.state; return s.point.lat.toFixed(5) + s.point.lon.toFixed(5) + s.res.start.getTime() + s.missionDays; };
  const lvl = (v, r, hi = true) => hi ? (v >= r.ok ? 'ok' : v >= r.warn ? 'warn' : 'bad') : (v <= r.ok ? 'ok' : v <= r.warn ? 'warn' : 'bad');
  const rank = { ok: 0, na: 0, warn: 1, bad: 2 };
  const worst = (...ls) => ls.reduce((a, b) => (rank[b] > rank[a] ? b : a), 'ok');
  const COL = { ok: '#39d98a', warn: '#ffcc4d', bad: '#ff5c5c', na: '#3a4250' };

  // смещение по поверхности сферы (восток, север) в км — корректно и у самого полюса
  function offsetPoint(p, eastKm, northKm) {
    const d = Math.PI / 180, la = p.lat * d, lo = p.lon * d;
    const u = [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
    const e = [-Math.sin(lo), Math.cos(lo), 0];
    const n = [-Math.sin(la) * Math.cos(lo), -Math.sin(la) * Math.sin(lo), Math.cos(la)];
    const v = [0, 1, 2].map((k) => u[k] + (e[k] * eastKm + n[k] * northKm) / R_KM);
    const len = Math.hypot(v[0], v[1], v[2]);
    return { lat: Math.asin(v[2] / len) / d, lon: ((Math.atan2(v[1], v[0]) / d) + 360) % 360 };
  }

  // ======================= 4a. РЯДОМ (чувствительность) =======================
  let sensCache = null;
  function computeSens() {
    const r = L.state.res, N = 11, step = +$('sensStep').value;
    const days = L.state.missionDays, S = r.S.slice(0, days * 24);
    const half = (N - 1) / 2, cells = [];
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const de = (j - half) * step, dn = (half - i) * step;
      const p = offsetPoint(r.p, de, dn);
      const c = { i, j, de, dn, p };
      if (!T.covers(p.lat, p.lon)) { c.level = 'na'; cells.push(c); continue; }
      const hm = (i === half && j === half && r.terrain.mask) ? { mask: r.terrain.mask } : T.horizonMask(p.lat, p.lon, 2, 120, 200);
      let su = 0, eu = 0;
      for (const s of S) {
        if (s.sun.el > E.horizonAt({ horizon: hm.mask }, s.sun.az)) su++;
        if (s.earth.el > E.horizonAt({ horizon: hm.mask }, s.earth.az)) eu++;
      }
      c.sun = 100 * su / S.length; c.earth = 100 * eu / S.length; c.slope = T.slopeAt(p.lat, p.lon);
      c.haz = T.hazardAt ? T.hazardAt(p.lat, p.lon) : null;
      c.level = worst(lvl(c.slope, A.RULES.slope, false), lvl(c.sun, A.RULES.sun), lvl(c.earth, A.RULES.earth),
        c.haz ? lvl(c.haz.steepPct, A.RULES.steep, false) : 'ok');
      c.score = c.sun * 0.5 + c.earth * 0.3 - Math.max(0, c.slope - 10) * 4 - (c.haz ? c.haz.steepPct * 0.8 : 0);
      cells.push(c);
    }
    const valid = cells.filter((c) => c.level !== 'na');
    const center = cells[half * N + half];
    const best = valid.reduce((a, b) => (b.score > a.score ? b : a), valid[0] || center);
    return { N, step, cells, center, best, key: keyOf() + step };
  }
  function renderSens(reason) {
    const r = L.state.res; if (!r) return;
    const box = $('sensBox');
    if (!r.terrain.covered) { box.innerHTML = `<p class="hint">${t('v.noTerrain')}</p>`; $('sensInfo').innerHTML = ''; return; }
    const key = keyOf() + $('sensStep').value;
    if (!sensCache || sensCache.key !== key) {
      if (reason === 'view' && sensCache && sensCache.key.startsWith(keyOf())) { /* ok */ }
      box.innerHTML = `<p class="hint">${t('sens.calc')}</p>`;
      setTimeout(() => { sensCache = computeSens(); drawSens(); }, 20);
      return;
    }
    drawSens();
  }
  function drawSens() {
    const d = sensCache, box = $('sensBox');
    const size = Math.min(box.clientWidth || 520, 520), cs = size / d.N;
    box.innerHTML = `<canvas id="sensCv" width="${size}" height="${size}"></canvas><div class="sens-legend">
      <span><i style="background:${COL.ok}"></i>${t('v.okS')}</span><span><i style="background:${COL.warn}"></i>${t('v.warnS')}</span>
      <span><i style="background:${COL.bad}"></i>${t('v.badS')}</span><span><i style="background:${COL.na}"></i>${t('ck.na')}</span></div>`;
    const cv = $('sensCv'), g = cv.getContext('2d');
    d.cells.forEach((c) => {
      g.fillStyle = COL[c.level]; g.globalAlpha = c.level === 'na' ? 1 : 0.35 + 0.6 * Math.min(1, (c.sun || 0) / 100);
      g.fillRect(c.j * cs + 1, c.i * cs + 1, cs - 2, cs - 2);
      g.globalAlpha = 1;
      if (c.level !== 'na' && cs > 34) { g.fillStyle = '#07090c'; g.font = `600 ${Math.round(cs / 4)}px JetBrains Mono, monospace`; g.textAlign = 'center'; g.fillText(Math.round(c.sun) + '%', c.j * cs + cs / 2, c.i * cs + cs / 2 + cs / 10); }
    });
    const mark = (c, color, w) => { g.strokeStyle = color; g.lineWidth = w; g.strokeRect(c.j * cs + 2, c.i * cs + 2, cs - 4, cs - 4); };
    mark(d.center, '#3dd6d0', 3);
    if (d.best !== d.center) mark(d.best, '#ffffff', 3);
    g.fillStyle = '#e6edf3'; g.font = '12px JetBrains Mono, monospace'; g.textAlign = 'left';
    g.fillText(t('dir.N') + ' ↑', 6, 14);
    cv.onclick = (e) => {
      const rc = cv.getBoundingClientRect();
      const j = Math.floor((e.clientX - rc.left) / rc.width * d.N), i = Math.floor((e.clientY - rc.top) / rc.height * d.N);
      const c = d.cells[i * d.N + j]; if (c && c.level !== 'na') L.selectPoint(c.p, null, false);
    };
    cv.onmousemove = (e) => {
      const rc = cv.getBoundingClientRect();
      const j = Math.floor((e.clientX - rc.left) / rc.width * d.N), i = Math.floor((e.clientY - rc.top) / rc.height * d.N);
      const c = d.cells[i * d.N + j]; if (!c) return;
      cv.title = c.level === 'na' ? t('ck.na') : `${t('sky.sun')} ${f.fPct(c.sun)} · ${t('sky.earth')} ${f.fPct(c.earth)} · ${t('p.slope')} ${c.slope}°${c.haz ? ' · ' + t('ck.craters') + ': ' + c.haz.steepPct + '%' : ''} · ${Math.hypot(c.de, c.dn).toFixed(1)} km`;
    };
    const ce = d.center, b = d.best;
    let html = `<div class="metric sun"><span>${t('sens.here')}</span><b>${ICON('sun')}${f.fPct(ce.sun)} · ${ICON('earth')}${f.fPct(ce.earth)}</b></div>`;
    if (b !== ce && b.score > ce.score + 1 && (rank[b.level] < rank[ce.level] || b.sun > ce.sun + 3 || b.earth > ce.earth + 5)) {
      const dist = Math.hypot(b.de, b.dn), dir = dirName(b.de, b.dn);
      html += `<div class="metric both"><span>${t('sens.best')}</span><b>${ICON('sun')}${f.fPct(b.sun)} · ${ICON('earth')}${f.fPct(b.earth)} · ${t('p.slope')} ${b.slope}°</b><small>${dist.toFixed(1)} km ${dir}</small></div>
        <button class="btn primary" id="sensGo">${t('sens.go')}</button>`;
    } else html += `<div class="metric both"><span>${t('sens.best')}</span><b>${ce.sun < 5 && b.sun < 5 ? t('sens.allDark') : t('sens.already')}</b></div>`;
    html += `<p class="hint">${t('sens.hint')}</p>`;
    $('sensInfo').innerHTML = html;
    if ($('sensGo')) $('sensGo').onclick = () => L.selectPoint(b.p, null, false);
  }
  function dirName(de, dn) {
    const a = (Math.atan2(de, dn) * 180 / Math.PI + 360) % 360;
    const names = L.state.lang === 'ru' ? ['к северу', 'к северо-востоку', 'к востоку', 'к юго-востоку', 'к югу', 'к юго-западу', 'к западу', 'к северо-западу'] : ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
    return names[Math.round(a / 45) % 8];
  }
  $('sensStep').addEventListener('change', () => renderSens('analysis'));
  L.registerTab('near', renderSens);

  // ======================= 4b + 5b. ДАТЫ (перенос + поиск лучших) =======================
  let datesCache = null;
  function computeDates() {
    const r = L.state.res, md = L.state.missionDays, months = +$('fdMonths').value;
    const step = 3, days = months * 30 + md + 2;
    const S = A.series(r.start, days, r.site, step);
    const k = Math.round(md * 24 / step);
    const ps = [0], pe = [0];
    S.forEach((s, i) => { ps.push(ps[i] + s.sun.up); pe.push(pe[i] + s.earth.up); });
    const nextSet = new Array(S.length).fill(Infinity);           // часов до заката от каждой точки
    for (let i = S.length - 2; i >= 0; i--) nextSet[i] = S[i + 1].sun.above ? (nextSet[i + 1] === Infinity ? Infinity : nextSet[i + 1] + step) : step;
    const slopeL = r.terrain.covered ? lvl(r.terrain.slope, A.RULES.slope, false) : 'na';
    const minSun = +$('fdSun').value, minEarth = +$('fdEarth').value;
    const cands = [];
    for (let i = 0; i + k < S.length; i++) {
      const sun = 100 * (ps[i + k] - ps[i]) / k, earth = 100 * (pe[i + k] - pe[i]) / k;
      const light = !!S[i].sun.up, hs = light ? nextSet[i] : 0;
      const level = worst(slopeL, light ? 'ok' : 'bad', light ? lvl(hs, A.RULES.sunset) : 'bad', lvl(sun, A.RULES.sun), lvl(earth, A.RULES.earth));
      const meets = light && sun >= minSun && earth >= minEarth && hs >= A.RULES.sunset.warn;
      cands.push({ date: S[i].date, sun, earth, light, hs, level, meets, score: sun * 0.5 + earth * 0.35 + Math.min(hs, 336) / 336 * 15 });
    }
    const top = [];
    cands.filter((c) => c.meets).sort((a, b) => b.score - a.score).forEach((c) => { if (top.length < 5 && top.every((x) => Math.abs(x.date - c.date) > 2 * 86400e3)) top.push(c); });
    const at = (dDays) => cands[Math.min(cands.length - 1, Math.round(dDays * 24 / step))];
    const nextGood = cands.find((c) => c.level === 'ok');
    return { key: keyOf() + months + minSun + minEarth, cands, top, at, nextGood, step };
  }
  function renderDates() {
    const r = L.state.res; if (!r) return;
    const key = keyOf() + $('fdMonths').value + $('fdSun').value + $('fdEarth').value;
    if (!datesCache || datesCache.key !== key) { $('delayBox').innerHTML = `<p class="hint">${t('sens.calc')}</p>`; setTimeout(() => { datesCache = computeDates(); drawDates(); }, 20); return; }
  }
  function drawDates() {
    const d = datesCache;
    // перенос посадки
    const shifts = [0, 1, 3, 7, 14];
    let h = `<table class="dtable"><thead><tr><th>${t('dl.shift')}</th><th>${t('dl.date')}</th><th>${t('dl.verdict')}</th><th>${ICON('sun')}</th><th>${ICON('earth')}</th><th>${t('q.sunset')}</th></tr></thead><tbody>`;
    shifts.forEach((s) => {
      const c = d.at(s);
      h += `<tr><td>${s ? '+' + s + ' ' + t('unit.d') : t('dl.now')}</td><td class="mono">${f.fUTC(c.date)}</td><td><span class="pill ${c.level}">${t('v.' + c.level + 'S')}</span></td>
        <td class="mono">${f.fPct(c.sun)}</td><td class="mono">${f.fPct(c.earth)}</td><td class="mono">${c.light ? f.fSunset(c.hs * HOUR) : '—'}</td></tr>`;
    });
    h += '</tbody></table>';
    if (d.nextGood) h += `<p class="verdict-line ok">${ICON('ok')} ${t('dl.nextGood')}: <b class="mono">${f.fUTC(d.nextGood.date)}</b> <button class="btn small" data-load="${d.nextGood.date.getTime()}">${t('cmp.open')}</button></p>`;
    else h += `<p class="verdict-line bad">${t('dl.noGood')}</p>`;
    $('delayBox').innerHTML = h;

    // полоса окон посадки
    const cv = $('fdStrip'), W = cv.parentElement.clientWidth || 800, H = 54; cv.width = W; cv.height = H;
    const g = cv.getContext('2d'); const n = d.cands.length;
    d.cands.forEach((c, i) => { g.fillStyle = c.meets ? COL.ok : (c.light ? 'rgba(255,204,77,0.35)' : 'rgba(255,92,92,0.25)'); g.fillRect(i / n * W, 8, Math.ceil(W / n) + 1, 26); });
    g.fillStyle = '#7d8b9c'; g.font = '11px JetBrains Mono, monospace';
    const t0 = d.cands[0].date.getTime(), t1 = d.cands[n - 1].date.getTime();
    for (let m = new Date(Date.UTC(new Date(t0).getUTCFullYear(), new Date(t0).getUTCMonth() + 1, 1)); m.getTime() < t1; m.setUTCMonth(m.getUTCMonth() + 1)) {
      const x = (m - t0) / (t1 - t0) * W; g.fillRect(x, 4, 1, 34); g.fillText(m.toLocaleDateString(L.state.lang === 'ru' ? 'ru-RU' : 'en-GB', { month: 'short', timeZone: 'UTC' }), x + 3, 50);
    }
    d.top.forEach((c, i) => { const x = (c.date - t0) / (t1 - t0) * W; g.fillStyle = '#fff'; g.fillRect(x - 1, 2, 2, 36); g.fillText(i + 1, x + 3, 12); });
    cv.onclick = (e) => { const rc = cv.getBoundingClientRect(); const c = d.cands[Math.floor((e.clientX - rc.left) / rc.width * n)]; if (c) L.setLanding(c.date); };

    let top = d.top.map((c, i) => `<div class="fd-item"><span class="fd-rank">${i + 1}</span><div><b class="mono">${f.fUTC(c.date)}</b><br>
      <small>${ICON('sun')}${f.fPct(c.sun)} · ${ICON('earth')}${f.fPct(c.earth)} · ${t('q.sunset')} ${f.fSunset(c.hs * HOUR)}</small></div>
      <button class="btn small" data-load="${c.date.getTime()}">${t('cmp.open')}</button><button class="btn small" data-cmp="${c.date.getTime()}">${t('btn.compare')}</button></div>`).join('');
    $('fdList').innerHTML = top || `<p class="verdict-line bad">${t('fd.none')}</p>`;
    document.querySelectorAll('#tab-dates [data-load]').forEach((b) => { b.onclick = () => L.setLanding(new Date(+b.dataset.load)); });
    document.querySelectorAll('#tab-dates [data-cmp]').forEach((b) => { b.onclick = () => { addCompare(new Date(+b.dataset.cmp)); b.textContent = '✓'; b.disabled = true; }; });
  }
  ['fdMonths', 'fdSun', 'fdEarth'].forEach((id) => $(id).addEventListener('change', () => { datesCache = null; renderDates(); }));
  L.registerTab('dates', renderDates);

  // ======================= 4c. ГОД (сезоны) =======================
  let yearCache = null;
  function renderYear() {
    const r = L.state.res; if (!r) return;
    const key = r.p.lat.toFixed(5) + r.p.lon.toFixed(5) + r.start.toISOString().slice(0, 10);
    if (yearCache && yearCache.key === key) return;
    $('yearBox').innerHTML = `<p class="hint">${t('sens.calc')}</p>`;
    setTimeout(() => {
      const start = new Date(Date.UTC(r.start.getUTCFullYear(), r.start.getUTCMonth(), r.start.getUTCDate()));
      const S = A.series(start, 365, r.site, 2);
      yearCache = { key, S, start }; drawYear();
    }, 20);
  }
  function drawYear() {
    const { S, start } = yearCache, box = $('yearBox');
    const W = Math.max(600, box.clientWidth || 900), cellW = W / 365, cellH = 7, H = 12 * cellH + 34;
    box.innerHTML = `<canvas id="yearCv" width="${W}" height="${H}"></canvas><div class="sens-legend">
      <span><i style="background:${COL.ok}"></i>${t('tl.both')}</span><span><i style="background:#ffb547"></i>${t('yr.sunOnly')}</span>
      <span><i style="background:#4cc3ff"></i>${t('yr.earthOnly')}</span><span><i style="background:#1a1f28"></i>${t('yr.none')}</span></div>`;
    const g = $('yearCv').getContext('2d');
    S.forEach((s, i) => {
      const day = Math.floor(i / 12), slot = i % 12;
      g.fillStyle = s.sun.up && s.earth.up ? COL.ok : s.sun.up ? '#ffb547' : s.earth.up ? '#4cc3ff' : '#1a1f28';
      g.fillRect(day * cellW, slot * cellH, Math.ceil(cellW), cellH - 1);
    });
    g.fillStyle = '#7d8b9c'; g.font = '11px JetBrains Mono, monospace';
    for (let m = 0; m < 12; m++) {
      const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + m, 1)); const day = (d - start) / 86400e3;
      if (day < 0) continue; g.fillRect(day * cellW, 0, 1, 12 * cellH + 4);
      g.fillText(d.toLocaleDateString(L.state.lang === 'ru' ? 'ru-RU' : 'en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' }), day * cellW + 3, 12 * cellH + 18);
    }
    const sun = 100 * S.filter((s) => s.sun.up).length / S.length, earth = 100 * S.filter((s) => s.earth.up).length / S.length, both = 100 * S.filter((s) => s.sun.up && s.earth.up).length / S.length;
    $('yearInfo').innerHTML = [['m.sunY', f.fPct(sun), 'sun'], ['m.earthY', f.fPct(earth), 'earth'], ['m.bothY', f.fPct(both), 'both']]
      .map(([k, v, c]) => `<div class="metric ${c}"><span>${t(k)}</span><b>${v}</b></div>`).join('');
    $('yearCv').onclick = (e) => { const rc = e.target.getBoundingClientRect(); const day = Math.floor((e.clientX - rc.left) / rc.width * 365); L.setLanding(new Date(start.getTime() + day * 86400e3 + 12 * HOUR)); };
  }
  L.registerTab('year', renderYear);

  // ======================= 5a. СРАВНЕНИЕ =======================
  const slots = [];
  function addCompare(date) {
    const s = L.state;
    const res = date ? A.analyze(s.point, date, s.missionDays, s.mast) : s.res;
    if (slots.length >= 3) slots.shift();
    slots.push({ name: L.siteName(), p: { ...s.point }, siteId: s.siteId, res });
    L.toast(t('cmp.added') + ' (' + slots.length + '/3)');
    if (s.tab === 'compare') renderCompare();
  }
  function renderCompare() {
    if (!slots.length) { $('cmpBox').innerHTML = `<p class="hint">${t('cmp.empty')}</p>`; return; }
    const rows = [
      ['cmp.verdict', (r) => r.verdict, (v) => `<span class="pill ${v}">${t('v.' + v + 'S')}</span>`, (v) => -rank[v]],
      ['ck.slope', (r) => r.terrain.covered ? r.terrain.slope : NaN, (v) => isNaN(v) ? '—' : v.toFixed(1) + '°', (v) => -v],
      ['ck.sun', (r) => r.mission.sunPct, (v) => f.fPct(v), (v) => v],
      ['ck.earth', (r) => r.mission.earthPct, (v) => f.fPct(v), (v) => v],
      ['q.sunset', (r) => r.hToSunset, (v) => v ? f.fSunset(v * HOUR) : '—', (v) => v],
      ['m.night', (r) => r.month.longestNightH, (v) => f.fDur(v * HOUR), (v) => -v],
      ['m.blackout', (r) => r.month.longestBlackoutH, (v) => f.fDur(v * HOUR), (v) => -v],
      ['p.elev', (r) => r.terrain.covered ? r.terrain.elev : NaN, (v) => isNaN(v) ? '—' : Math.round(v) + ' m', null],
    ];
    let h = '<div class="cmp-scroll"><table class="dtable cmp"><thead><tr><th></th>';
    slots.forEach((s, i) => { h += `<th><b>${s.name}</b><br><small class="mono">${f.fUTC(s.res.start)}</small><br><button class="btn small" data-open="${i}">${t('cmp.open')}</button> <button class="btn small" data-del="${i}">✕</button></th>`; });
    h += '</tr></thead><tbody>';
    rows.forEach(([k, get, fmt, better]) => {
      const vals = slots.map((s) => get(s.res));
      let best = null;
      if (better && slots.length > 1) { const sc = vals.map((v) => (isNaN(v) && typeof v === 'number') ? -Infinity : better(v)); const m = Math.max(...sc); if (sc.filter((x) => x === m).length < sc.length) best = sc.indexOf(m); }
      h += `<tr><td>${t(k)}</td>` + vals.map((v, i) => `<td class="${i === best ? 'best' : ''}">${fmt(v)}${i === best ? ' ★' : ''}</td>`).join('') + '</tr>';
    });
    h += '</tbody></table></div>';
    $('cmpBox').innerHTML = h;
    document.querySelectorAll('#cmpBox [data-open]').forEach((b) => { b.onclick = () => { const s = slots[+b.dataset.open]; L.selectPoint(s.p, s.siteId, true); L.setLanding(s.res.start); }; });
    document.querySelectorAll('#cmpBox [data-del]').forEach((b) => { b.onclick = () => { slots.splice(+b.dataset.del, 1); renderCompare(); }; });
  }
  $('btnCompare').addEventListener('click', () => addCompare(null));
  $('cmpClear').addEventListener('click', () => { slots.length = 0; renderCompare(); });
  L.registerTab('compare', renderCompare);

  // ======================= 6. ЛУНА И ЗЕМЛЯ =======================
  L.registerTab('learn', () => {});

  // ======================= CSV =======================
  $('btnCsv').addEventListener('click', () => {
    const r = L.state.res;
    const rows = [['time_utc', 'sun_el_deg', 'sun_az_deg', 'horizon_under_sun_deg', 'sunlit', 'earth_el_deg', 'earth_az_deg', 'earth_visible', 'solar_flux_wm2']];
    r.S.forEach((s) => rows.push([s.date.toISOString(), s.sun.el.toFixed(4), s.sun.az.toFixed(3), s.sun.horizon.toFixed(3), +s.sun.up, s.earth.el.toFixed(4), s.earth.az.toFixed(3), +s.earth.up, Math.round(s.powerWm2)]));
    const meta = `# Lunar Site Navigator — lat ${r.p.lat.toFixed(5)}, lon ${r.p.lon.toFixed(5)}, terrain ${r.terrain.source}, slope ${r.terrain.slope}\n`;
    const blob = new Blob([meta + rows.map((x) => x.join(',')).join('\n')], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `lunar_site_${r.p.lat.toFixed(3)}_${r.p.lon.toFixed(3)}.csv`; a.click();
  });

  // ======================= ПРЕЗЕНТАЦИЯ (автотур) =======================
  let touring = false;
  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
  function caption(key) { const c = $('tourCap'); c.textContent = t(key); c.classList.add('show'); }
  async function tour() {
    if (touring) { touring = false; return; }
    touring = true; $('btnTour').textContent = '■ ' + t('tour.stop');
    const steps = [
      async () => { caption('tour.1'); if (window.Globe) window.Globe.flyTo('space'); L.setTab('sky'); },
      async () => { caption('tour.2'); if (window.Globe) window.Globe.flyTo('pole'); },
      async () => { caption('tour.3'); const s = L.siteMeta('ridge'); L.selectPoint({ lat: s.lat, lon: s.lon }, 'ridge', true); },
      async () => { caption('tour.4'); L.play(); },
      async () => { L.stop(); caption('tour.5'); const s = L.siteMeta('haworth'); L.selectPoint({ lat: s.lat, lon: s.lon }, 'haworth', true); },
      async () => { caption('tour.6'); const s = L.siteMeta('ridge'); L.selectPoint({ lat: s.lat, lon: s.lon }, 'ridge', true); L.setTab('near'); },
      async () => { caption('tour.7'); L.setTab('dates'); },
      async () => { caption('tour.8'); if (window.View3D) window.View3D.open(); },
      async () => { caption('tour.9'); if (window.View3D) window.View3D.close(); L.setTab('sky'); },
    ];
    for (const st of steps) { if (!touring) break; await st(); await sleep(7500); }
    touring = false; L.stop(); $('tourCap').classList.remove('show'); $('btnTour').textContent = '▶ ' + t('tour.btn');
  }
  $('btnTour').addEventListener('click', tour);
  L.on((ev) => { if (ev === 'lang' && !touring) $('btnTour').textContent = '▶ ' + t('tour.btn'); if (ev === 'analysis') { sensCache = sensCache && sensCache.key.startsWith(keyOf()) ? sensCache : null; } });
  $('btnTour').textContent = '▶ ' + t('tour.btn');
})();
