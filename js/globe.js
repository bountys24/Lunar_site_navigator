/*
 * globe.js — 3D-Луна вместо плоской карты.
 * Вся Луна: цветная мозаика NASA LRO LROC (data/lroc_color_2k.jpg, CGI Moon Kit).
 * Южный полюс (80°–90° ю.ш.): настоящий рельеф NASA LOLA (объёмный, с тенями).
 * Освещение — от реального Солнца в выбранный момент. Клик по полюсу = точка посадки.
 */
window.Globe = (function () {
  'use strict';
  const TH = window.THREE, T = window.Terrain, E = window.LunarEngine;
  const R = 1737400, EXAG = 2.5, CAP_STEP = 5, CAP_LAT = -80.3;
  let renderer, scene, camera, host, moon, cap, sun, earth, marker, skyMesh, siteDots = [], labels = [];
  let cam = { theta: 0.6, phi: -0.75, dist: 3.4 };
  let onPick = () => {}, active = true, sitesList = [];
  let focus = null;   // точка, на которую смотрит камера вблизи (по умолчанию — полюс)

  // лунные координаты (X — нулевой меридиан, Y — 90°E, Z — север) → three.js (Y вверх)
  const b2t = (x, y, z) => new TH.Vector3(x, z, -y);
  const t2b = (v) => [v.x, -v.z, v.y];
  const llVec = (lat, lon, r = 1) => {
    const a = lat * Math.PI / 180, b = lon * Math.PI / 180;
    return b2t(r * Math.cos(a) * Math.cos(b), r * Math.cos(a) * Math.sin(b), r * Math.sin(a));
  };

  function fallbackTexture() {
    const c = document.createElement('canvas'); c.width = 1024; c.height = 512; const g = c.getContext('2d');
    g.fillStyle = '#8a8a8e'; g.fillRect(0, 0, 1024, 512);
    let s = 5; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    for (let i = 0; i < 60; i++) { g.fillStyle = `rgba(55,55,62,${0.2 + rnd() * 0.3})`; g.beginPath(); g.ellipse(rnd() * 1024, 90 + rnd() * 330, 20 + rnd() * 80, 15 + rnd() * 50, rnd() * 3, 0, 7); g.fill(); }
    for (let i = 0; i < 1200; i++) { const r = Math.pow(rnd(), 3) * 10 + 0.6; g.strokeStyle = `rgba(210,210,215,${0.2 + rnd() * 0.3})`; g.beginPath(); g.arc(rnd() * 1024, rnd() * 512, r, 0, 7); g.stroke(); }
    const t = new TH.CanvasTexture(c); t.colorSpace = TH.SRGBColorSpace; return t;
  }
  function glowTex() {
    const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,250,235,1)'); gr.addColorStop(0.2, 'rgba(255,220,150,0.6)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128); return new TH.CanvasTexture(c);
  }

  /** Рельеф полюса из сетки NASA LOLA */
  function buildCap() {
    const W = T.width, H = T.height, st = CAP_STEP;
    const nW = Math.floor(W / st), nH = Math.floor(H / st);
    const pos = new Float32Array(nW * nH * 3), valid = new Uint8Array(nW * nH);
    for (let i = 0; i < nH; i++) for (let j = 0; j < nW; j++) {
      const L = i * st + st / 2, S = j * st + st / 2;
      const [lat, lon] = T.toLatLon(L, S);
      const h = T.heightPx(L, S);
      const k = i * nW + j;
      if (Number.isNaN(h) || lat > CAP_LAT) continue;
      valid[k] = 1;
      const v = llVec(lat, lon, 1 + h * EXAG / R);
      pos[k * 3] = v.x; pos[k * 3 + 1] = v.y; pos[k * 3 + 2] = v.z;
    }
    const idx = [];
    for (let i = 0; i < nH - 1; i++) for (let j = 0; j < nW - 1; j++) {
      const a = i * nW + j, b = a + 1, c = a + nW, d = c + 1;
      if (valid[a] && valid[b] && valid[c] && valid[d]) idx.push(a, b, c, b, d, c);
    }
    const geo = new TH.BufferGeometry();
    geo.setAttribute('position', new TH.BufferAttribute(pos, 3));
    // проверить ориентацию треугольников (нормали должны смотреть наружу)
    const tri = (q) => new TH.Vector3(pos[q * 3], pos[q * 3 + 1], pos[q * 3 + 2]);
    const a0 = tri(idx[0]), n0 = new TH.Vector3().crossVectors(tri(idx[1]).sub(a0), tri(idx[2]).sub(a0));
    if (n0.dot(a0) < 0) for (let k = 0; k < idx.length; k += 3) { const tmp = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = tmp; }
    geo.setIndex(idx); geo.computeVertexNormals();
    const m = new TH.Mesh(geo, new TH.MeshStandardMaterial({ color: 0x9a9a9c, roughness: 1, metalness: 0 }));
    m.castShadow = true; m.receiveShadow = true;
    return m;
  }

  /** Окрасить рельеф полюса цветами той же карты NASA (без шва с остальной Луной) */
  function colorCap(image) {
    if (!cap || !image) return;
    const cw = 2048, chh = 1024, c = document.createElement('canvas'); c.width = cw; c.height = chh;
    const g = c.getContext('2d'); g.drawImage(image, 0, 0, cw, chh);
    let px; try { px = g.getImageData(0, 0, cw, chh).data; } catch (e) { return; }
    const pos = cap.geometry.getAttribute('position');
    const col = new Float32Array(pos.count * 3), tmp = new TH.Color();
    for (let i = 0; i < pos.count; i++) {
      const [x, y, z] = t2b(new TH.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)));
      const r = Math.hypot(x, y, z); if (!r) continue;
      const lat = Math.asin(z / r) * 180 / Math.PI, lon = Math.atan2(y, x) * 180 / Math.PI;
      const u = Math.min(cw - 1, Math.floor(((lon + 180) / 360) * cw)), v = Math.min(chh - 1, Math.floor(((90 - lat) / 180) * chh));
      const k = (v * cw + u) * 4;
      tmp.setRGB(px[k] / 255, px[k + 1] / 255, px[k + 2] / 255, TH.SRGBColorSpace);
      col[i * 3] = tmp.r; col[i * 3 + 1] = tmp.g; col[i * 3 + 2] = tmp.b;
    }
    cap.geometry.setAttribute('color', new TH.BufferAttribute(col, 3));
    cap.material.vertexColors = true; cap.material.color.set(0xffffff); cap.material.needsUpdate = true;
  }

  function init(container, opts) {
    host = container; onPick = opts.onPick; sitesList = opts.sites || [];
    renderer = new TH.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = TH.PCFSoftShadowMap;
    renderer.domElement.className = 'globe-canvas';
    host.appendChild(renderer.domElement);
    scene = new TH.Scene();
    camera = new TH.PerspectiveCamera(40, 1, 0.001, 200);

    // звёзды
    const pts = []; for (let i = 0; i < 3000; i++) { const v = new TH.Vector3().randomDirection().multiplyScalar(80 + Math.random() * 40); pts.push(v.x, v.y, v.z); }
    const sg = new TH.BufferGeometry(); sg.setAttribute('position', new TH.Float32BufferAttribute(pts, 3));
    scene.add(new TH.Points(sg, new TH.PointsMaterial({ color: 0xffffff, size: 1.1, sizeAttenuation: false, transparent: true, opacity: 0.55 })));
    // настоящее небо NASA (Млечный Путь) — ориентировано по реальным осям Луны
    skyMesh = window.Bodies.makeSky(110); scene.add(skyMesh);

    // Луна (без полярной шапки — там подробный рельеф LOLA 240 м)
    // Цвет: NASA LROC (CGI Moon Kit), рельеф: NASA LOLA LDEM_16 — карта нормалей (свет и тени) + смещение геометрии
    const thetaLen = (90 - CAP_LAT + 0.25) * Math.PI / 180;
    const MT = window.MOON_TEX || {};
    const mat = new TH.MeshStandardMaterial({ map: fallbackTexture(), roughness: 1, metalness: 0 });
    // Склоны за терминатором не должны светиться: гасим прямой свет по геометрической нормали шара
    // (рельеф из карты нормалей лишь меняет яркость склонов на дневной стороне и у терминатора)
    mat.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        #if NUM_DIR_LIGHTS > 0
          float geoSun = smoothstep(-0.015, 0.05, dot(nonPerturbedNormal, directionalLights[0].direction));
          reflectedLight.directDiffuse *= geoSun; reflectedLight.directSpecular *= geoSun;
        #endif`);
    };
    const loader = new TH.TextureLoader();
    if (MT.color) loader.load(MT.color, (tx) => { tx.colorSpace = TH.SRGBColorSpace; tx.anisotropy = 8; mat.map = tx; mat.needsUpdate = true; colorCap(tx.image); draw(); });
    if (MT.normal) loader.load(MT.normal, (tx) => { tx.colorSpace = TH.NoColorSpace; mat.normalMap = tx; mat.normalScale.set(0.8, 0.8); mat.needsUpdate = true; draw(); });
    if (MT.height && MT.meta) loader.load(MT.height, (tx) => {
      const k = EXAG / R, m = MT.meta;
      mat.displacementMap = tx; mat.displacementScale = (m.hmax - m.hmin) * k; mat.displacementBias = m.hmin * k; mat.needsUpdate = true; draw();
    });
    const sphereGeo = new TH.SphereGeometry(1, 512, 256, 0, Math.PI * 2, 0, thetaLen);
    // сфера без шапки: UV по вертикали должны идти по настоящей широте (иначе карта растягивается)
    const uv = sphereGeo.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - (1 - uv.getY(i)) * thetaLen / Math.PI);
    uv.needsUpdate = true;
    moon = new TH.Mesh(sphereGeo, mat);
    moon.receiveShadow = true;
    scene.add(moon);

    cap = buildCap(); scene.add(cap);

    // Солнце (свет + тени) и реалистичный диск вдали
    sun = new TH.DirectionalLight(0xffffff, 3.2);
    sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096);
    const sc = sun.shadow.camera; sc.left = -0.2; sc.right = 0.2; sc.top = 0.2; sc.bottom = -0.2; sc.near = 0.5; sc.far = 8;
    sun.shadow.bias = -0.0002; sun.shadow.normalBias = 0.0005;
    sun.target.position.copy(llVec(-90, 0, 1));
    scene.add(sun); scene.add(sun.target);
    scene.add(new TH.AmbientLight(0x8a96b8, 0.07));   // слабый «земной свет», ночная сторона почти чёрная
    sun.userData.disk = window.Bodies.makeSun(0.55, 16); scene.add(sun.userData.disk);

    // Земля (NASA Blue Marble, облака, день/ночь, атмосфера). Размер и расстояние не в масштабе — для ориентации.
    earth = window.Bodies.makeEarth(0.27);
    scene.add(earth);

    // маркер выбранной точки
    marker = new TH.Group();
    const ring = new TH.Mesh(new TH.RingGeometry(0.006, 0.0085, 40), new TH.MeshBasicMaterial({ color: 0x3dd6d0, side: TH.DoubleSide, depthTest: false }));
    const pin = new TH.Mesh(new TH.CylinderGeometry(0.0007, 0.0007, 0.03, 8), new TH.MeshBasicMaterial({ color: 0x3dd6d0 }));
    pin.position.y = 0.015; ring.rotation.x = -Math.PI / 2;
    ring.visible = false; pin.visible = false; marker.add(ring); marker.add(pin); marker.renderOrder = 10; marker.visible = false;
    scene.add(marker);

    // известные места у полюса
    sitesList.forEach((s) => {
      const dot = new TH.Mesh(new TH.SphereGeometry(0.0035, 12, 8), new TH.MeshBasicMaterial({ color: 0xff8a3d }));
      dot.position.copy(surface(s.lat, s.lon, 0.002)); scene.add(dot); siteDots.push(dot);
      const lab = document.createElement('div'); lab.className = 'globe-label'; lab.textContent = s.label(); lab._site = s;
      host.appendChild(lab); labels.push(lab);
    });

    // управление
    let drag = null, moved = false;
    const el = renderer.domElement;
    el.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, th: cam.theta, ph: cam.phi }; moved = false; el.setPointerCapture(e.pointerId); });
    el.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
      const k = 0.005 * Math.min(1, (cam.dist - 1) * 1.2 + 0.05);
      cam.theta = drag.th - dx * k; cam.phi = Math.max(-1.55, Math.min(1.55, drag.ph + dy * k));
      draw();
    });
    el.addEventListener('pointerup', (e) => { if (drag && !moved) pick(e); drag = null; });
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      cam.dist = Math.max(1.03, Math.min(8, 1 + (cam.dist - 1) * (e.deltaY > 0 ? 1.15 : 0.87)));
      draw();
    }, { passive: false });
    new ResizeObserver(resize).observe(host);
    resize();
  }

  /** Точка на поверхности (с учётом рельефа LOLA и преувеличения) */
  function surface(lat, lon, lift = 0) {
    let h = 0;
    if (T.ready) { const v = T.heightAt(lat, lon); if (!Number.isNaN(v)) h = v; }
    return llVec(lat, lon, 1 + h * EXAG / R + lift);
  }

  const ray = new TH.Raycaster();
  function pick(e) {
    const r = renderer.domElement.getBoundingClientRect();
    const m = new TH.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(m, camera);
    const hit = ray.intersectObjects([cap, moon])[0];
    if (!hit) return;
    const [x, y, z] = t2b(hit.point);
    const lat = Math.asin(z / Math.hypot(x, y, z)) * 180 / Math.PI;
    let lon = Math.atan2(y, x) * 180 / Math.PI; if (lon < 0) lon += 360;
    onPick({ lat, lon });
  }

  function resize() {
    if (!renderer) return;
    const w = host.clientWidth, h = host.clientHeight; if (!w || !h) return;
    renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); draw();
  }

  function draw() {
    if (!renderer || !active) return;
    // камера вращается вокруг южного полюса (центр вращения = центр Луны)
    const cp = Math.cos(cam.phi);
    camera.position.set(cam.dist * cp * Math.cos(cam.theta), cam.dist * Math.sin(cam.phi), cam.dist * cp * Math.sin(cam.theta));
    const target = new TH.Vector3(0, 0, 0).lerp(focus || llVec(-90, 0, 1), Math.max(0, Math.min(1, (2.2 - cam.dist) / 1.2)));
    camera.lookAt(target);
    camera.near = Math.max(0.0005, (cam.dist - 1.05) * 0.2); camera.updateProjectionMatrix();
    renderer.render(scene, camera);
    // подписи мест
    const w = host.clientWidth, h = host.clientHeight;
    const camDir = camera.position.clone().normalize();
    labels.forEach((lab, i) => {
      const p = siteDots[i].position.clone();
      const facing = p.clone().normalize().dot(camDir) > 0.15;
      const v = p.clone().project(camera);
      const show = facing && v.z < 1 && (sitesList[i].lat > -80 ? cam.dist < 2.8 : cam.dist < 2.2);
      lab.style.display = show ? '' : 'none';
      if (show) { lab.style.left = ((v.x + 1) / 2 * w + 8) + 'px'; lab.style.top = ((1 - v.y) / 2 * h) + 'px'; }
    });
    // HUD-прицел на выбранной точке
    const ret = document.getElementById('hudReticle');
    if (ret) {
      const mp = marker.position.clone(), vis = marker.visible && mp.clone().normalize().dot(camDir) > 0.1;
      const v = mp.project(camera);
      ret.style.display = vis && v.z < 1 ? '' : 'none';
      const sx = (v.x + 1) / 2 * w; ret.style.left = sx + 'px'; ret.style.top = ((1 - v.y) / 2 * h) + 'px'; ret.classList.toggle('left', sx > w - 780);
    }
  }

  /** Время: направление Солнца и Земли */
  function setTime(date) {
    if (!renderer) return;
    if (!renderer) return;
    const v = E.bodyVectors(date);
    const sd = b2t(v.sun[0], v.sun[1], v.sun[2]).normalize();
    sun.position.copy(sun.target.position).add(sd.clone().multiplyScalar(4));
    sun.userData.disk.position.copy(sd.clone().multiplyScalar(60));
    earth.position.copy(b2t(v.earth[0], v.earth[1], v.earth[2]).normalize().multiplyScalar(7));
    const F = E.moonAxesEQJ(date);
    const dot3 = (a, e) => a[0] * e.x + a[1] * e.y + a[2] * e.z;
    window.Bodies.orientSky(skyMesh, (e) => b2t(dot3(F.X, e), dot3(F.Y, e), dot3(F.Z, e)));
    skyBase.copy(skyMesh.matrix); applyDrift();
    const ax = E.earthAxes(date);
    window.Bodies.updateEarth(earth, sd, b2t(ax.north[0], ax.north[1], ax.north[2]), b2t(ax.prime[0], ax.prime[1], ax.prime[2]));
    draw();
  }

  function setPoint(p, fly) {
    if (!renderer) return;
    if (!renderer || !p) return;
    marker.visible = true;
    const pos = surface(p.lat, p.lon, 0.0005);
    marker.position.copy(pos);
    marker.quaternion.setFromUnitVectors(new TH.Vector3(0, 1, 0), pos.clone().normalize());
    if (fly) {
      const n = pos.clone().normalize();
      focus = pos.clone();
      animateTo({ theta: Math.atan2(n.z, n.x), phi: Math.max(-1.5, Math.asin(n.y) + 0.1), dist: 1.28 });
    } else draw();
  }

  /** Медленный дрейф звёзд: небо вращается вокруг оси Луны в ту же сторону,
   *  что и на самом деле (только быстрее — для живости картинки). */
  const skyBase = new TH.Matrix4(), driftM = new TH.Matrix4(), POLE = b2t(0, 0, 1);
  let driftAng = 0, driftRaf = null, driftLast = 0;
  const reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  function applyDrift() {
    if (!skyMesh) return;
    driftM.makeRotationAxis(POLE, -driftAng);
    skyMesh.matrix.multiplyMatrices(driftM, skyBase);
    skyMesh.matrixWorldNeedsUpdate = true;
  }
  function driftLoop(now) {
    driftRaf = requestAnimationFrame(driftLoop);
    if (!active || document.hidden || now - driftLast < 33) return;   // ~30 кадров/с
    const dt = driftLast ? Math.min(0.1, (now - driftLast) / 1000) : 0; driftLast = now;
    driftAng += dt * 0.9 * Math.PI / 180;                              // ≈0.9°/с
    applyDrift();
    if (!autoRot && !animBusy) draw();
  }
  let animBusy = false;

  /** Плавный перелёт камеры */
  let anim = null;
  function animateTo(target, ms = 1400) {
    if (!renderer) return;
    const from = { ...cam }, t0 = performance.now();
    let dTh = target.theta - from.theta; dTh = ((dTh + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
    cancelAnimationFrame(anim);
    const step = (now) => {
      const k = Math.min(1, (now - t0) / ms), e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      cam.theta = from.theta + dTh * e; cam.phi = from.phi + (target.phi - from.phi) * e;
      cam.dist = 1 + (from.dist - 1) * Math.pow((target.dist - 1) / (from.dist - 1), e);
      animBusy = k < 1; draw();
      if (k < 1) anim = requestAnimationFrame(step);
    };
    anim = requestAnimationFrame(step);
  }
  function flyTo(where) {
    if (!renderer) return;
    if (where === 'pole') { focus = null; } if (where === 'pole') animateTo({ theta: cam.theta, phi: -1.47, dist: 1.38 });
    else animateTo({ theta: cam.theta, phi: -0.55, dist: 3.4 });
  }

  /** Медленное вращение Луны (для заставки) */
  let autoRot = false, rotRaf = null;
  function setAutoRotate(on) {
    if (!renderer) return;
    autoRot = on; cancelAnimationFrame(rotRaf);
    // смотрим на освещённую сторону Луны и плавно покачиваемся вокруг неё
    const sd = sun.position.clone().sub(sun.target.position).normalize();
    const th0 = Math.atan2(sd.z, sd.x), ph0 = Math.max(-0.35, Math.min(0.35, Math.asin(sd.y)));
    const t0 = performance.now();
    const step = (now) => { if (!autoRot) return; const k = (now - t0) / 1000;
      cam.theta = th0 + 0.55 * Math.sin(k * 0.12); cam.phi = ph0 - 0.25 + 0.12 * Math.sin(k * 0.07); cam.dist = 3.1; draw(); rotRaf = requestAnimationFrame(step); };
    if (on) rotRaf = requestAnimationFrame(step);
  }

  function setActive(on) { if (!renderer) return; active = on; renderer.domElement.style.display = on ? '' : 'none'; labels.forEach((l) => { l.style.display = on ? '' : 'none'; }); if (on) resize(); }
  function relabel() { if (!renderer) return; labels.forEach((l) => { l.textContent = l._site.label(); }); draw(); }

  function startDrift() { if (!reduceMotion && !driftRaf) driftRaf = requestAnimationFrame(driftLoop); }
  return { startDrift, init, setTime, setPoint, setActive, relabel, draw, flyTo, setAutoRotate };
})();
