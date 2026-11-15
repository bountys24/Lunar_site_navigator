/*
 * terrain.js — рельеф южного полюса (NASA LRO LOLA) в браузере.
 * Данные: data/pole_data.js → window.POLE_DATA = { meta, dem_b64, slope_b64, horizons }
 *   dem   — высоты (int16, метры над сферой 1737.4 км), 240 м/пиксель
 *   slope — худший уклон в пикселе (uint8, градусы) по карте 80 м/пиксель
 * Позволяет для ЛЮБОЙ точки: высота, уклон, маска горизонта (360°).
 */
(function () {
  'use strict';
  const R = 1737400;
  const D = window.POLE_DATA;
  const T = { ready: false };
  window.Terrain = T;
  if (!D) { console.warn('POLE_DATA not loaded'); return; }

  const b64 = (s) => { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
  const M = D.meta;
  const W = M.width, H = M.height;
  const dem = new Int16Array(b64(D.dem_b64).buffer);
  const slope = b64(D.slope_b64);
  const ND = M.nodata_dem;

  /** lat/lon (градусы) → пиксель (дробный) */
  function toPixel(lat, lon) {
    const la = lat * Math.PI / 180, lo = lon * Math.PI / 180;
    const r = 2 * R * Math.tan(Math.PI / 4 + la / 2);
    return [M.line0 + M.sy * r * Math.cos(lo) / M.scale_m, M.sample0 + M.sx * r * Math.sin(lo) / M.scale_m];
  }
  /** пиксель → lat/lon */
  function toLatLon(line, sample) {
    const x = (sample - M.sample0) * M.scale_m * M.sx;
    const y = (line - M.line0) * M.scale_m * M.sy;
    const r = Math.hypot(x, y);
    let lon = Math.atan2(x, y) * 180 / Math.PI;
    if (lon < 0) lon += 360;
    return [(2 * Math.atan(r / (2 * R)) - Math.PI / 2) * 180 / Math.PI, lon];
  }

  function heightPx(L, S) {
    const l = Math.floor(L), s = Math.floor(S);
    if (l < 0 || s < 0 || l >= H - 1 || s >= W - 1) return NaN;
    const i = l * W + s;
    const a = dem[i], b = dem[i + 1], c = dem[i + W], d = dem[i + W + 1];
    if (a === ND || b === ND || c === ND || d === ND) return NaN;
    const fl = L - l, fs = S - s;
    return a * (1 - fl) * (1 - fs) + b * (1 - fl) * fs + c * fl * (1 - fs) + d * fl * fs;
  }
  const heightPolar = (lat, lon) => { const p = toPixel(lat, lon); return heightPx(p[0], p[1]); };

  // --- рельеф всей Луны (NASA LOLA LDEM_16 → 8 px/град ≈ 3,8 км), для точек вне карты полюса ---
  const G = window.MOON_DEM;
  let gdem = null, GW = 0, GH = 0, GPPD = 8;
  if (G && G.b64) { gdem = new Int16Array(b64(G.b64).buffer); GW = G.meta.width; GH = G.meta.height; GPPD = G.meta.ppd; }
  function heightGlobal(lat, lon) {
    if (!gdem) return NaN;
    let x = ((((lon + 180) % 360) + 360) % 360) * GPPD - 0.5, y = (90 - lat) * GPPD - 0.5;
    y = Math.max(0, Math.min(GH - 1.001, y));
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    const xa = ((x0 % GW) + GW) % GW, xb = (xa + 1) % GW, row = y0 * GW, row2 = row + GW;
    return gdem[row + xa] * (1 - fx) * (1 - fy) + gdem[row + xb] * fx * (1 - fy) + gdem[row2 + xa] * (1 - fx) * fy + gdem[row2 + xb] * fx * fy;
  }
  // --- подробные данные (Colab, часть 2): горизонт 80 м для центра полюса + карта опасностей по LOLA 5 м ---
  const DT = window.DETAIL;
  function mkGrid(meta, arr) {
    const W2 = meta.width, H2 = meta.height;
    const px = (lat, lon) => { const la = lat * Math.PI / 180, lo = lon * Math.PI / 180; const r = 2 * R * Math.tan(Math.PI / 4 + la / 2);
      return [meta.line0 + meta.sy * r * Math.cos(lo) / meta.scale_m, meta.sample0 + meta.sx * r * Math.sin(lo) / meta.scale_m]; };
    return { meta, W2, H2, arr, px };
  }
  const core = DT && DT.core_b64 ? mkGrid(DT.meta.core, new Int16Array(b64(DT.core_b64).buffer)) : null;
  const hazS = DT && DT.hs_b64 ? mkGrid(DT.meta.hazard, b64(DT.hs_b64)) : null;
  const hazP = DT && DT.hp_b64 ? mkGrid(DT.meta.hazard, b64(DT.hp_b64)) : null;
  function heightCore(lat, lon) {
    if (!core) return NaN;
    const [L, S] = core.px(lat, lon), l = Math.floor(L), s = Math.floor(S), Wc = core.W2;
    if (l < 0 || s < 0 || l >= core.H2 - 1 || s >= Wc - 1) return NaN;
    const i = l * Wc + s, a = core.arr[i], b = core.arr[i + 1], c = core.arr[i + Wc], d = core.arr[i + Wc + 1];
    if (a === -32768 || b === -32768 || c === -32768 || d === -32768) return NaN;
    const fl = L - l, fs = S - s;
    return a * (1 - fl) * (1 - fs) + b * (1 - fl) * fs + c * fl * (1 - fs) + d * fl * fs;
  }
  /** Опасности в точке: самый крутой склон по карте 5 м и % площади круче 15° (в квадрате 80 м) */
  function hazardAt(lat, lon) {
    if (!hazS) return null;
    const [L, S] = hazS.px(lat, lon), l = Math.round(L), s = Math.round(S);
    if (l < 0 || s < 0 || l >= hazS.H2 || s >= hazS.W2) return null;
    // зона посадки ≈ 240 × 240 м (3×3 квадрата по 80 м): средняя доля опасной площади, самый крутой склон
    let ms = -1, sum = 0, n = 0;
    for (let dl = -1; dl <= 1; dl++) for (let ds = -1; ds <= 1; ds++) {
      const ll = l + dl, ss = s + ds; if (ll < 0 || ss < 0 || ll >= hazS.H2 || ss >= hazS.W2) continue;
      const k = ll * hazS.W2 + ss, a = hazS.arr[k], b = hazP.arr[k];
      if (a !== 255) { ms = Math.max(ms, a); sum += b; n++; }
    }
    return ms < 0 ? null : { maxSlope: ms, steepPct: Math.round(sum / n) };
  }
  /** Доля площади круче 15° в одном квадрате 80 м (для подсветки опасностей в 3D) */
  function hazardCell(lat, lon) {
    if (!hazP) return NaN;
    const [L, S] = hazP.px(lat, lon), l = Math.floor(L), s = Math.floor(S);
    if (l < 0 || s < 0 || l >= hazP.H2 - 1 || s >= hazP.W2 - 1) return NaN;
    // плавная (билинейная) интерполяция между квадратами 80 м
    const fl = L - l, fs = S - s; let v = 0, w = 0;
    [[0, 0, (1 - fl) * (1 - fs)], [0, 1, (1 - fl) * fs], [1, 0, fl * (1 - fs)], [1, 1, fl * fs]].forEach(([a, b, q]) => {
      const k = (l + a) * hazP.W2 + s + b; if (hazS.arr[k] !== 255) { v += hazP.arr[k] * q; w += q; }
    });
    return w > 0 ? v / w : NaN;
  }
  const coreCovers = (lat, lon) => !Number.isNaN(heightCore(lat, lon));
  const polarCovers = (lat, lon) => !Number.isNaN(heightPolar(lat, lon));
  const height = (lat, lon) => {
    let h = heightCore(lat, lon); if (!Number.isNaN(h)) return h;
    h = heightPolar(lat, lon); return Number.isNaN(h) ? heightGlobal(lat, lon) : h;
  };
  const GSTEP = 1737400 * Math.PI / 180 / 8;      // ≈ 3.8 км

  function slopeAt(lat, lon) {
    if (!polarCovers(lat, lon)) {                  // региональный уклон по глобальной карте (≈ 3,8 км)
      if (!gdem) return NaN;
      const dl = 1 / GPPD, cl = Math.max(0.02, Math.cos(lat * Math.PI / 180));
      const gy = (heightGlobal(lat + dl, lon) - heightGlobal(lat - dl, lon)) / (2 * GSTEP);
      const gx = (heightGlobal(lat, lon + dl / cl) - heightGlobal(lat, lon - dl / cl)) / (2 * GSTEP);
      return Math.round(Math.atan(Math.hypot(gx, gy)) * 180 / Math.PI);
    }
    const [L, S] = toPixel(lat, lon);
    const l = Math.round(L), s = Math.round(S);
    if (l < 0 || s < 0 || l >= H || s >= W) return NaN;
    const v = slope[l * W + s];
    return v === M.nodata_slope ? NaN : v;
  }

  /**
   * Маска горизонта: высота гор (°) по 360 азимутам, с кривизной Луны.
   * obsH — высота наблюдателя над поверхностью (м).
   */
  function horizonMask(lat0, lon0, obsH = 2, nAz = 360, nD = 420, dMax = 300e3) {
    const h0 = height(lat0, lon0);
    if (Number.isNaN(h0)) return null;
    const la = lat0 * Math.PI / 180, lo = lon0 * Math.PI / 180;
    const u0 = [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
    const east = [-Math.sin(lo), Math.cos(lo), 0];
    const north = [u0[1] * east[2] - u0[2] * east[1], u0[2] * east[0] - u0[0] * east[2], u0[0] * east[1] - u0[1] * east[0]];
    const r0 = R + h0 + obsH;
    const dMin = coreCovers(lat0, lon0) ? 2 * core.meta.scale_m : polarCovers(lat0, lon0) ? 2 * M.scale_m : 2 * GSTEP;
    const ths = new Float64Array(nD), cth = new Float64Array(nD), sth = new Float64Array(nD);
    for (let k = 0; k < nD; k++) { ths[k] = dMin * Math.pow(dMax / dMin, k / (nD - 1)) / R; cth[k] = Math.cos(ths[k]); sth[k] = Math.sin(ths[k]); }
    const out = new Float32Array(nAz);
    const RAD = 180 / Math.PI;
    for (let a = 0; a < nAz; a++) {
      const az = (a * 2 * Math.PI) / nAz, ca = Math.cos(az), sa = Math.sin(az);
      const t = [ca * north[0] + sa * east[0], ca * north[1] + sa * east[1], ca * north[2] + sa * east[2]];
      let best = -90;
      for (let k = 0; k < nD; k++) {
        const ux = cth[k] * u0[0] + sth[k] * t[0], uy = cth[k] * u0[1] + sth[k] * t[1], uz = cth[k] * u0[2] + sth[k] * t[2];
        const lat = Math.asin(uz) * RAD, lon = Math.atan2(uy, ux) * RAD;
        const h = height(lat, lon);
        if (Number.isNaN(h)) continue;
        const rr = R + h;
        // вектор от наблюдателя к точке рельефа
        const dx = ux * rr - u0[0] * r0, dy = uy * rr - u0[1] * r0, dz = uz * rr - u0[2] * r0;
        const el = Math.asin((dx * u0[0] + dy * u0[1] + dz * u0[2]) / Math.hypot(dx, dy, dz)) * RAD;
        if (el > best) best = el;
      }
      out[a] = best;
    }
    return { mask: Array.from(out), h0 };
  }

  /** Есть ли рельеф в точке (полюс — подробно, остальная Луна — по глобальной карте) */
  const covers = (lat, lon) => !Number.isNaN(height(lat, lon));
  const source = (lat, lon) => coreCovers(lat, lon) ? 'LOLA 80 m' : polarCovers(lat, lon) ? 'LOLA 240 m' : (gdem ? 'LOLA 3.8 km' : 'none');

  Object.assign(T, {
    ready: true, meta: M, width: W, height: H,
    toPixel, toLatLon, coreCovers, heightAt: height, slopeAt, horizonMask, covers, polarCovers, source, heightGlobal, hazardAt, hazardCell, hasHazard: !!hazS,
    preset: D.horizons || {},           // точные маски (80 м) для известных мест
    heightPx,
  });
})();
