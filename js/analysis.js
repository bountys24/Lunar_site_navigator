/*
 * analysis.js — полный анализ точки посадки:
 * рельеф (высота, уклон, маска горизонта) + Солнце/Земля + окна + вердикт «можно ли сесть».
 */
(function () {
  'use strict';
  const E = window.LunarEngine, T = window.Terrain;
  const HOUR = 3600e3;

  // пороги вердикта
  const RULES = {
    slope: { ok: 10, warn: 15 },          // градусы
    sun: { ok: 70, warn: 40 },            // % света за миссию
    earth: { ok: 50, warn: 20 },          // % видимости Земли за миссию
    sunset: { ok: 72, warn: 24 },         // часов до первого заката после посадки
    steep: { ok: 10, warn: 25 },          // % площади зоны посадки (≈240 м) круче 15° — кратеры, обрывы (карта LOLA 5 м)
  };

  function distKm(a, b) {
    const r = Math.PI / 180, c = Math.sin(a.lat * r) * Math.sin(b.lat * r) + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.cos((a.lon - b.lon) * r);
    return Math.acos(Math.min(1, c)) * 1737.4;
  }

  /** Рельеф точки: маска горизонта (точная 80 м, если есть рядом; иначе сетка 240 м), высота, уклон. */
  const terrCache = new Map();
  function terrain(lat, lon, obsH = 2) {
    const key = lat.toFixed(5) + ',' + lon.toFixed(5) + ',' + obsH;
    if (terrCache.has(key)) return terrCache.get(key);
    let res = { covered: false, mask: null, elev: null, slope: null, source: 'none' };
    if (T.ready && T.covers(lat, lon)) {
      const preset = obsH === 2 ? Object.values(T.preset).find((p) => distKm(p, { lat, lon }) < 0.3) : null;
      const hm = preset ? { mask: preset.horizon, h0: preset.elev_m } : T.horizonMask(lat, lon, obsH);
      res = { covered: true, mask: hm.mask, elev: hm.h0, slope: preset ? preset.slope_deg : T.slopeAt(lat, lon), source: preset ? 'LOLA 80 m' : T.source(lat, lon), regional: !T.polarCovers(lat, lon), hazard: T.hazardAt ? T.hazardAt(lat, lon) : null };
    }
    terrCache.set(key, res);
    if (terrCache.size > 60) terrCache.delete(terrCache.keys().next().value);
    return res;
  }

  /** Почасовые точки за период (для статистики, таймлайна, пути на небе). */
  function series(start, days, site, stepH = 1) {
    const out = [];
    const n = Math.round(days * 24 / stepH);
    for (let i = 0; i < n; i++) out.push(E.skyState(new Date(start.getTime() + i * stepH * HOUR), site));
    return out;
  }

  function stats(S, stepH = 1) {
    let su = 0, eu = 0, bu = 0, pw = 0;
    for (const s of S) { su += s.sun.up; eu += s.earth.up; bu += s.sun.up && s.earth.up; pw += s.powerWm2; }
    const n = S.length || 1;
    return {
      sunPct: 100 * su / n, earthPct: 100 * eu / n, bothPct: 100 * bu / n, avgPower: pw / n,
      longestNightH: E.longestRun(S, (x) => x.sun.up, false, stepH),
      longestBlackoutH: E.longestRun(S, (x) => x.earth.up, false, stepH),
      longestDayH: E.longestRun(S, (x) => x.sun.up, true, stepH),
    };
  }

  /** Следующая смена состояния (сначала по почасовым точкам, затем уточнение до минуты). */
  function nextEvent(date, S, start, site, pred) {
    const v0 = pred(E.skyState(date, site));
    const t0 = start.getTime();
    let i = Math.max(0, Math.floor((date - t0) / HOUR) + 1), prev = date.getTime();
    for (; i < S.length; i++) {
      const ms = t0 + i * HOUR;
      if (pred(S[i]) !== v0) return { date: E.refineChange(prev, ms, site, pred), from: v0 };
      prev = ms;
    }
    const ev = E.nextChange(new Date(prev), site, pred, 45);
    return ev ? { date: ev.date, from: v0 } : null;
  }

  /** Список окон (интервалов) из почасовых точек */
  function windows(S, start, pred) {
    const out = []; let s0 = null;
    S.forEach((s, i) => {
      const on = pred(s);
      if (on && s0 === null) s0 = i;
      if ((!on || i === S.length - 1) && s0 !== null) {
        const end = on ? i + 1 : i;
        out.push({ start: new Date(start.getTime() + s0 * HOUR), end: new Date(start.getTime() + end * HOUR), hours: end - s0 });
        s0 = null;
      }
    });
    return out;
  }

  const level = (v, r, higherBetter = true) => higherBetter
    ? (v >= r.ok ? 'ok' : v >= r.warn ? 'warn' : 'bad')
    : (v <= r.ok ? 'ok' : v <= r.warn ? 'warn' : 'bad');

  /**
   * Полный анализ.
   * p = { lat, lon }, landing = Date, missionDays = число
   */
  function analyze(p, landing, missionDays = 14, obsH = 2) {
    const ter = terrain(p.lat, p.lon, obsH);
    const site = { lat: p.lat, lon: p.lon, horizon: ter.mask, elevKm: ter.elev ? ter.elev / 1000 : 0 };
    const start = new Date(Math.floor(landing.getTime() / 60000) * 60000);
    const S = series(start, 30, site);                       // 30 дней с момента посадки
    const mission = stats(S.slice(0, Math.round(missionDays * 24)));
    const month = stats(S);
    const now = S[0];
    const sunEv = nextEvent(start, S, start, site, (x) => x.sun.above);   // закат = Солнце уходит за горизонт (затмение — отдельно)
    const earthEv = nextEvent(start, S, start, site, (x) => x.earth.up);
    const hToSunset = now.sun.above ? (sunEv ? (sunEv.date - start) / HOUR : Infinity) : 0;

    // проверки
    const checks = [];
    if (ter.covered) checks.push({ key: 'slope', value: ter.slope, level: level(ter.slope, RULES.slope, false) });
    else checks.push({ key: 'slope', value: null, level: 'na' });
    if (ter.hazard) {
      const hz = ter.hazard;
      checks.push({ key: 'craters', value: hz, level: level(hz.steepPct, RULES.steep, false) });
    }
    checks.push({ key: 'landLight', value: now.sun.up, level: now.sun.up ? 'ok' : 'bad' });
    checks.push({ key: 'sunset', value: hToSunset, level: now.sun.above ? level(hToSunset, RULES.sunset) : 'bad' });
    checks.push({ key: 'sun', value: mission.sunPct, level: level(mission.sunPct, RULES.sun) });
    checks.push({ key: 'earth', value: mission.earthPct, level: level(mission.earthPct, RULES.earth) });

    const rank = { ok: 0, na: 0, warn: 1, bad: 2 };
    const worst = checks.reduce((a, c) => (rank[c.level] > rank[a] ? c.level : a), 'ok');
    const psr = month.sunPct === 0;

    return {
      p, site, start, missionDays, obsH, terrain: ter, S, now,
      mission, month, sunEv, earthEv, hToSunset, checks, verdict: worst, psr,
      sunWindows: windows(S, start, (x) => x.sun.up),
      eclipses: windows(S, start, (x) => x.sun.above && x.sun.eclipse > 0.05),
      earthWindows: windows(S, start, (x) => x.earth.up),
    };
  }

  window.Analysis = { analyze, terrain, series, stats, RULES, distKm, nextEvent };
})();
