/*
 * sites.js — каталог мест посадки.
 * lat: − = юг; lon: восточная долгота. group: pole | clps | apollo | intl
 * approx: координаты центра региона (приблизительно).
 */
window.SITES = [
  // --- Южный полюс: цели и кандидаты ---
  { id: 'ridge', group: 'pole', lat: -89.4398, lon: 222.519,
    name: { en: 'Shackleton–de Gerlache Ridge (peak)', ru: 'Хребет Шеклтон–де Жерлаш (вершина)' },
    note: { en: 'One of the best-lit spots on the Moon', ru: 'Одно из самых освещённых мест на Луне' } },
  { id: 'change7', group: 'pole', lat: -88.8, lon: 123.4,
    name: { en: "Chang'e-7 target (Shackleton rim)", ru: 'Цель Чанъэ-7 (край Шеклтона)' },
    note: { en: 'China, planned', ru: 'Китай, планируется' } },
  { id: 'haworth', group: 'pole', lat: -87.45, lon: -4.98, approx: true,
    name: { en: 'Haworth crater (Artemis III region)', ru: 'Кратер Хоуорт (регион Artemis III)' },
    note: { en: 'Crater floor — permanent shadow, water ice', ru: 'Дно кратера — вечная тень, водяной лёд' } },
  { id: 'malapert', group: 'pole', lat: -86.0, lon: 2.9, approx: true,
    name: { en: 'Malapert Massif (Artemis III region)', ru: 'Массив Малаперт (регион Artemis III)' },
    note: { en: 'Artemis III candidate region', ru: 'Регион-кандидат Artemis III' } },
  // --- CLPS и коммерческие ---
  { id: 'im2', group: 'clps', lat: -84.7906, lon: 29.1957,
    name: { en: 'IM-2 Athena — Mons Mouton', ru: 'IM-2 Athena — гора Мутон' },
    note: { en: 'Intuitive Machines, landed 6 Mar 2025 (tipped over)', ru: 'Intuitive Machines, посадка 6.03.2025 (опрокинулся)' } },
  { id: 'im1', group: 'clps', lat: -80.13, lon: 1.44,
    name: { en: 'IM-1 Odysseus — Malapert A', ru: 'IM-1 Odysseus — Малаперт A' },
    note: { en: 'Intuitive Machines, landed 22 Feb 2024 (tipped over)', ru: 'Intuitive Machines, посадка 22.02.2024 (опрокинулся)' } },
  { id: 'bg1', group: 'clps', lat: 18.56, lon: 61.81,
    name: { en: 'Blue Ghost M1 — Mare Crisium', ru: 'Blue Ghost M1 — Море Кризисов' },
    note: { en: 'Firefly, landed 2 Mar 2025', ru: 'Firefly, посадка 2.03.2025' } },
  // --- Другие страны ---
  { id: 'ch3', group: 'intl', lat: -69.373, lon: 32.319,
    name: { en: 'Chandrayaan-3 — Shiv Shakti', ru: 'Чандраян-3 — Шив Шакти' },
    note: { en: 'India, 23 Aug 2023', ru: 'Индия, 23.08.2023' } },
  { id: 'slim', group: 'intl', lat: -13.316, lon: 25.251,
    name: { en: 'SLIM — Shioli crater', ru: 'SLIM — кратер Шиоли' },
    note: { en: 'Japan, 19 Jan 2024', ru: 'Япония, 19.01.2024' } },
  { id: 'ce4', group: 'intl', lat: -45.444, lon: 177.588,
    name: { en: "Chang'e-4 — von Kármán (far side)", ru: 'Чанъэ-4 — Карман (обратная сторона)' },
    note: { en: 'China, 2019 — Earth never visible', ru: 'Китай, 2019 — Земля не видна никогда' } },
  { id: 'ce6', group: 'intl', lat: -41.638, lon: -153.985,
    name: { en: "Chang'e-6 — Apollo basin (far side)", ru: 'Чанъэ-6 — бассейн Аполлон (обратная сторона)' },
    note: { en: 'China, 2024', ru: 'Китай, 2024' } },
  { id: 'ce5', group: 'intl', lat: 43.06, lon: -51.92,
    name: { en: "Chang'e-5 — Mons Rümker", ru: 'Чанъэ-5 — гора Рюмкер' },
    note: { en: 'China, 2020', ru: 'Китай, 2020' } },
  // --- Аполлоны ---
  { id: 'a11', group: 'apollo', lat: 0.674, lon: 23.473, name: { en: 'Apollo 11 — Tranquility Base', ru: 'Аполлон-11 — база Спокойствия' }, note: { en: 'USA, 1969', ru: 'США, 1969' } },
  { id: 'a12', group: 'apollo', lat: -3.012, lon: -23.422, name: { en: 'Apollo 12 — Ocean of Storms', ru: 'Аполлон-12 — Океан Бурь' }, note: { en: 'USA, 1969', ru: 'США, 1969' } },
  { id: 'a14', group: 'apollo', lat: -3.645, lon: -17.471, name: { en: 'Apollo 14 — Fra Mauro', ru: 'Аполлон-14 — Фра Мауро' }, note: { en: 'USA, 1971', ru: 'США, 1971' } },
  { id: 'a15', group: 'apollo', lat: 26.132, lon: 3.634, name: { en: 'Apollo 15 — Hadley–Apennine', ru: 'Аполлон-15 — Хэдли–Апеннины' }, note: { en: 'USA, 1971', ru: 'США, 1971' } },
  { id: 'a16', group: 'apollo', lat: -8.973, lon: 15.5, name: { en: 'Apollo 16 — Descartes', ru: 'Аполлон-16 — Декарт' }, note: { en: 'USA, 1972', ru: 'США, 1972' } },
  { id: 'a17', group: 'apollo', lat: 20.191, lon: 30.772, name: { en: 'Apollo 17 — Taurus–Littrow', ru: 'Аполлон-17 — Тавр–Литтров' }, note: { en: 'USA, 1972', ru: 'США, 1972' } },
];

// Настоящие даты и время посадки (UTC) — для кнопки «Повторить реальную миссию»
(function () {
  const LANDED = {
    a11: '1969-07-20T20:17Z', a12: '1969-11-19T06:54Z', a14: '1971-02-05T09:18Z', a15: '1971-07-30T22:16Z',
    a16: '1972-04-21T02:23Z', a17: '1972-12-11T19:54Z', ce4: '2019-01-03T02:26Z', ce5: '2020-12-01T15:11Z',
    ch3: '2023-08-23T12:33Z', slim: '2024-01-19T15:20Z', im1: '2024-02-22T23:23Z', ce6: '2024-06-01T22:23Z',
    bg1: '2025-03-02T08:34Z', im2: '2025-03-06T17:28Z',
  };
  window.SITES.forEach((s) => { if (LANDED[s.id]) s.landed = new Date(LANDED[s.id]); });
})();
