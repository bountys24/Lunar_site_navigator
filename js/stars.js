/* stars.js — фон со звёздами (лёгкое мерцание, отключается при reduced-motion). */
(function () {
  const c = document.getElementById('stars');
  const ctx = c.getContext('2d');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let stars = [];

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    c.width = innerWidth * dpr; c.height = innerHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const n = Math.round((innerWidth * innerHeight) / 4500);
    stars = Array.from({ length: n }, () => ({
      x: Math.random() * innerWidth, y: Math.random() * innerHeight,
      r: Math.random() * 1.2 + 0.2, a: Math.random() * 0.7 + 0.3,
      s: Math.random() * 0.02 + 0.005, p: Math.random() * Math.PI * 2,
    }));
  }

  function draw(t) {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    for (const s of stars) {
      const tw = reduce ? 1 : 0.65 + 0.35 * Math.sin(s.p + t * s.s * 0.06);
      ctx.globalAlpha = s.a * tw;
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
    }
    if (!reduce) requestAnimationFrame(draw);
  }

  addEventListener('resize', () => { resize(); if (reduce) draw(0); });
  resize();
  requestAnimationFrame(draw);
})();
