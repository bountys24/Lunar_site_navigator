/*
 * bodies.js — реалистичные Земля и Солнце для 3D-сцен.
 * Земля: снимок NASA Blue Marble + облака, день/ночь от реального Солнца, голубая атмосфера по краю,
 *        поворот Земли по реальному звёздному времени (видны правильные континенты).
 * Солнце: диск с потемнением к краю (как на настоящих снимках) + свечение.
 */
window.Bodies = (function () {
  'use strict';
  const TH = window.THREE;
  const ET = window.EARTH_TEX || {};
  const loader = new TH.TextureLoader();
  const tex = (src, srgb) => { if (!src) return null; const t = loader.load(src); if (srgb) t.colorSpace = TH.SRGBColorSpace; t.anisotropy = 4; return t; };
  let dayTex = null, cloudTex = null;

  function makeEarth(radius) {
    if (!dayTex) { dayTex = tex(ET.day, true); cloudTex = tex(ET.clouds, false); }
    const group = new TH.Group();
    const surf = new TH.Mesh(new TH.SphereGeometry(radius, 96, 64), new TH.ShaderMaterial({
      uniforms: { dayMap: { value: dayTex }, cloudMap: { value: cloudTex }, sunDir: { value: new TH.Vector3(1, 0, 0) }, hasTex: { value: dayTex ? 1 : 0 } },
      vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vW;
        void main(){ vUv = uv; vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `uniform sampler2D dayMap; uniform sampler2D cloudMap; uniform vec3 sunDir; uniform float hasTex;
        varying vec2 vUv; varying vec3 vN; varying vec3 vW;
        void main(){
          vec3 n = normalize(vN); float d = dot(n, normalize(sunDir));
          vec3 day = hasTex > 0.5 ? texture2D(dayMap, vUv).rgb : vec3(0.1, 0.3, 0.6);
          day = pow(day, vec3(2.2));                                   // sRGB -> линейный
          float cl = hasTex > 0.5 ? texture2D(cloudMap, vUv).r : 0.0;
          vec3 col = mix(day, vec3(0.95), cl * 0.85);
          float light = smoothstep(-0.08, 0.12, d) * (0.08 + 0.92 * max(d, 0.0));
          vec3 v = normalize(cameraPosition - vW);
          float fres = pow(1.0 - max(dot(n, v), 0.0), 3.0);
          vec3 atm = vec3(0.35, 0.6, 1.0) * fres * smoothstep(-0.3, 0.3, d) * 0.9;
          vec3 c = col * light * 1.6 + atm;
          gl_FragColor = vec4(pow(c, vec3(1.0 / 2.2)), 1.0);
        }`,
    }));
    group.add(surf);
    // тонкое свечение атмосферы вокруг диска
    const halo = new TH.Mesh(new TH.SphereGeometry(radius * 1.04, 64, 32), new TH.ShaderMaterial({
      uniforms: { sunDir: { value: new TH.Vector3(1, 0, 0) } }, transparent: true, depthWrite: false, side: TH.BackSide, blending: TH.AdditiveBlending,
      vertexShader: 'varying vec3 vN; varying vec3 vW; void main(){ vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: 'uniform vec3 sunDir; varying vec3 vN; varying vec3 vW; void main(){ vec3 v = normalize(cameraPosition - vW); float rim = pow(1.0 - abs(dot(normalize(vN), v)), 4.0); float lit = smoothstep(-0.4, 0.4, dot(normalize(vN), normalize(sunDir))); gl_FragColor = vec4(vec3(0.3,0.55,1.0) * rim * lit * 0.8, rim * lit); }',
    }));
    group.add(halo);
    group.userData = { surf, halo };
    return group;
  }

  /**
   * Обновить Землю: направление на Солнце (в мире сцены) и ориентацию (северный полюс, Гринвич — в мире сцены).
   */
  const _m = new TH.Matrix4();
  function updateEarth(earth, sunDirWorld, northWorld, primeWorld) {
    earth.userData.surf.material.uniforms.sunDir.value.copy(sunDirWorld).normalize();
    earth.userData.halo.material.uniforms.sunDir.value.copy(sunDirWorld).normalize();
    if (northWorld && primeWorld) {
      const Y = northWorld.clone().normalize();
      const X = primeWorld.clone().sub(Y.clone().multiplyScalar(primeWorld.dot(Y))).normalize();
      const Z = new TH.Vector3().crossVectors(X, Y);           // в текстуре: X — Гринвич, Y — север, −Z — 90° в.д.
      _m.makeBasis(X, Y, Z);
      earth.quaternion.setFromRotationMatrix(_m);
    }
  }

  function glowTex(stops) {
    const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
    const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    stops.forEach(([o, col]) => gr.addColorStop(o, col)); g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
    return new TH.CanvasTexture(c);
  }

  /** Солнце: диск с потемнением к краю + два слоя свечения */
  function makeSun(radius, glowScale = 14) {
    const group = new TH.Group();
    const disk = new TH.Mesh(new TH.SphereGeometry(radius, 48, 24), new TH.ShaderMaterial({
      vertexShader: 'varying vec3 vN; varying vec3 vW; void main(){ vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: 'varying vec3 vN; varying vec3 vW; void main(){ float mu = max(dot(normalize(vN), normalize(cameraPosition - vW)), 0.0); float I = 1.0 - 0.62 * (1.0 - mu) - 0.15 * (1.0 - mu*mu); vec3 c = mix(vec3(1.0,0.62,0.32), vec3(1.0,0.98,0.93), smoothstep(0.0, 0.7, I)); gl_FragColor = vec4(c * (0.75 + 0.45 * I), 1.0); }',
    }));
    group.add(disk);
    const inner = new TH.Sprite(new TH.SpriteMaterial({ map: glowTex([[0, 'rgba(255,250,235,0.95)'], [0.18, 'rgba(255,225,170,0.55)'], [0.45, 'rgba(255,190,110,0.12)'], [1, 'rgba(0,0,0,0)']]), blending: TH.AdditiveBlending, depthWrite: false }));
    inner.scale.setScalar(radius * glowScale * 0.45);
    const outer = new TH.Sprite(new TH.SpriteMaterial({ map: glowTex([[0, 'rgba(255,220,160,0.35)'], [0.3, 'rgba(255,180,90,0.08)'], [1, 'rgba(0,0,0,0)']]), blending: TH.AdditiveBlending, depthWrite: false }));
    outer.scale.setScalar(radius * glowScale * 1.6);
    group.add(inner); group.add(outer);
    return group;
  }

  /**
   * Настоящее звёздное небо: карта NASA SVS Deep Star Maps (Млечный Путь, Магеллановы облака)
   * в экваториальных координатах J2000; ориентируется функцией toScene(вектор J2000) → вектор сцены.
   */
  function makeSky(radius) {
    const t = window.SKY_TEX ? tex(window.SKY_TEX, true) : null;
    const m = new TH.Mesh(new TH.SphereGeometry(radius, 64, 32), new TH.MeshBasicMaterial({ map: t, side: TH.DoubleSide, depthWrite: false, color: 0xbfc4cc }));
    m.renderOrder = -10; m.matrixAutoUpdate = false;
    return m;
  }
  function orientSky(sky, toScene) {
    // локальные оси сферы: x → RA 0h, z → RA 6h, y → полюс мира
    const cx = toScene(new TH.Vector3(1, 0, 0)), cy = toScene(new TH.Vector3(0, 0, 1)), cz = toScene(new TH.Vector3(0, 1, 0));
    const r = sky.geometry.parameters.radius ? 1 : 1;
    sky.matrix.makeBasis(cx, cy, cz);
    sky.matrix.setPosition(sky.userData.center || new TH.Vector3());
    sky.matrixWorldNeedsUpdate = true;
  }

  return { makeEarth, updateEarth, makeSun, makeSky, orientSky };
})();
