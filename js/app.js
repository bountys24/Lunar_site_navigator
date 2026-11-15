/* app.js — связывает карту, анализ, время, вкладки, язык и режимы. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const E = window.LunarEngine, A = window.Analysis, T = window.Terrain;
  const MIN = 60e3, HOUR = 3600e3, WINDOW_MIN = 30 * 1440;

  const store = { get: (k, d) => { try { return localStorage.getItem(k) || d; } catch (e) { return d; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* нет storage */ } } };

  const state = {
    // язык: сохранённый выбор → язык браузера (русский/таджикский и т.п. → RU) → английский
    lang: store.get('lsn-lang', /^(ru|tg|be|kk|ky|uz)\b/i.test(navigator.language || '') ? 'ru' : 'en'),
    mode: store.get('lsn-mode', 'simple'),
    siteId: 'ridge',
    point: null,
    landing: new Date(Math.floor(Date.now() / MIN) * MIN),
    view: null,
    missionDays: 14,
    mast: 2,
    res: null,
    tab: 'sky',
    playing: false,
  };
  const t = (k) => (I18N[state.lang] && I18N[state.lang][k]) || I18N.en[k] || k;
  const listeners = [];
  const tabRenderers = {};

  // ---------- форматирование ----------
  const fDeg = (x) => (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(2) + '°';
  const fPct = (x) => Math.round(x) + '%';
  const fUTC = (d) => d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  // единый формат «до заката» во всех местах сайта
  function fSunset(ms) { return (!isFinite(ms) || ms > 45 * 86400e3) ? t('never') : fDur(ms); }
  function fDur(ms) {
    if (!isFinite(ms)) return '∞';
    const m = Math.max(0, Math.round(ms / MIN));
    const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
    return (d ? d + t('unit.d') + ' ' : '') + (d || h ? h + t('unit.h') + ' ' : '') + mm + t('unit.m');
  }
  const fLat = (lat) => Math.abs(lat).toFixed(4) + '°' + (lat < 0 ? 'S' : 'N');

  function toast(msg) {
    let el = document.querySelector('.toast');
    if (!el) { el = document.createElement('div'); el.className = 'toast'; document.body.appendChild(el); }
    el.textContent = msg; el.classList.add('show');
    clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('show'), 2600);
  }

  // ---------- язык и режим ----------
  function applyLang() {
    document.documentElement.lang = state.lang;
    document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
    document.querySelectorAll('#langSeg button').forEach((b) => b.classList.toggle('active', b.dataset.lang === state.lang));
    buildSitePick();
    $('play').textContent = state.playing ? '❚❚ ' + t('pl.pause') : '▶ ' + t('pl.play');
    if (state.res) { renderPanel(); renderView(); }
    PoleMap.draw();
    listeners.forEach((f) => f('lang'));
  }
  function applyMode() {
    document.body.classList.toggle('mode-simple', state.mode === 'simple');
    document.querySelectorAll('#modeSeg button').forEach((b) => b.classList.toggle('active', b.dataset.mode === state.mode));
    if (state.mode === 'simple' && ['windows', 'month', 'dates', 'year', 'compare'].includes(state.tab)) setTab('sky');
    if (state.res) renderPanel();
    if (state.res) renderView();
  }
  document.querySelectorAll('#langSeg button').forEach((b) => b.addEventListener('click', () => { state.lang = b.dataset.lang; store.set('lsn-lang', state.lang); applyLang(); }));
  document.querySelectorAll('#modeSeg button').forEach((b) => b.addEventListener('click', () => { state.mode = b.dataset.mode; store.set('lsn-mode', state.mode); applyMode(); }));

  // ---------- выбор места ----------
  const siteMeta = (id) => SITES.find((s) => s.id === id);
  function buildSitePick() {
    const sel = $('sitePick'); sel.innerHTML = '';
    const head = document.createElement('option'); head.value = ''; head.textContent = t('site.pick'); head.disabled = true;
    sel.appendChild(head);
    [['pole', 'grp.pole'], ['clps', 'grp.clps'], ['intl', 'grp.intl'], ['apollo', 'grp.apollo']].forEach(([g, k]) => {
      const og = document.createElement('optgroup'); og.label = t(k);
      SITES.filter((s) => s.group === g).forEach((s) => {
        const o = document.createElement('option'); o.value = s.id; o.textContent = (s.approx ? '≈ ' : '') + s.name[state.lang]; og.appendChild(o);
      });
      sel.appendChild(og);
    });
    const c = document.createElement('option'); c.value = 'custom'; c.textContent = '+ ' + t('site.custom'); sel.appendChild(c);
    sel.value = state.siteId || 'custom';
  }
  $('sitePick').addEventListener('change', (e) => {
    const s = siteMeta(e.target.value);
    if (s) selectPoint({ lat: s.lat, lon: s.lon }, s.id, true);
  });

  function selectPoint(p, siteId = null, center = false) {
    stopPlay();
    state.point = p; state.siteId = siteId;
    $('sitePick').value = siteId || 'custom';
    PoleMap.setPoint(p, center);
    recompute();
    if (center && window.Globe) Globe.setPoint(p, true);
  }

  // ---------- время ----------
  const toInput = (d) => d.toISOString().slice(0, 16);
  $('date').addEventListener('change', (e) => {
    const d = new Date(e.target.value + ':00Z');
    if (!isNaN(d)) { state.landing = d; recompute(); }
  });
  $('now').addEventListener('click', () => { stopPlay(); state.landing = new Date(Math.floor(Date.now() / MIN) * MIN); recompute(); });
  document.querySelectorAll('[data-step]').forEach((b) => b.addEventListener('click', () => {
    stopPlay(); setView(new Date(state.view.getTime() + Number(b.dataset.step) * MIN));
  }));
  $('slider').addEventListener('input', (e) => { stopPlay(); setView(new Date(state.res.start.getTime() + Number(e.target.value) * MIN)); });
  $('mission').addEventListener('change', (e) => { state.missionDays = Math.max(1, Math.min(30, +e.target.value || 14)); recompute(); });

  /** Просмотр момента внутри 30-дневного окна; если вышли за окно — сдвигаем посадку. */
  function setView(d) {
    const off = (d - state.res.start) / MIN;
    if (off < 0 || off >= WINDOW_MIN) { state.landing = d; recompute(); return; }
    state.view = d; renderView();
  }

  // ---------- анимация ----------
  let timer = null;
  function stopPlay() { if (!state.playing) return; state.playing = false; clearInterval(timer); $('play').textContent = '▶ ' + t('pl.play'); }
  $('play').addEventListener('click', () => {
    if (state.playing) return stopPlay();
    state.playing = true; $('play').textContent = '❚❚ ' + t('pl.pause');
    timer = setInterval(() => {
      let d = new Date(state.view.getTime() + Number($('speed').value) * MIN);
      if ((d - state.res.start) / MIN >= WINDOW_MIN) d = new Date(state.res.start);
      state.view = d; renderView();
    }, 90);
  });

  // ---------- вкладки ----------
  function setTab(name) {
    state.tab = name;
    document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    document.querySelectorAll('.tab').forEach((el) => el.classList.toggle('hidden', el.id !== 'tab-' + name));
    renderView();
  }
  document.querySelectorAll('#tabs button').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));

  function setLanding(d) { stopPlay(); state.landing = new Date(Math.floor(d.getTime() / MIN) * MIN); recompute(); }

  // NASA QuickMap: копируем координаты и открываем карту
  $('btnQuick').addEventListener('click', () => {
    const p = state.point; if (!p) return;
    const txt = `${p.lat.toFixed(4)}, ${(((p.lon + 180) % 360 + 360) % 360 - 180).toFixed(4)}`;
    try { navigator.clipboard && navigator.clipboard.writeText(txt); } catch (e) { /* */ }
    window.open('https://quickmap.lroc.asu.edu/', '_blank', 'noopener');
    toast(t('toast.quick').replace('{c}', txt));
  });

  // ---------- расчёт ----------
  function recompute() {
    if (!state.point) return;
    // высота мачты влияет на горизонт достоверно только там, где есть рельеф 80 м (87–90° ю. ш.)
    const core = window.Terrain && window.Terrain.coreCovers ? window.Terrain.coreCovers(state.point.lat, state.point.lon) : false;
    const mast = core ? state.mast : 2;
    $('exMast').disabled = !core; if (!core) $('exMast').value = '2'; else $('exMast').value = String(state.mast);
    $('mastNote').textContent = core ? '' : t('ex.mastOff');
    state.res = A.analyze(state.point, state.landing, state.missionDays, mast);
    state.view = new Date(state.res.start);
    renderPanel(); renderView();
    listeners.forEach((f) => f('analysis'));
  }

  // ---------- панель вердикта ----------
  // HUD «пульт корабля»: шкалы, вердикт, прицел
  function renderHud(r, meta) {
    const ru = state.lang === 'ru';
    const name = meta ? meta.name[state.lang] : t('site.custom');
    $('hudTitle').textContent = (r.p.lat < -80 ? (ru ? 'ЮЖНЫЙ ПОЛЮС' : 'SOUTH POLE') : (ru ? 'ЛУНА' : 'MOON')) + ' / ' + name.toUpperCase();
    const gauge = (val, col, label) => {
      const C = 2 * Math.PI * 42, v = Math.max(0, Math.min(100, val));
      return `<div class="gauge"><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="42" class="bg"/><circle cx="50" cy="50" r="42" class="fg" style="stroke:${col};stroke-dasharray:${(C * v / 100).toFixed(1)} ${C.toFixed(1)}"/></svg><b>${Math.round(v)}%</b><span>${label}</span></div>`;
    };
    $('hudGauges').innerHTML = gauge(r.mission.sunPct, '#ffcf6b', ru ? 'СОЛНЦЕ' : 'SUNLIGHT') + gauge(r.mission.earthPct, '#5cc8ff', ru ? 'ВИДИМОСТЬ ЗЕМЛИ' : 'EARTH IN VIEW');
    const vt = { ok: ru ? 'МОЖНО САДИТЬСЯ' : 'GO FOR LANDING', warn: ru ? 'ОСТОРОЖНО' : 'GO WITH CAUTION', bad: ru ? 'НЕЛЬЗЯ' : 'NO GO' }[r.verdict];
    $('hudGo').className = 'hud hud-go ' + r.verdict;
    $('hudGo').innerHTML = `<small>${ru ? 'ВЕРДИКТ ▸ ВСЕ СИСТЕМЫ' : 'VERDICT ▸ ALL SYSTEMS'} · ${r.missionDays} ${ru ? 'ДН.' : 'DAYS'}</small><b>${vt}</b>`;
    $('hudTag').innerHTML = `<b>${name.toUpperCase()}</b><span>TARGET LOCK · ${Math.abs(r.p.lat).toFixed(2)}°${r.p.lat < 0 ? 'S' : 'N'} ${(((r.p.lon % 360) + 360) % 360).toFixed(2)}°E</span>`;
  }

  function renderPanel() {
    const r = state.res, p = state.point;
    const v = $('verdict'); v.className = 'verdict ' + r.verdict; void v.offsetWidth; v.classList.add('flash');
    $('panel').classList.remove('panel-body-anim'); void $('panel').offsetWidth; $('panel').classList.add('panel-body-anim');
    $('vTitle').textContent = state.mode === 'simple' ? t('v.' + r.verdict + 'S') : t('v.' + r.verdict);
    const meta = siteMeta(state.siteId);
    $('vName').textContent = (meta ? meta.name[state.lang] : t('site.custom')) + ' · ' + fUTC(r.start);
    $('vNote').textContent = r.psr ? t('v.psr') : (!r.terrain.covered ? t('v.noTerrain') : r.terrain.regional ? (meta ? meta.note[state.lang] + ' · ' : '') + t('v.regional') : (meta ? meta.note[state.lang] : ''));
    $('vNote').style.color = r.psr || !r.terrain.covered ? '' : 'var(--muted)';
    // предупреждения: точность горизонта и затмения
    const warns = [];
    if (r.terrain.covered && r.terrain.source === 'LOLA 240 m') warns.push(t('v.grid240'));
    (r.eclipses || []).filter((w) => w.start - r.start < r.missionDays * 86400e3).slice(0, 2).forEach((w) => {
      warns.push(t('v.eclipse').replace('{d}', fUTC(w.start)).replace('{h}', Math.max(1, Math.round(w.hours))));
    });
    $('vWarn').innerHTML = warns.join('<br>'); $('vWarn').classList.toggle('hidden', !warns.length);
    // повтор настоящей миссии
    const rp = $('btnReplay');
    if (meta && meta.landed) {
      const same = Math.abs(r.start - meta.landed) < 120000;
      rp.classList.toggle('hidden', same);
      rp.textContent = '↺ ' + t('btn.replay').replace('{d}', meta.landed.toISOString().slice(0, 10));
      rp.onclick = () => { setLanding(meta.landed); toast(t('toast.replay')); };
    } else rp.classList.add('hidden');
    renderVerified(); renderEnergy();
    // место хорошее, но время неудачное (ночь / скорый закат) — подсказать
    const bad = r.checks.filter((c) => c.level === 'bad').map((c) => c.key);
    if (bad.length && bad.every((k) => k === 'landLight' || k === 'sunset') && !r.psr) {
      $('vNote').textContent = t('v.timeOnly'); $('vNote').style.color = '';
    }

    const fmt = {
      slope: (c) => c.value == null || isNaN(c.value) ? t('ck.na') : c.value.toFixed(1) + '°',
      landLight: (c) => c.value ? t('yes') : t('no'),
      craters: (c) => c.value.steepPct + '%',
      sunset: (c) => c.value === 0 ? '—' : fSunset(c.value * HOUR),
      sun: (c) => fPct(c.value), earth: (c) => fPct(c.value),
    };
    const simple = state.mode === 'simple';
    const icon = { ok: ICON('ok'), warn: ICON('warn'), bad: ICON('bad'), na: ICON('na') };
    const helpKey = { slope: 'slope', earth: 'earth', sun: 'sun', sunset: 'sunset', landLight: 'sun', craters: 'craters' };
    $('checks').innerHTML = r.checks.map((c) => `<li class="${c.level}"><span>${t((simple ? 'cs.' : 'ck.') + c.key)}${!simple && (c.key === 'sun' || c.key === 'earth') ? ` (${r.missionDays} ${t('p.days')})` : ''}${simple ? `<button class="help" data-help="${helpKey[c.key]}">?</button>` : ''}${(c.level === 'bad' || c.level === 'warn') ? `<small>${t('why.' + c.key)}</small>` : ''}</span><b class="${simple ? 'ico' : ''}">${simple ? icon[c.level] : fmt[c.key](c)}</b></li>`).join('');
    $('vSummary').textContent = simpleSummary(r);
    renderHud(r, meta);

    $('pCoords').textContent = fLat(p.lat) + ' ' + (((p.lon % 360) + 360) % 360).toFixed(4) + '°E';
    $('pElev').textContent = r.terrain.covered ? Math.round(r.terrain.elev) + ' m' : '—';
    $('pSlope').textContent = r.terrain.covered && !isNaN(r.terrain.slope) ? r.terrain.slope.toFixed(1) + '°' : '—';
    $('pTerrain').textContent = r.terrain.covered ? 'NASA ' + r.terrain.source : '—';
    // грунт и безопасность
    const g = [];
    const sl = r.terrain.slope;
    if (r.terrain.covered && !isNaN(sl)) g.push([sl <= 10 ? 'ok' : sl <= 15 ? 'warn' : 'bad', t(sl <= 10 ? 'g.slopeOk' : sl <= 15 ? 'g.slopeWarn' : 'g.slopeBad').replace('{v}', sl.toFixed(1)) + (r.terrain.regional ? ' ' + t('g.regional') : '')]);
    else g.push(['warn', t('g.noData')]);
    if (r.terrain.hazard) {
      const hz = r.terrain.hazard;
      g.push([hz.steepPct > A.RULES.steep.warn ? 'bad' : hz.steepPct > A.RULES.steep.ok ? 'warn' : 'ok', t('g.craters').replace('{p}', hz.steepPct).replace('{m}', hz.maxSlope)]);
    }
    g.push(['', t(r.terrain.hazard ? 'g.boulders' : 'g.bouldersNoData')]);
    if (r.psr) g.push(['bad', t('g.psr')]);
    else if (r.now.sun.up && r.now.sun.el < 3) g.push(['warn', t('g.lowSun').replace('{v}', r.now.sun.el.toFixed(1))]);
    g.push(['', t('g.regolith')]);
    g.push(['warn', t('g.dust')]);
    $('groundList').innerHTML = g.map(([c, txt]) => `<li class="${c}">${txt}</li>`).join('');
    const gl = g.some(([c]) => c === 'bad') ? 'bad' : g.some(([c]) => c === 'warn') ? 'warn' : 'ok';
    $('groundIcon').className = gl;
    $('mission').value = state.missionDays;
    $('date').value = toInput(r.start);
    $('exLat').value = p.lat.toFixed(4); $('exLon').value = (((p.lon % 360) + 360) % 360).toFixed(4);
    $('exAcc').innerHTML = `${t('ex.accEph')}<br>${t('ex.accTer')}: NASA ${r.terrain.source || '—'}${r.terrain.covered ? '' : ''}<br>${t('ex.accMast')}: ${$('exMast').disabled ? 2 : state.mast} m`;
  }

  // ---------- «Проверено»: сверка с NASA и реальными миссиями ----------
  function renderVerified() {
    $('verifiedList').innerHTML = ['vf.1', 'vf.2', 'vf.3', 'vf.4'].map((k) => `<li>${t(k)}</li>`).join('');
  }

  // ---------- калькулятор энергии ----------
  function renderEnergy() {
    const r = state.res; if (!r) return;
    const A = Math.max(0, +$('enArea').value || 0), eff = Math.max(0, +$('enEff').value || 0) / 100, load = Math.max(0, +$('enLoad').value || 0);
    const S = r.S.slice(0, Math.round(r.missionDays * 24));
    const genWh = S.reduce((a, s) => a + s.powerWm2 * A * eff, 0);         // шаг 1 ч → Вт·ч
    const useWh = load * S.length;
    const nightH = r.mission.longestNightH;
    const battWh = load * nightH;
    const kwh = (wh) => (wh / 1000).toFixed(wh < 10000 ? 2 : 1) + ' kWh';
    const bal = genWh - useWh;
    $('enOut').innerHTML = `
      <div><span>${t('en.gen')}</span><b>${kwh(genWh)}</b></div>
      <div><span>${t('en.use')}</span><b>${kwh(useWh)}</b></div>
      <div class="${bal >= 0 ? 'ok' : 'bad'} wide"><span>${t('en.bal')}</span><b>${bal >= 0 ? '+' : '−'}${kwh(Math.abs(bal))}</b></div>
      <div><span>${t('en.night')}</span><b>${fDur(nightH * HOUR)}</b></div>
      <div><span>${t('en.batt')}</span><b>${kwh(battWh)}</b></div>
      <p class="ex-note wide">${t('en.note')}</p>`;
  }
  ['enArea', 'enEff', 'enLoad'].forEach((id) => $(id).addEventListener('input', renderEnergy));

  // ---------- «Просто»: одна понятная фраза ----------
  function simpleSummary(r) {
    const ru = state.lang === 'ru';
    if (r.psr) return t('sum.psr');
    const sunDays = Math.round(r.mission.sunPct / 10);
    const e = r.mission.earthPct;
    const link = e >= 80 ? t('sum.linkAlways') : e >= 50 ? t('sum.linkMost') : e >= 20 ? t('sum.linkHalf') : t('sum.linkRare');
    const sl = r.terrain.covered && !isNaN(r.terrain.slope) ? (r.terrain.slope <= 10 ? t('sum.flat') : r.terrain.slope <= 15 ? t('sum.steepish') : t('sum.steep')) : '';
    const light = r.now.sun.up ? '' : t('sum.darkNow') + ' ';
    return light + t('sum.light').replace('{n}', sunDays).replace('{d}', r.missionDays) + ' ' + link + (sl ? ' ' + sl : '') + ' ' + t('sum.v.' + r.verdict);
  }

  // ---------- «Эксперт»: ввод координат, требования миссии, высота мачты ----------
  $('exGo').addEventListener('click', () => {
    const lat = parseFloat($('exLat').value), lon = parseFloat($('exLon').value);
    if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90) return toast(t('ex.bad'));
    selectPoint({ lat, lon }, null, true);
  });
  function applyRules() {
    const sl = +$('exSlope').value || 10, su = +$('exSun').value || 0, ea = +$('exEarth').value || 0;
    A.RULES.slope.ok = sl; A.RULES.slope.warn = sl + 5;
    A.RULES.sun.ok = su; A.RULES.sun.warn = Math.round(su * 0.57);
    A.RULES.earth.ok = ea; A.RULES.earth.warn = Math.round(ea * 0.4);
    recompute();
  }
  ['exSlope', 'exSun', 'exEarth'].forEach((id) => $(id).addEventListener('change', applyRules));
  $('exMast').addEventListener('change', (e) => { state.mast = +e.target.value; recompute(); });

  // ---------- кнопки «?» с объяснениями ----------
  document.addEventListener('click', (e) => {
    const b = e.target.closest('.help'); const pop = $('helpPop');
    if (!b) { pop.classList.add('hidden'); return; }
    e.stopPropagation();
    pop.textContent = t('help.' + b.dataset.help);
    const rc = b.getBoundingClientRect();
    pop.style.left = Math.max(10, Math.min(innerWidth - 320, rc.left - 150)) + 'px'; pop.style.top = (rc.bottom + 8) + 'px';
    pop.classList.remove('hidden');
  });

  // ---------- текущий момент: ответы, небо, таймлайн ----------
  function renderView() {
    const r = state.res; if (!r) return;
    const s = E.skyState(state.view, r.site);
    const off = Math.round((state.view - r.start) / MIN);
    $('slider').value = off;

    const setAns = (id, ok) => { const el = $(id); el.classList.toggle('ok', ok); el.classList.toggle('bad', !ok); el.querySelector('b').textContent = ok ? t('yes') : t('no'); };
    setAns('ansLight', s.sun.up);
    setAns('ansLink', s.earth.up);

    // таймер до заката / восхода от момента просмотра
    const ev = A.nextEvent(state.view, r.S, r.start, r.site, (x) => x.sun.above);
    const as = $('ansSunset');
    as.querySelector('span').textContent = s.sun.above ? t('q.sunset') : t('q.sunrise');
    as.querySelector('b').textContent = ev ? fSunset(ev.date - state.view) : t('never');
    as.querySelector('small').textContent = (ev ? fUTC(ev.date) : '') + (off ? '  ·  ' + fUTC(state.view) : '');
    // таймер до потери / появления прямой видимости Земли
    const le = A.nextEvent(state.view, r.S, r.start, r.site, (x) => x.earth.up);
    const al = $('ansLos');
    al.querySelector('span').textContent = s.earth.up ? t('q.losIn') : t('q.losBack');
    al.querySelector('b').textContent = le ? fSunset(le.date - state.view) : t('never');
    al.querySelector('small').textContent = le ? fUTC(le.date) : '';

    if (state.tab === 'sky') {
      const ru = state.lang === 'ru';
      const i0 = Math.round((state.view - r.start) / HOUR);
      const sv = SkyView.render($('sky'), r.S, s, r.site, {
        N: t('dir.N'), E: t('dir.E'), S: t('dir.S'), W: t('dir.W'),
        sun: t('sky.sun'), earth: t('sky.earth'), horizon: r.terrain.covered ? t('sky.horizon') : t('sky.horizonFlat'),
        below: t('sky.below'), mountains: ru ? 'за горами' : 'behind mountains', eclipse: ru ? 'затмение: Солнце закрыто Землёй' : 'eclipse: Earth covers the Sun', day: (d) => (ru ? '+' + d + ' д' : '+' + d + 'd'),
        legend: (n) => (ru ? `линия — путь на ${n} дней` : `line — path for the next ${n} days`),
      }, { i0, days: 5 });
      const lit = Math.round(sv.earthLit * 100);
      if (state.mode === 'expert') {
        $('metrics').innerHTML = [
          ['m.sunEl', fDeg(s.sun.el), 'sun'], ['m.sunAz', s.sun.az.toFixed(2) + '°', 'sun'], ['m.sunHor', fDeg(s.sun.horizon), 'sun'],
          ['m.earthEl', fDeg(s.earth.el), 'earth'], ['m.earthAz', s.earth.az.toFixed(2) + '°', 'earth'], ['m.earthPhase', lit + '%', 'earth'],
          ['m.power', Math.round(s.powerWm2) + ' W/m²', 'both'],
        ].map(([k, v, c]) => `<div class="metric ${c}"><span>${t(k)}</span><b>${v}</b></div>`).join('');
      } else {
        const card = (c, ic, title, big, ok, small) => `<div class="scard ${c} ${ok ? 'ok' : 'bad'}"><i>${ic}</i><div><span>${title}</span><b>${big}</b><small>${small}</small></div></div>`;
        const pw = Math.round(s.powerWm2);
        $('metrics').innerHTML =
          card('sun', ICON('sun'), t('sc.sun'), s.sun.up ? t('sc.sunUp') : t('sc.sunDown'), s.sun.up, `${t('sc.height')} ${fDeg(s.sun.el)}`) +
          card('earth', ICON('earth'), t('sc.earth'), s.earth.up ? t('sc.linkYes') : t('sc.linkNo'), s.earth.up, `${t('sc.height')} ${fDeg(s.earth.el)} · ${t('sc.lit')} ${lit}%`) +
          card('both', ICON('power'), t('sc.power'), s.sun.up ? t('sc.powerYes') : t('sc.powerNo'), s.sun.up, `${pw} W/m²`);
      }
    }
    if (state.tab === 'month') {
      TimelineView.render({
        svg: $('timeline'), tip: $('tlTip'), samples: r.S, start: r.start, stepH: 1, now: state.view, lang: state.lang,
        labels: { sun: t('tl.sun'), earth: t('tl.earth'), both: t('tl.both') },
        onPick: (d) => { stopPlay(); setView(d); },
        describe: (x) => `<b>${fUTC(x.date)}</b><br>${ICON('sun')} ${fDeg(x.sun.el)} · ${x.sun.up ? t('yes') : t('no')}<br>${ICON('earth')} ${fDeg(x.earth.el)} · ${x.earth.up ? t('yes') : t('no')}`,
      });
      const m = r.month;
      $('metrics30').innerHTML = [
        ['m.sun30', fPct(m.sunPct), 'sun'], ['m.earth30', fPct(m.earthPct), 'earth'], ['m.both30', fPct(m.bothPct), 'both'],
        ['m.night', fDur(m.longestNightH * HOUR), 'sun'], ['m.blackout', fDur(m.longestBlackoutH * HOUR), 'earth'],
      ].map(([k, v, c]) => `<div class="metric ${c}"><span>${t(k)}</span><b>${v}</b></div>`).join('');
    }
    if (state.tab === 'windows') {
      const li = (w) => `<li>${t('w.from')} ${fUTC(w.start)} ${t('w.to')} ${fUTC(w.end).slice(5)} · ${fDur(w.hours * HOUR)}</li>`;
      $('wSun').innerHTML = r.sunWindows.map(li).join('') || `<li>${t('w.none')}</li>`;
      $('wEarth').innerHTML = r.earthWindows.map(li).join('') || `<li>${t('w.none')}</li>`;
      const m = r.site.horizon;
      $('maskTable').innerHTML = m ? Array.from({ length: 36 }, (_, i) => `<div><span>${i * 10}°</span>${m[i * 10].toFixed(2)}°</div>`).join('') : `<p class="hint">${t('w.none')}</p>`;
    }
    if (tabRenderers[state.tab]) tabRenderers[state.tab]('view');
    listeners.forEach((f) => f('view', s));
  }

  // ---------- кнопки ----------
  $('btn3d').addEventListener('click', () => {
    if (window.View3D) window.View3D.open(); else toast(state.lang === 'ru' ? '3D-вид — следующий шаг' : '3D view is coming next');
  });

  $('btnMaskCsv').addEventListener('click', () => {
    const r = state.res, m = r.site.horizon || [];
    const blob = new Blob(['azimuth_deg,horizon_elevation_deg\n' + m.map((v, i) => i + ',' + v.toFixed(4)).join('\n')], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `horizon_mask_${r.p.lat.toFixed(3)}_${r.p.lon.toFixed(3)}.csv`; a.click();
  });

  // часы UTC
  setInterval(() => { $('clock').textContent = new Date().toISOString().slice(11, 19); }, 1000);

  // ---------- карта ----------
  PoleMap.init($('map'), {
    image: 'data/pole_map.jpg',
    sites: SITES.filter((s) => s.lat < -80).map((s) => ({ ...s, label: () => s.name[state.lang].split(' (')[0].split(' — ')[0] })),
    onPick: (p) => selectPoint(p, null, false),
    onHover: (h) => { $('hover').textContent = h ? `${fLat(h.lat)} ${h.lon.toFixed(3)}°E  h ${isNaN(h.h) ? '—' : Math.round(h.h) + ' m'}  slope ${isNaN(h.slope) ? '—' : h.slope + '°'}` : ''; },
  });
  const polarSites = SITES.map((x) => ({ ...x, label: () => x.name[state.lang].split(' (')[0].split(' — ')[0] }));
  let use3D = true;
  try {
    Globe.init($('globe'), { sites: polarSites, onPick: (p) => selectPoint(p, null, false) });
    Globe.startDrift();
  } catch (e) { console.warn('WebGL unavailable, using 2D map', e); use3D = false; }
  function setMapMode(three) {
    use3D = three;
    $('map').classList.toggle('hidden', three); document.querySelector('.zoom2d').classList.toggle('hidden', three);
    $('goPole').classList.toggle('hidden', !three); $('goSpace').classList.toggle('hidden', !three);
    if (window.Globe) Globe.setActive(three);
    if (!three) { PoleMap.reset(); PoleMap.draw(); }
  }
  $('goPole').addEventListener('click', () => Globe.flyTo('pole'));
  $('goSpace').addEventListener('click', () => Globe.flyTo('space'));
  listeners.push((ev) => {
    if (ev === 'view' && use3D) Globe.setTime(state.view);
    if (ev === 'analysis' && use3D) Globe.setPoint(state.point, false);
    if (ev === 'lang' && use3D) Globe.relabel();
  });
  $('zIn').addEventListener('click', PoleMap.zoomIn);
  $('zOut').addEventListener('click', PoleMap.zoomOut);
  $('zReset').addEventListener('click', PoleMap.reset);

  // публичный API для следующих модулей (3D, сравнение, тепловая карта)
  window.LSN = {
    state, t, on: (f) => listeners.push(f), fmt: { fDeg, fPct, fUTC, fDur, fSunset }, selectPoint, setView, toast, siteMeta,
    setTab, registerTab: (name, fn) => { tabRenderers[name] = fn; },
    setLanding,
    play: () => { if (!state.playing) $('play').click(); }, stop: () => stopPlay(),
    siteName: () => { const m = siteMeta(state.siteId); return m ? m.name[state.lang] : t('site.custom'); },
  };

  // ---------- старт ----------
  applyMode();
  const s0 = siteMeta('ridge');
  state.point = { lat: s0.lat, lon: s0.lon };
  applyLang();
  PoleMap.setPoint(state.point, false);
  if (!use3D) setMapMode(false);
  recompute();

  // ---------- фон: настоящее небо NASA ----------
  if (window.SKY_TEX) document.documentElement.style.backgroundImage = `url(${window.SKY_TEX})`;

  // ---------- панель: свернуть / развернуть ----------
  function setPanel(open) {
    $('panel').classList.toggle('collapsed', !open); $('panelToggle').classList.toggle('collapsed', !open);
    $('panelToggle').textContent = open ? '▸' : '◂ ' + t('panel.show'); $('panelToggle').title = open ? t('panel.hide') : '';
  }
  $('panelToggle').addEventListener('click', () => setPanel($('panel').classList.contains('collapsed')));
  setPanel(true);
  listeners.push((ev) => { if (ev === 'lang') setPanel(!$('panel').classList.contains('collapsed')); });

  // ---------- заставка ----------
  const splashLang = () => {
    $('splashSub').textContent = t('splash.sub'); $('splashBtnTxt').textContent = t('splash.go');
    document.querySelectorAll('[data-slang]').forEach((b) => b.classList.toggle('active', b.dataset.slang === state.lang));
  };
  document.querySelectorAll('[data-slang]').forEach((b) => b.addEventListener('click', () => { state.lang = b.dataset.slang; store.set('lsn-lang', state.lang); applyLang(); splashLang(); }));
  splashLang();
  $('splashGo').disabled = false;
  if (window.Globe && use3D) { Globe.flyTo('space'); Globe.setAutoRotate(true); }
  $('splashGo').addEventListener('click', () => {
    $('splash').classList.add('gone');
    if (window.Globe && use3D) {
      Globe.setAutoRotate(false);
      setTimeout(() => Globe.flyTo('pole'), 300);
      setTimeout(() => Globe.setPoint(state.point, true), 2000);
    }
    setTimeout(() => $('.map-hint') && 0, 0);
    setTimeout(() => document.querySelector('.map-hint').classList.add('fade'), 9000);
  });
})();
