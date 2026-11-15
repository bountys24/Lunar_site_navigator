/*
 * view3d.js — 3D-вид с выбранной точки посадки (стиль «посадочный HUD»).
 *
 * Рельеф: одна радиальная сетка до 12 км вокруг точки. Высоты — NASA LOLA
 *   (80 м у полюса, 240 м полярная сетка, 3,8 км по всей Луне), реальная кривизна Луны.
 * Мелкий рельеф < 80 м (кратеры 1,5–60 м, камни, текстура реголита) — статистическая
 *   модель по распределению кратеров на снимках LRO: детали, которых нет в данных LOLA.
 *   На расчёты (вердикт, горизонт, Солнце, связь) она НЕ влияет.
 * Солнце и Земля — реальные направления и угловые размеры. Свет — только от Солнца:
 *   при низком Солнце у полюса тени длинные и чёрные, как на настоящих снимках.
 * Посадка: камера снижается с 1200 м к точке, сверху — опасные склоны по карте LOLA 5 м.
 */
window.View3D = (function () {
  'use strict';
  const TH = window.THREE, T = window.Terrain, E = window.LunarEngine;
  const R = 1737400, NEAR_M = 12000, FAR_R = 60000, SKY_R = 90000, EYE = 1.8;
  const MICRO_R = 700;                 // радиус, где добавляется мелкий рельеф
  const SEG = 480;                     // сегментов по кругу
  let skyMesh, renderer, scene, camera, root, sunLight, sunMesh, earthMesh, terrainMesh, farMesh, labels = [];
  let hazardMesh = null, ellipse = null, colBase = null, colHaz = null;
  let opened = false, cur = null, look = { yaw: 0, pitch: -0.06, fov: 62 };
  let descent = null;                  // анимация посадки
  let heightLocal = null;
  let tlDate = null, tl = null;          // таймлапс «месяц за 15 секунд»              // (восток, север) → локальная высота, м
  const $ = (id) => document.getElementById(id);
  const L = () => window.LSN;
  const ru = () => L().state.lang === 'ru';

  // локальная система: x = восток, y = вверх, z = −север
  const enu = (az, el, d) => {
    const a = az * Math.PI / 180, e = el * Math.PI / 180;
    return new TH.Vector3(d * Math.cos(e) * Math.sin(a), d * Math.sin(e), -d * Math.cos(e) * Math.cos(a));
  };
  function rng(seed) { let s = (seed >>> 0) || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

  // ------------------------------------------------------------------
  //  Текстура реголита (бесшовная): цвет + карта нормалей с мелкими кратерами
  // ------------------------------------------------------------------
  function regolithTextures() {
    // мелкое «зерно» реголита: шум по многим октавам, без повторяющихся кратеров
    const N = 1024, h = new Float32Array(N * N), r = rng(77);
    function octave(cells, amp) {
      const g = new Float32Array(cells * cells); for (let i = 0; i < g.length; i++) g[i] = r() * 2 - 1;
      const at = (x, y) => g[((y % cells + cells) % cells) * cells + ((x % cells + cells) % cells)];
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const fx = x / N * cells, fy = y / N * cells, ix = Math.floor(fx), iy = Math.floor(fy);
        let tx = fx - ix, ty = fy - iy; tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
        h[y * N + x] += amp * (at(ix, iy) * (1 - tx) * (1 - ty) + at(ix + 1, iy) * tx * (1 - ty) + at(ix, iy + 1) * (1 - tx) * ty + at(ix + 1, iy + 1) * tx * ty);
      }
    }
    octave(4, 0.6); octave(8, 0.35); octave(16, 0.22); octave(32, 0.14); octave(64, 0.09); octave(128, 0.07); octave(256, 0.05); octave(512, 0.035);
    // редкие крошечные ямки и комочки
    for (let k = 0; k < 40; k++) {
      const rad = 4 + r() * 14, cx = r() * N, cy = r() * N, dep = rad * 0.02 * (r() < 0.5 ? 1 : -0.6);
      for (let dy = -rad * 1.6; dy <= rad * 1.6; dy++) for (let dx = -rad * 1.6; dx <= rad * 1.6; dx++) {
        const d = Math.hypot(dx, dy) / rad; if (d > 1.6) continue;
        const x = ((Math.round(cx + dx) % N) + N) % N, y = ((Math.round(cy + dy) % N) + N) % N;
        h[y * N + x] += d < 1 ? -dep * (1 - d * d) : dep * 0.15 * Math.exp(-(((d - 1) / 0.3) ** 2));
      }
    }
    const cc = document.createElement('canvas'); cc.width = cc.height = N; const cg = cc.getContext('2d'); const ci = cg.createImageData(N, N);
    const nc = document.createElement('canvas'); nc.width = nc.height = N; const ng = nc.getContext('2d'); const ni = ng.createImageData(N, N);
    const H = (x, y) => h[((y + N) % N) * N + ((x + N) % N)];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * 3.0, dy = (H(x, y + 1) - H(x, y - 1)) * 3.0;
      const l = Math.hypot(dx, dy, 1), k = (y * N + x) * 4;
      ni.data[k] = (-dx / l * 0.5 + 0.5) * 255; ni.data[k + 1] = (dy / l * 0.5 + 0.5) * 255; ni.data[k + 2] = (1 / l * 0.5 + 0.5) * 255; ni.data[k + 3] = 255;
      const g = 196 + H(x, y) * 26 + (r() - 0.5) * 22;     // мелкая «соль-перец» зернистость
      ci.data[k] = g; ci.data[k + 1] = g * 0.98; ci.data[k + 2] = g * 0.95; ci.data[k + 3] = 255;
    }
    cg.putImageData(ci, 0, 0); ng.putImageData(ni, 0, 0);
    const mk = (c, srgb) => { const t = new TH.CanvasTexture(c); t.wrapS = t.wrapT = TH.RepeatWrapping; t.anisotropy = 16; if (srgb) t.colorSpace = TH.SRGBColorSpace; return t; };
    return { map: mk(cc, true), normal: mk(nc, false) };
  }

  // плавный шум (для крупных волн рельефа и пятен яркости) — без регулярного узора
  function noise2(seed) {
    const hash = (x, y) => { let n = (x * 374761393 + y * 668265263 + seed * 1442695041) | 0; n = (n ^ (n >>> 13)) * 1274126177 | 0; return ((n ^ (n >>> 16)) >>> 0) / 4294967296 * 2 - 1; };
    const v = (x, y) => { const ix = Math.floor(x), iy = Math.floor(y); let tx = x - ix, ty = y - iy; tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
      return hash(ix, iy) * (1 - tx) * (1 - ty) + hash(ix + 1, iy) * tx * (1 - ty) + hash(ix, iy + 1) * (1 - tx) * ty + hash(ix + 1, iy + 1) * tx * ty; };
    return (x, y) => v(x, y) * 0.55 + v(x * 2.03 + 17, y * 2.03 - 9) * 0.27 + v(x * 4.1 - 31, y * 4.1 + 5) * 0.13 + v(x * 8.3 + 3, y * 8.3 + 41) * 0.05;
  }

  // материал реголита: текстура в двух масштабах (убирает повторяющийся «узор полотенца»)
  function regolithMaterial(tx) {
    const mat = new TH.MeshStandardMaterial({ vertexColors: true, map: tx.map, normalMap: tx.normal, roughness: 1, metalness: 0 });
    mat.normalScale.set(0.55, 0.55);
    mat.onBeforeCompile = (sh) => {
      const B = 'mat2(0.8,-0.6,0.6,0.8)';
      sh.fragmentShader = sh.fragmentShader
        .replace('vec4 sampledDiffuseColor = texture2D( map, vMapUv );',
          `vec4 sampledDiffuseColor = texture2D( map, vMapUv ) * texture2D( map, ${B} * vMapUv * 0.173 + 0.31 ) * 1.25;`)
        .replace(/texture2D\( normalMap, vNormalMapUv \)\.xyz \* 2\.0 - 1\.0;/,
          `normalize( (texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0) + (texture2D( normalMap, ${B} * vNormalMapUv * 0.173 + 0.31 ).xyz * 2.0 - 1.0) * vec3(1.6, 1.6, 1.0) );`);
    };
    return mat;
  }

  // ------------------------------------------------------------------
  //  Мелкие кратеры 1,5–60 м: детерминированный список по координатам точки
  // ------------------------------------------------------------------
  function microCraters(seed, heroes) {
    const r = rng(seed), list = (heroes || []).slice();
    const area = Math.PI * MICRO_R * MICRO_R;
    // N(>D) ≈ 0.012·D^-1.9 на м² (равновесная плотность малых кратеров на лунных морях/равнинах)
    const Dmin = 1.5, Dmax = 60, n = Math.round(0.012 * Math.pow(Dmin, -1.9) * area * 0.3);
    for (let i = 0; i < n; i++) {
      const D = Dmin * Math.pow(1 - r() * (1 - Math.pow(Dmin / Dmax, 1.9)), -1 / 1.9);
      const rr = Math.sqrt(r()) * MICRO_R, a = r() * Math.PI * 2;
      const age = Math.pow(r(), 0.6);                       // 0 — свежий, 1 — сглаженный (старых больше)
      list.push({ e: rr * Math.sin(a), n: rr * Math.cos(a), R: D / 2, d: D * (0.22 - 0.16 * age), rim: D * 0.05 * (1 - 0.85 * age), fresh: age < 0.2 });
    }
    // пространственный индекс (ячейки 20 м)
    const C = 20, grid = new Map();
    list.forEach((c, i) => {
      const ext = c.R * 2;
      for (let gx = Math.floor((c.e - ext) / C); gx <= Math.floor((c.e + ext) / C); gx++)
        for (let gy = Math.floor((c.n - ext) / C); gy <= Math.floor((c.n + ext) / C); gy++) {
          const k = gx + ',' + gy; if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i);
        }
    });
    // высота и «свежесть» (светлые выбросы вокруг молодых кратеров)
    return function (e, nn) {
      const cell = grid.get(Math.floor(e / C) + ',' + Math.floor(nn / C)); if (!cell) return [0, 0];
      let hgt = 0, bright = 0;
      for (const i of cell) {
        const c = list[i], d = Math.hypot(e - c.e, nn - c.n) / c.R; if (d > 2) continue;
        hgt += d < 1 ? -c.d + (c.d + c.rim) * d * d : c.rim * Math.exp(-(((d - 1) / 0.45) ** 2));
        if (c.fresh && d < 1.8) bright = Math.max(bright, 1 - Math.abs(d - 1) / 0.8);
      }
      return [hgt, bright];
    };
  }

  function init() {
    renderer = new TH.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = TH.PCFSoftShadowMap;
    renderer.toneMapping = TH.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
    $('v3dCanvas').appendChild(renderer.domElement);
    scene = new TH.Scene(); scene.background = new TH.Color(0x000000);
    camera = new TH.PerspectiveCamera(look.fov, 1, 0.25, SKY_R * 2);
    camera.rotation.order = 'YXZ';

    const pts = [];
    for (let i = 0; i < 4000; i++) { const v = new TH.Vector3().randomDirection().multiplyScalar(SKY_R * 0.98); pts.push(v.x, v.y, v.z); }
    const sg = new TH.BufferGeometry(); sg.setAttribute('position', new TH.Float32BufferAttribute(pts, 3));
    scene.add(new TH.Points(sg, new TH.PointsMaterial({ color: 0xffffff, size: 1.2, sizeAttenuation: false, transparent: true, opacity: 0.6, toneMapped: false })));
    skyMesh = window.Bodies.makeSky(SKY_R * 0.95); scene.add(skyMesh);

    // свет: Солнце (тени в радиусе ~1,4 км вокруг взгляда — видно кратеры и камни)
    sunLight = new TH.DirectionalLight(0xfff6ea, 6.0);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.set(4096, 4096);
    const sc = sunLight.shadow.camera; const half = 1400;
    sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half; sc.near = 5000; sc.far = 35000;
    sunLight.shadow.bias = -0.0002; sunLight.shadow.normalBias = 0.35;
    scene.add(sunLight); scene.add(sunLight.target);
    scene.add(new TH.AmbientLight(0xb4b6bc, 0.09));         // рассеянный свет (Земля, отражение от склонов)
    scene.add(new TH.HemisphereLight(0xb8bac0, 0x303034, 0.16));

    sunMesh = window.Bodies.makeSun(SKY_R * 0.82 * Math.tan(0.2666 * Math.PI / 180), 12);
    sunMesh.traverse((o) => { if (o.material) o.material.toneMapped = false; });
    scene.add(sunMesh);
    earthMesh = window.Bodies.makeEarth(1);
    earthMesh.traverse((o) => { if (o.material) o.material.toneMapped = false; });
    scene.add(earthMesh);
    skyMesh.traverse((o) => { if (o.material) o.material.toneMapped = false; });

    root = new TH.Group(); scene.add(root);
    window.__v3dTex = window.__v3dTex || regolithTextures();

    let drag = null;
    const el = renderer.domElement;
    el.addEventListener('pointerdown', (e) => { if (descent) skipDescent(); drag = { x: e.clientX, y: e.clientY, yaw: look.yaw, pitch: look.pitch }; el.setPointerCapture(e.pointerId); });
    el.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const k = look.fov / el.clientHeight * Math.PI / 180;
      look.yaw = drag.yaw + (e.clientX - drag.x) * k;
      look.pitch = Math.max(-1.45, Math.min(1.4, drag.pitch + (e.clientY - drag.y) * k));
      draw();
    });
    el.addEventListener('pointerup', () => { drag = null; });
    el.addEventListener('wheel', (e) => { e.preventDefault(); look.fov = Math.max(4, Math.min(90, look.fov * (e.deltaY > 0 ? 1.12 : 0.89))); draw(); }, { passive: false });
    new ResizeObserver(resize).observe($('v3dCanvas'));

    $('v3dClose').addEventListener('click', close);
    $('v3dSun').addEventListener('click', () => lookAt('sun'));
    $('v3dEarth').addEventListener('click', () => lookAt('earth'));
    $('v3dLand') && $('v3dLand').addEventListener('click', startDescent);
    $('v3dTl') && $('v3dTl').addEventListener('click', timelapse);
    document.querySelectorAll('[data-v3step]').forEach((b) => b.addEventListener('click', () => {
      const s = L().state; L().setView(new Date(s.view.getTime() + Number(b.dataset.v3step) * 60e3));
    }));
    $('v3dPlay').addEventListener('click', () => document.getElementById('play').click());
    document.addEventListener('keydown', (e) => { if (opened && e.key === 'Escape') close(); });
    L().on((ev) => { if (!opened) return; if (ev === 'analysis') { build(); } if (ev === 'view' || ev === 'analysis') update(); if (ev === 'lang') { hud(); hudStatic(); } });
  }

  function resize() {
    if (!renderer) return;
    const w = $('v3dCanvas').clientWidth, h = $('v3dCanvas').clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); draw();
  }

  /** Построить рельеф вокруг точки */
  function build() {
    const r = L().state.res; cur = r;
    root.clear(); labels.forEach((l) => l.remove()); labels = [];
    const p = r.p;
    const la = p.lat * Math.PI / 180, lo = p.lon * Math.PI / 180;
    const u0 = new TH.Vector3(Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la));
    const east = new TH.Vector3(-Math.sin(lo), Math.cos(lo), 0);
    const north = new TH.Vector3().crossVectors(u0, east);
    let h0 = T.heightAt(p.lat, p.lon); if (Number.isNaN(h0)) h0 = 0;
    const O = u0.clone().multiplyScalar(R + h0);
    const wave = noise2(11), patch = noise2(23);
    // пара заметных свежих кратеров в поле зрения (часть той же статистической модели)
    const saz = E.skyState(L().state.view, r.site).sun.az * Math.PI / 180;
    const hero = (da, dist, D) => ({ e: dist * Math.sin(saz + da), n: dist * Math.cos(saz + da), R: D / 2, d: D * 0.21, rim: D * 0.06, fresh: true });
    const micro = microCraters(Math.round((p.lat + 91) * 1000) * 7919 + Math.round((p.lon + 361) * 1000));
    const Q = new TH.Vector3(), D = new TH.Vector3();

    // точка на сфере по смещению (восток, север) в метрах — без вырождения у полюса
    function sample(de, dn, withMicro) {
      D.copy(u0).addScaledVector(east, de / R).addScaledVector(north, dn / R).normalize();
      const lat = Math.asin(D.z) * 180 / Math.PI, lon = Math.atan2(D.y, D.x) * 180 / Math.PI;
      let h = T.heightAt(lat, lon); if (Number.isNaN(h)) h = h0;
      let br = 0;
      if (withMicro) {
        const rr = Math.hypot(de, dn);
        if (rr < MICRO_R) {
          const fade = rr < MICRO_R * 0.8 ? 1 : (MICRO_R - rr) / (MICRO_R * 0.2);
          const [mh, b] = micro(de, dn); h += mh * fade; br = b * fade;
          h += fade * (0.9 * wave(de / 55, dn / 55) + 0.25 * wave(de / 11 + 50, dn / 11 - 20));   // мягкие волны грунта
        }
      }
      Q.copy(D).multiplyScalar(R + h).sub(O);
      return { x: Q.dot(east), y: Q.dot(u0), z: -Q.dot(north), lat, lon, br };
    }
    heightLocal = (de, dn) => sample(de, dn, true).y;

    // --- радиальная сетка: густая под ногами, редкая у горизонта ---
    const rings = [0]; for (let rr = 0.3; rr < NEAR_M; rr *= 1.042) rings.push(rr); rings.push(NEAR_M);
    const NR = rings.length, nv = 1 + (NR - 1) * SEG;
    const pos = new Float32Array(nv * 3), col = new Float32Array(nv * 3), haz = new Float32Array(nv * 3), uv = new Float32Array(nv * 2);
    const polar = T.polarCovers(p.lat, p.lon);
    const rs = rng(4242);
    let k = 0;
    const put = (s, de, dn) => {
      pos[k * 3] = s.x; pos[k * 3 + 1] = s.y; pos[k * 3 + 2] = s.z;
      uv[k * 2] = de / 3.5; uv[k * 2 + 1] = dn / 3.5;             // зерно реголита
      const g = 0.6 + 0.07 * patch(de / 140, dn / 140) + 0.03 * (rs() - 0.5) + 0.22 * s.br;   // пятна яркости + светлые выбросы у молодых кратеров
      col[k * 3] = g; col[k * 3 + 1] = g * 0.99; col[k * 3 + 2] = g * 0.97;
      // опасности (карта LOLA 5 м): красный > 25 % площади круче 15°, жёлтый > 10 %
      let hc = 0, hy = 0;
      const rr = Math.hypot(de, dn);
      if (rr < 2600) {
        let pct = T.hazardCell ? T.hazardCell(s.lat, s.lon) : NaN;
        if (Number.isNaN(pct) && polar) { const sl = T.slopeAt(s.lat, s.lon) || 0; pct = sl > 15 ? 40 : sl > 10 ? 15 : 0; }
        if (pct > 25) hc = 1; else if (pct > 10) hy = 1;
      }
      haz[k * 3] = g * (1 - 0.55 * (hc + hy)) + hc * 0.75 + hy * 0.75;
      haz[k * 3 + 1] = g * (1 - 0.55 * (hc + hy)) + hc * 0.12 + hy * 0.6;
      haz[k * 3 + 2] = g * (1 - 0.55 * (hc + hy)) + hc * 0.1 + hy * 0.1;
      k++;
    };
    put(sample(0, 0, true), 0, 0);
    for (let i = 1; i < NR; i++) {
      const rr = rings[i];
      for (let j = 0; j < SEG; j++) {
        const a = (j / SEG) * Math.PI * 2, de = rr * Math.sin(a), dn = rr * Math.cos(a);
        put(sample(de, dn, rr < MICRO_R), de, dn);
      }
    }
    const idx = new Uint32Array(SEG * 3 + (NR - 2) * SEG * 6); let q = 0;
    for (let j = 0; j < SEG; j++) { idx[q++] = 0; idx[q++] = 1 + ((j + 1) % SEG); idx[q++] = 1 + j; }
    for (let i = 1; i < NR - 1; i++) {
      const b0 = 1 + (i - 1) * SEG, b1 = 1 + i * SEG;
      for (let j = 0; j < SEG; j++) {
        const j2 = (j + 1) % SEG, a = b0 + j, b = b0 + j2, c = b1 + j, d = b1 + j2;
        idx[q++] = a; idx[q++] = b; idx[q++] = c; idx[q++] = b; idx[q++] = d; idx[q++] = c;
      }
    }
    const geo = new TH.BufferGeometry();
    geo.setAttribute('position', new TH.BufferAttribute(pos, 3));
    colBase = col; colHaz = haz;
    geo.setAttribute('color', new TH.BufferAttribute(col.slice(), 3));
    geo.setAttribute('uv', new TH.BufferAttribute(uv, 2));
    geo.setIndex(new TH.BufferAttribute(idx, 1)); geo.computeVertexNormals();
    const tx = window.__v3dTex;
    const mat = regolithMaterial(tx);
    terrainMesh = new TH.Mesh(geo, mat);
    terrainMesh.castShadow = true; terrainMesh.receiveShadow = true;
    root.add(terrainMesh);

    // --- камни (статистическая модель, как на снимках LRO: много мелких, мало крупных) ---
    const rockMat = new TH.MeshStandardMaterial({ color: 0x8f8d89, roughness: 1, metalness: 0 });
    const rr0 = rng(99);
    for (let v = 0; v < 3; v++) {
      let g = new TH.IcosahedronGeometry(1, 2);
      g.deleteAttribute('normal'); g.deleteAttribute('uv'); g = TH.BufferGeometryUtils ? TH.BufferGeometryUtils.mergeVertices(g) : g;
      const pa = g.getAttribute('position'), ph = [rr0() * 6, rr0() * 6, rr0() * 6];
      for (let i = 0; i < pa.count; i++) {
        const x = pa.getX(i), y = pa.getY(i), z = pa.getZ(i);
        const f = 0.8 + 0.18 * Math.sin(x * 3.1 + ph[0]) * Math.cos(y * 2.7 + ph[1]) + 0.12 * Math.sin(z * 4.3 + ph[2]);
        pa.setXYZ(i, x * f, Math.max(y * f * 0.62, -0.25), z * f);
      }
      g.computeVertexNormals();
      const cnt = 520, im = new TH.InstancedMesh(g, rockMat, cnt), m4 = new TH.Matrix4(), qq = new TH.Quaternion(), e3 = new TH.Euler();
      for (let i = 0; i < cnt; i++) {
        const rr = 2.5 + Math.pow(rr0(), 1.7) * 320, a = rr0() * Math.PI * 2;
        const de = rr * Math.sin(a), dn = rr * Math.cos(a);
        const s = Math.min(rr < 12 ? 0.35 : 1.4, 0.05 * Math.pow(rr0() + 0.004, -0.55));
        const hy = sample(de, dn, true).y;
        e3.set(rr0() * 0.6, rr0() * 6.28, rr0() * 0.6); qq.setFromEuler(e3);
        m4.compose(new TH.Vector3(de, hy - 0.38 * s, -dn), qq, new TH.Vector3(s * (0.8 + rr0() * 0.5), s, s * (0.8 + rr0() * 0.5)));
        im.setMatrixAt(i, m4);
      }
      im.castShadow = true; im.receiveShadow = true; root.add(im);
    }

    // --- зона посадки (эллипс 100 м, повторяет рельеф) ---
    const epts = [];
    for (let i = 0; i <= 128; i++) {
      const a = i / 128 * Math.PI * 2, de = 50 * Math.sin(a), dn = 50 * Math.cos(a);
      epts.push(new TH.Vector3(de, sample(de, dn, true).y + 0.6, -dn));
    }
    ellipse = new TH.Group();
    const eg = new TH.BufferGeometry().setFromPoints(epts);
    const line = new TH.Line(eg, new TH.LineDashedMaterial({ color: 0x7dffd2, dashSize: 6, gapSize: 4, toneMapped: false, transparent: true, opacity: 0.95 }));
    line.computeLineDistances(); ellipse.add(line);
    const ipts = []; for (let i = 0; i <= 64; i++) { const a = i / 64 * Math.PI * 2, de = 12 * Math.sin(a), dn = 12 * Math.cos(a); ipts.push(new TH.Vector3(de, sample(de, dn, true).y + 0.6, -dn)); }
    ellipse.add(new TH.Line(new TH.BufferGeometry().setFromPoints(ipts), new TH.LineBasicMaterial({ color: 0x9dffde, toneMapped: false })));
    ellipse.visible = false; root.add(ellipse);

    // --- дальние горы по маске горизонта (та же маска, что в расчётах) ---
    const mask = r.site.horizon || new Array(360).fill(0);
    const pos2 = [], idx2 = [];
    for (let a = 0; a <= 360; a++) {
      const az = a % 360, el = Math.max(-3, mask[az]);
      const top = enu(az, el, FAR_R), bot = enu(az, -6, FAR_R);
      top.y += EYE; bot.y += EYE;
      pos2.push(top.x, top.y, top.z, bot.x, bot.y, bot.z);
      if (a < 360) { const qq2 = a * 2; idx2.push(qq2, qq2 + 1, qq2 + 2, qq2 + 1, qq2 + 3, qq2 + 2); }
    }
    const g2 = new TH.BufferGeometry(); g2.setAttribute('position', new TH.Float32BufferAttribute(pos2, 3)); g2.setIndex(idx2);
    g2.setAttribute('color', new TH.Float32BufferAttribute(new Float32Array(pos2.length), 3));
    farMesh = new TH.Mesh(g2, new TH.MeshBasicMaterial({ vertexColors: true, side: TH.DoubleSide }));
    root.add(farMesh);

    [['sun', 'sky.sun'], ['earth', 'sky.earth']].forEach(([kk, key]) => {
      const lab = document.createElement('div'); lab.className = 'v3d-body ' + kk; lab.dataset.body = kk; lab.textContent = L().t(key);
      $('v3dCanvas').appendChild(lab); labels.push(lab);
    });
    ['N', 'E', 'S', 'W'].forEach((d, i) => {
      const lab = document.createElement('div'); lab.className = 'v3d-dir'; lab.dataset.az = i * 90; lab.textContent = L().t('dir.' + d);
      $('v3dCanvas').appendChild(lab); labels.push(lab);
    });
    camera.position.set(0, heightLocal(0, 0) + EYE, 0);
    hudStatic();
  }

  function setHazardColors(t) {
    const a = terrainMesh.geometry.getAttribute('color');
    for (let i = 0; i < a.array.length; i++) a.array[i] = colBase[i] + (colHaz[i] - colBase[i]) * t;
    a.needsUpdate = true;
  }

  /** Солнце, Земля, свет для текущего момента */
  function update(at) {
    if (!cur) return;
    const date = at || tlDate || L().state.view;
    const s = E.skyState(date, cur.site);
    cur.sky = s;
    placeBodies();
    const la = cur.p.lat * Math.PI / 180, lo = cur.p.lon * Math.PI / 180;
    const eE = [-Math.sin(lo), Math.cos(lo), 0], eN = [-Math.sin(la) * Math.cos(lo), -Math.sin(la) * Math.sin(lo), Math.cos(la)], eU = [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
    const loc = (v) => new TH.Vector3(v[0] * eE[0] + v[1] * eE[1] + v[2] * eE[2], v[0] * eU[0] + v[1] * eU[1] + v[2] * eU[2], -(v[0] * eN[0] + v[1] * eN[1] + v[2] * eN[2]));
    const ax = E.earthAxes(date);
    const F = E.moonAxesEQJ(date);
    const dot3 = (a, e) => a[0] * e.x + a[1] * e.y + a[2] * e.z;
    window.Bodies.orientSky(skyMesh, (e) => loc([dot3(F.X, e), dot3(F.Y, e), dot3(F.Z, e)]));
    window.Bodies.updateEarth(earthMesh, enu(s.sun.az, s.sun.el, 1), loc(ax.north), loc(ax.prime));
    const cAttr = farMesh.geometry.getAttribute('color');
    for (let a = 0; a <= 360; a++) {
      const lit = s.sun.fraction * Math.max(0, -Math.cos((a - s.sun.az) * Math.PI / 180));
      const top = 0.14 + 0.4 * lit, bot = 0.05 + 0.1 * lit;
      cAttr.setXYZ(a * 2, top, top * 0.98, top * 0.95); cAttr.setXYZ(a * 2 + 1, bot, bot, bot);
    }
    cAttr.needsUpdate = true;
    if (!at) hud(); draw();
  }

  // Солнце/Земля/небо и свет следуют за камерой
  function placeBodies() {
    const s = cur && cur.sky; if (!s) return;
    const cp = camera.position;
    sunMesh.position.copy(enu(s.sun.az, s.sun.el, SKY_R * 0.82)).add(cp);
    const ed = enu(s.earth.az, s.earth.el, SKY_R * 0.78);
    earthMesh.position.copy(ed).add(cp);
    earthMesh.scale.setScalar(SKY_R * 0.78 * Math.tan(s.earth.radius * Math.PI / 180));
    skyMesh.userData.center = cp.clone();
    // тени: центр — точка на земле перед камерой
    const fwd = new TH.Vector3(Math.sin(-look.yaw) * -1, 0, -Math.cos(look.yaw)).multiplyScalar(0);
    const tgt = new TH.Vector3(cp.x, 0, cp.z);
    if (!descent) { const yaw = look.yaw; tgt.x += -Math.sin(yaw) * 500; tgt.z += -Math.cos(yaw) * 500; }
    tgt.y = heightLocal ? heightLocal(tgt.x, -tgt.z) : 0;
    sunLight.target.position.copy(tgt);
    sunLight.position.copy(enu(s.sun.az, Math.max(s.sun.el, 0.3), 20000)).add(tgt);
    // «автоэкспозиция» камеры: при низком Солнце свет ярче (как настраивают камеру на снимках)
    sunLight.intensity = 6.0 * s.sun.fraction / (Math.sin(Math.max(0.2, s.sun.el) * Math.PI / 180) * 4 + 0.25) * 0.75;
    void fwd;
  }

  const fDeg = (v) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2) + '°';
  function verdictText() {
    const v = cur && cur.verdict;
    if (v === 'ok') return [ru() ? 'МОЖНО САДИТЬСЯ' : 'GO FOR LANDING', 'go'];
    if (v === 'warn') return [ru() ? 'ПОСАДКА С ОСТОРОЖНОСТЬЮ' : 'GO WITH CAUTION', 'warn'];
    return [ru() ? 'ПОСАДКА ЗАПРЕЩЕНА' : 'NO GO', 'nogo'];
  }

  // неизменная часть HUD (зависит только от места и языка)
  function hudStatic() {
    if (!cur) return;
    const meta = L().siteMeta && L().siteMeta(L().state.siteId); const name = meta ? meta.name[L().state.lang] : ($('vName') ? $('vName').textContent.split(' · ')[0] : '');
    $('v3dTitle').textContent = name;
    const hz = $('h8legend');
    if (hz) hz.innerHTML = `<div><i class="r"></i>${ru() ? 'круче 15° более чем на 25 % (NASA LOLA 5 м)' : 'steep >15° on >25 % of area (NASA LOLA 5 m)'}</div>
      <div><i class="y"></i>${ru() ? '10–25 % — осторожно' : '10–25 % — caution'}</div><div><i class="e"></i>${ru() ? 'зона посадки 100 м' : 'landing ellipse 100 m'}</div>`;
    const t = $('h8title'); if (t) t.innerHTML = `<small>LUNAR SITE NAVIGATOR · ${ru() ? 'ВИД С МЕСТА ПОСАДКИ' : 'SURFACE VIEW'}</small><b>${descent ? (ru() ? 'ЗАХОД НА ПОСАДКУ' : 'FINAL APPROACH') : (ru() ? 'НА ПОВЕРХНОСТИ' : 'ON THE SURFACE')} / ${name.toUpperCase()}</b>`;
  }

  function hud() {
    if (!cur || !cur.sky) return;
    const s = cur.sky, f = L().fmt, t = L().t;
    const ev = window.Analysis.nextEvent(tlDate || L().state.view, cur.S, cur.start, cur.site, (x) => x.sun.above);
    const slope = cur.terrain.covered && !isNaN(cur.terrain.slope) ? cur.terrain.slope.toFixed(1) + '°' : '—';
    $('v3dHud').innerHTML = `
      <div><span>UTC</span><b>${f.fUTC(L().state.view).replace(' UTC', '')}</b></div>
      <div class="${s.sun.up ? 'ok' : 'bad'}"><span>${t('q.light')}</span><b>${s.sun.up ? t('yes') : t('no')}</b></div>
      <div class="${s.earth.up ? 'ok' : 'bad'}"><span>${t('q.link')}</span><b>${s.earth.up ? t('yes') : t('no')}</b></div>
      <div class="orange"><span>${s.sun.above ? t('q.sunset') : t('q.sunrise')}</span><b>${ev ? f.fSunset(ev.date - (tlDate || L().state.view)) : t('never')}</b></div>`;
    const box = (id, label, val, cls) => { const e = $(id); if (e) e.innerHTML = `<span>${label}</span><b class="${cls || ''}">${val}</b>`; };
    box('h8sun', ru() ? 'СОЛНЦЕ' : 'SUN', fDeg(s.sun.el) + (s.sun.up ? '' : ' · ' + (ru() ? 'ЗА ГОРИЗОНТОМ' : 'BELOW')), s.sun.up ? '' : 'warn');
    box('h8earth', ru() ? 'ЗЕМЛЯ' : 'EARTH', fDeg(s.earth.el) + (s.earth.up ? ' · ' + (ru() ? 'ВИДНА' : 'IN VIEW') : ' · ' + (ru() ? 'СКРЫТА' : 'HIDDEN')), s.earth.up ? '' : 'warn');
    box('h8slope', ru() ? 'УКЛОН В ТОЧКЕ' : 'SLOPE AT PAD', slope);
    const c = $('h8clock'); if (c) c.innerHTML = `<small>${descent ? (ru() ? 'ДО КАСАНИЯ' : 'T-TOUCHDOWN') : 'UTC'}</small><b>${descent ? '00:00:' + String(Math.max(0, Math.ceil(descent.left))).padStart(2, '0') : (tlDate || L().state.view).toISOString().slice(11, 16)}</b><small>${(tlDate || L().state.view).toISOString().slice(0, 10)}${tl ? ' · ▶▶ ' + (ru() ? 'ДЕНЬ ' : 'DAY ') + Math.floor((tlDate - tl.from) / 864e5 + 1) + '/30' : ''}</small>`;
    const [vt, vc] = verdictText();
    const g = $('h8go'); if (g) { g.className = 'h8 h8-go ' + vc; g.innerHTML = `<small>${descent ? (ru() ? 'ПРОВЕРКА ОПАСНОСТЕЙ…' : 'HAZARD SCAN…') : (ru() ? 'ПРЕДВАРИТЕЛЬНАЯ ОЦЕНКА ПО ДАННЫМ NASA' : 'PRELIMINARY ASSESSMENT · NASA DATA')}</small><b>${vt}</b>`; }
  }

  // шкалы высоты и скорости (как на посадочном HUD)
  function tapes(alt, vs) {
    const mk = (id, val, unit, max, step, side) => {
      const e = $(id); if (!e) return;
      let s = `<svg viewBox="0 0 120 560" preserveAspectRatio="none">`;
      const x0 = side === 'l' ? 10 : 110, dir = side === 'l' ? 1 : -1;
      s += `<line x1="${x0}" y1="0" x2="${x0}" y2="560" />`;
      for (let i = 0; i <= 40; i++) {
        const y = i * 14, v = max - (max / 40) * i, big = i % 5 === 0;
        s += `<line x1="${x0}" y1="${y}" x2="${x0 + dir * (big ? 22 : 10)}" y2="${y}" />`;
        if (big) s += `<text x="${x0 + dir * 28}" y="${y + 4}" text-anchor="${side === 'l' ? 'start' : 'end'}">${Math.round(v)} ${unit}</text>`;
      }
      const yv = Math.max(0, Math.min(560, (1 - val / max) * 560));
      s += `<polygon points="${x0 - dir * 2},${yv} ${x0 - dir * 14},${yv - 8} ${x0 - dir * 14},${yv + 8}" class="mk" /></svg><div class="h8-val" style="top:${yv}px">${Math.round(val)}</div>`;
      e.innerHTML = s;
    };
    mk('h8alt', alt, 'm', 1200, 20, 'l');
    mk('h8spd', Math.abs(vs), 'm/s', 40, 1, 'r');
  }

  // --------------------------- посадка ---------------------------
  function startDescent() {
    if (!cur || !cur.sky) return;
    const yaw = -cur.sky.sun.az * Math.PI / 180;              // садимся лицом к Солнцу
    descent = { t0: performance.now(), dur: 9000, yaw, left: 9 };
    $('v3d').classList.add('descending');
    setHazardColors(1); ellipse.visible = true;
    hudStatic(); requestAnimationFrame(stepDescent);
  }
  function skipDescent() { if (descent) { descent.t0 = performance.now() - descent.dur; } }
  function stepDescent(now) {
    if (!descent || !opened) return;
    if (descent.hold != null) now = descent.t0 + descent.hold * descent.dur;
    const d = descent, u = Math.min(1, (now - d.t0) / d.dur);
    const e = 1 - Math.pow(1 - u, 2.6);                         // плавное торможение
    const ground = heightLocal(0, 0);
    const back = 900 * (1 - e), alt = 1200 * Math.pow(1 - e, 1.35) + EYE;
    const bx = Math.sin(d.yaw) * back, bz = Math.cos(d.yaw) * back;   // позади точки, если смотреть на Солнце
    camera.position.set(bx, ground + alt, bz);
    // взгляд: сначала вниз на точку, у земли — на горизонт
    const pitchDown = Math.atan2(alt, Math.max(1, back));
    look.yaw = d.yaw; look.pitch = -(pitchDown * (1 - e) + 0.06 * e); look.fov = 62;
    const prev = d.alt == null ? alt : d.alt; const vs = (alt - prev) / Math.max(0.001, (now - (d.tp || now)) / 1000);
    d.alt = alt; d.tp = now; d.left = (1 - u) * d.dur / 1000;
    tapes(alt - EYE, isFinite(vs) ? vs : 0);
    placeBodies(); hud(); draw();
    if (d.hold != null) return;
    if (u < 1) requestAnimationFrame(stepDescent);
    else {
      descent = null; $('v3d').classList.remove('descending');
      // опасности плавно гаснут
      let k = 1; const fade = () => { k -= 0.05; setHazardColors(Math.max(0, k)); ellipse.visible = k > 0.3; draw(); if (k > 0) requestAnimationFrame(fade); };
      setTimeout(fade, 1200);
      hudStatic(); hud();
    }
  }

  // --------------------- таймлапс: 30 дней за 15 секунд ---------------------
  function timelapse() {
    if (!cur) return;
    if (tl) { stopTimelapse(); return; }
    if (descent) skipDescent();
    const from = new Date(L().state.view.getTime());
    tl = { from, t0: performance.now(), dur: 15000 };
    $('v3dTl') && $('v3dTl').classList.add('on');
    // смотрим чуть шире, чтобы были видны и Солнце, и тени
    look.fov = Math.max(look.fov, 70); look.pitch = Math.min(look.pitch, -0.02);
    const step = (now) => {
      if (!tl || !opened) return;
      const u = Math.min(1, (now - tl.t0) / tl.dur);
      tlDate = new Date(from.getTime() + u * 30 * 864e5);
      update(tlDate); hud();
      if (u < 1) requestAnimationFrame(step); else stopTimelapse(true);
    };
    requestAnimationFrame(step);
  }
  function stopTimelapse(done) {
    if (!tl) return;
    const end = tlDate; tl = null; tlDate = null;
    $('v3dTl') && $('v3dTl').classList.remove('on');
    if (!done && end) L().setView(end); else update();
  }

  function lookAt(which) {
    if (!cur || !cur.sky) return;
    if (descent) skipDescent();
    const b = cur.sky[which];
    look.yaw = -b.az * Math.PI / 180; look.pitch = b.el * Math.PI / 180;
    look.fov = which === 'earth' ? 7 : 6;
    draw();
  }

  function draw() {
    if (!opened) return;
    camera.fov = look.fov; camera.updateProjectionMatrix();
    camera.rotation.set(look.pitch, look.yaw, 0);
    if (!descent) placeBodies();
    renderer.render(scene, camera);
    const w = $('v3dCanvas').clientWidth, h = $('v3dCanvas').clientHeight;
    labels.forEach((lab) => {
      let v;
      if (lab.dataset.body) {
        if (!cur || !cur.sky) return;
        const b = cur.sky[lab.dataset.body];
        v = enu(b.az, b.el + (lab.dataset.body === 'earth' ? b.radius * 1.6 : 0.6), 50000);
      } else v = enu(+lab.dataset.az, 0.3, 50000);
      v.add(camera.position);
      v.project(camera);
      const vis = v.z < 1 && Math.abs(v.x) < 1.1 && !descent;
      lab.style.display = vis ? '' : 'none';
      lab.style.left = ((v.x + 1) / 2 * w) + 'px'; lab.style.top = ((1 - v.y) / 2 * h) + 'px';
    });
  }

  function open(opts) {
    if (!renderer) init();
    $('v3d').classList.remove('hidden'); opened = true;
    resize(); build(); update();
    if (cur && cur.sky) { look.yaw = -cur.sky.sun.az * Math.PI / 180; look.pitch = -0.06; look.fov = 62; }
    setHazardColors(0);
    if (!opts || opts.land !== false) startDescent(); else draw();
  }
  function close() { $('v3d').classList.add('hidden'); opened = false; descent = null; tl = null; tlDate = null; $('v3d').classList.remove('descending'); }

  function _frame(u) { if (!descent) startDescent(); descent.hold = u; descent.alt = null; stepDescent(performance.now()); }
  return { open, close, land: startDescent, timelapse, _frame, _tl: (u) => { const f = new Date(L().state.view.getTime() + u * 30 * 864e5); tlDate = f; tl = { from: L().state.view }; update(f); hud(); tl = null; tlDate = null; } };
})();
