/*
 * engine.js — расчёт положения Солнца и Земли над горизонтом точки на Луне.
 *
 * Метод:
 *  1. Ориентация Луны — модель вращения IAU (RotationAxis в astronomy-engine:
 *     RA/Dec полюса + угол поворота W с периодическими членами либрации).
 *  2. Геоцентрические векторы Луны и Солнца (J2000/EQJ).
 *  3. Вектор от точки на поверхности → Солнце / Земля, перевод в локальную
 *     систему (восток / север / зенит) → азимут и возвышение.
 *  4. Горизонт: массив из 360 значений (маска рельефа, 1° по азимуту)
 *     или «плоский» 0°, если маски ещё нет.
 *
 * Работает и в браузере (глобальный Astronomy), и в Node (для тестов).
 */
(function (root) {
  'use strict';
  const A = (typeof module !== 'undefined' && module.exports)
    ? require('astronomy-engine')
    : root.Astronomy;

  const DEG = Math.PI / 180;
  const RAD = 180 / Math.PI;
  const R_MOON_KM = 1737.4;          // опорный радиус Луны (как у LOLA)
  const R_EARTH_KM = 6371.0;
  const R_SUN_KM = 695700;
  const AU_KM = 149597870.7;
  const SOLAR_CONST = 1361;          // Вт/м² на 1 а.е.

  // --- векторная математика ---
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const len = (a) => Math.hypot(a[0], a[1], a[2]);
  const norm = (a) => scale(a, 1 / len(a));
  const v3 = (v) => [v.x, v.y, v.z];

  /** Оси лунной системы координат (X — нулевой меридиан, Z — северный полюс) в EQJ. */
  function moonFrame(time) {
    const ax = A.RotationAxis(A.Body.Moon, time);
    const ra = ax.ra * 15 * DEG;     // RA приходит в часах
    const W = ax.spin * DEG;
    const Z = norm(v3(ax.north));
    const Q = [-Math.sin(ra), Math.cos(ra), 0];   // восходящий узел экватора Луны
    const P = cross(Z, Q);
    const X = add(scale(Q, Math.cos(W)), scale(P, Math.sin(W)));
    const Y = cross(Z, X);
    return { X, Y, Z };
  }

  /** Локальный базис точки (lat, lon в градусах, долгота восточная). */
  function localBasis(F, latDeg, lonDeg) {
    const la = latDeg * DEG, lo = lonDeg * DEG;
    const b = [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
    const up = norm(add(add(scale(F.X, b[0]), scale(F.Y, b[1])), scale(F.Z, b[2])));
    let east = cross(F.Z, up);
    if (len(east) < 1e-9) east = F.Y;    // ровно на полюсе
    east = norm(east);
    const north = cross(up, east);
    return { up, east, north };
  }

  function toHorizontal(vec, B) {
    const d = norm(vec);
    const el = Math.asin(Math.max(-1, Math.min(1, dot(d, B.up)))) * RAD;
    let az = Math.atan2(dot(d, B.east), dot(d, B.north)) * RAD;
    if (az < 0) az += 360;
    return { az, el };
  }

  /** Высота горизонта по азимуту: маска рельефа (360 значений) или 0°. */
  function horizonAt(site, az) {
    const m = site.horizon;
    if (!m || !m.length) return 0;
    const n = m.length, x = (az / 360) * n;
    const i = Math.floor(x) % n, j = (i + 1) % n, f = x - Math.floor(x);
    return m[i] * (1 - f) + m[j] * f;
  }

  /** Доля солнечного диска над горизонтом (0..1). */
  function diskFraction(elCenter, horizon, radiusDeg) {
    const x = (elCenter - horizon) / radiusDeg;
    if (x >= 1) return 1;
    if (x <= -1) return 0;
    return 1 - (Math.acos(x) - x * Math.sqrt(1 - x * x)) / Math.PI;
  }

  /** Какая доля солнечного диска закрыта диском Земли (затмение Солнца, видимое с Луны). */
  function eclipseCover(sep, rS, rE) {
    if (sep >= rS + rE) return 0;
    if (sep <= Math.abs(rE - rS)) return rE >= rS ? 1 : (rE * rE) / (rS * rS);
    const a = rS * rS * Math.acos((sep * sep + rS * rS - rE * rE) / (2 * sep * rS));
    const b = rE * rE * Math.acos((sep * sep + rE * rE - rS * rS) / (2 * sep * rE));
    const c = 0.5 * Math.sqrt((-sep + rS + rE) * (sep + rS - rE) * (sep - rS + rE) * (sep + rS + rE));
    return Math.min(1, (a + b - c) / (Math.PI * rS * rS));
  }

  /**
   * Главная функция: состояние неба для точки в момент времени.
   * site = { lat, lon, elevKm?, horizon? }
   */
  function skyState(date, site) {
    const t = A.MakeTime(date);
    const F = moonFrame(t);
    const B = localBasis(F, site.lat, site.lon);
    const rAU = (R_MOON_KM + (site.elevKm || 0)) / AU_KM;

    const moonGeo = v3(A.GeoMoon(t));
    const sunGeo = v3(A.GeoVector(A.Body.Sun, t, true));
    const siteGeo = add(moonGeo, scale(B.up, rAU));

    const sunVec = sub(sunGeo, siteGeo);
    const earthVec = scale(siteGeo, -1);
    const sunDistKm = len(sunVec) * AU_KM;
    const earthDistKm = len(earthVec) * AU_KM;

    const sun = toHorizontal(sunVec, B);
    const earth = toHorizontal(earthVec, B);
    sun.radius = Math.asin(R_SUN_KM / sunDistKm) * RAD;
    earth.radius = Math.asin(R_EARTH_KM / earthDistKm) * RAD;
    sun.horizon = horizonAt(site, sun.az);
    earth.horizon = horizonAt(site, earth.az);

    // затмение: Земля закрывает Солнце (угол между ними меньше суммы видимых радиусов)
    const cosSep = (sunVec[0] * earthVec[0] + sunVec[1] * earthVec[1] + sunVec[2] * earthVec[2]) / (len(sunVec) * len(earthVec));
    const sepDeg = Math.acos(Math.max(-1, Math.min(1, cosSep))) * RAD;
    const cover = eclipseCover(sepDeg, sun.radius, earth.radius);
    sun.eclipse = cover;                      // 0 — нет затмения, 1 — полное
    sun.fraction = diskFraction(sun.el, sun.horizon, sun.radius) * (1 - cover);
    earth.fraction = diskFraction(earth.el, earth.horizon, earth.radius);
    sun.above = sun.el > sun.horizon;        // центр диска над горизонтом
    sun.up = sun.above && cover < 0.5;       // светло: Солнце над горизонтом и не закрыто Землёй больше чем наполовину
    earth.up = earth.el > earth.horizon;     // центр Земли над горизонтом → прямая связь

    const flux = SOLAR_CONST * Math.pow(AU_KM / sunDistKm, 2);
    return {
      date: new Date(t.date.getTime()),
      sun, earth,
      sunDistKm, earthDistKm,
      powerWm2: flux * sun.fraction,  // поток на панель, следящую за Солнцем
    };
  }

  /** Поиск следующего момента, когда pred(state) меняет значение. Точность ~1 мин. */
  function nextChange(date, site, pred, maxDays = 60, stepH = 1) {
    const start = date.getTime();
    const v0 = pred(skyState(date, site));
    const stepMs = stepH * 3600e3;
    let a = start;
    for (let k = 1; k * stepH <= maxDays * 24; k++) {
      const b = start + k * stepMs;
      if (pred(skyState(new Date(b), site)) !== v0) {
        let lo = a, hi = b;
        while (hi - lo > 60e3) {
          const mid = (lo + hi) / 2;
          if (pred(skyState(new Date(mid), site)) === v0) lo = mid; else hi = mid;
        }
        return { date: new Date(hi), from: v0, to: !v0 };
      }
      a = b;
    }
    return null;  // за maxDays смены нет (полярный день / ночь)
  }

  /** Уточнение момента смены pred между t0 и t1 (мс) бисекцией до ~1 мин. */
  function refineChange(t0, t1, site, pred) {
    const v0 = pred(skyState(new Date(t0), site));
    let lo = t0, hi = t1;
    while (hi - lo > 60e3) {
      const mid = (lo + hi) / 2;
      if (pred(skyState(new Date(mid), site)) === v0) lo = mid; else hi = mid;
    }
    return new Date(hi);
  }

  /** Статистика за период: % света, % видимости Земли, средняя мощность. */
  function windowStats(date, site, days = 30, stepH = 1) {
    const n = Math.round(days * 24 / stepH);
    let sunH = 0, earthH = 0, both = 0, power = 0;
    const samples = [];
    for (let i = 0; i < n; i++) {
      const s = skyState(new Date(date.getTime() + i * stepH * 3600e3), site);
      if (s.sun.up) sunH++;
      if (s.earth.up) earthH++;
      if (s.sun.up && s.earth.up) both++;
      power += s.powerWm2;
      samples.push(s);
    }
    return {
      days,
      sunPct: (100 * sunH) / n,
      earthPct: (100 * earthH) / n,
      bothPct: (100 * both) / n,
      avgPowerWm2: power / n,
      samples,
    };
  }

  /**
   * Направления на Солнце и Землю из центра Луны в лунной системе координат
   * (X — нулевой меридиан, Z — северный полюс). Для 3D-сцены.
   */
  function bodyVectors(date) {
    const t = A.MakeTime(date);
    const F = moonFrame(t);
    const moon = v3(A.GeoMoon(t));
    const sun = sub(v3(A.GeoVector(A.Body.Sun, t, true)), moon);
    const earth = scale(moon, -1);
    const toBody = (v) => { const d = norm(v); return [dot(d, F.X), dot(d, F.Y), dot(d, F.Z)]; };
    return { sun: toBody(sun), earth: toBody(earth) };
  }

  /**
   * Ориентация Земли (северный полюс и направление на Гринвич) в лунной системе координат —
   * чтобы Земля на небе Луны показывала правильные континенты в нужный момент.
   */
  function earthAxes(date) {
    const t = A.MakeTime(date);
    const F = moonFrame(t);
    const gst = A.SiderealTime(t) * 15 * DEG;
    const rot = A.Rotation_EQD_EQJ(t);
    const n = A.RotateVector(rot, new A.Vector(0, 0, 1, t));
    const g = A.RotateVector(rot, new A.Vector(Math.cos(gst), Math.sin(gst), 0, t));
    const toBody = (v) => { const d = norm(v3(v)); return [dot(d, F.X), dot(d, F.Y), dot(d, F.Z)]; };
    return { north: toBody(n), prime: toBody(g) };
  }

  /** Оси лунной системы координат в J2000 (для ориентации звёздного неба) */
  function moonAxesEQJ(date) { return moonFrame(A.MakeTime(date)); }

  /** Самая длинная непрерывная серия pred(sample) === value, в часах. */
  function longestRun(samples, pred, value, stepH) {
    let best = 0, cur = 0;
    for (const s of samples) {
      if (pred(s) === value) { cur++; if (cur > best) best = cur; } else cur = 0;
    }
    return best * stepH;
  }

  /** Подспутниковая точка Земли (для проверки против Libration). */
  function subEarthPoint(date) {
    const t = A.MakeTime(date);
    const F = moonFrame(t);
    const d = norm(scale(v3(A.GeoMoon(t)), -1));
    return {
      lat: Math.asin(dot(d, F.Z)) * RAD,
      lon: Math.atan2(dot(d, F.Y), dot(d, F.X)) * RAD,
    };
  }

  const api = { moonAxesEQJ, skyState, nextChange, refineChange, windowStats, bodyVectors, longestRun, earthAxes, subEarthPoint, horizonAt, R_MOON_KM };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LunarEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
