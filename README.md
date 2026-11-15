# Lunar Site Navigator

**NASA Space Apps Challenge 2026 — "Lunar Landing Site Navigator"**

An interactive tool for choosing **where and when** to land near the lunar south pole.
Select any point on the Moon (or one of 18 real and planned landing sites) and a landing date, and the tool shows:

- where the **Sun and Earth** are relative to the real local horizon;
- **power windows** (direct sunlight) and **direct-to-Earth line-of-sight windows** for the next 30 days;
- **time until sunset** and until Earth goes out of sight;
- **terrain**: slope at the site and crater/cliff hazards;
- **eclipses** (Earth covering the Sun as seen from the Moon);
- a clear **preliminary verdict**: suitable / caution / not suitable.

The interface has two modes: **Simple** (plain-language answers for everyone) and **Expert** (all numbers, thresholds, mast height, energy calculator, CSV export).

## How to run
- **Locally:** open `index.html` in Chrome or Edge (a computer with a graphics card is recommended). Everything runs offline except web fonts.
- **Online:** upload the folder to a GitHub repository → *Settings → Pages → Branch `main` → Save*.

## Features
| Feature | Where |
|---|---|
| 3D Moon with NASA relief and colour; click anywhere to analyse | main screen |
| Verdict with checks (slope, hazards, light at landing, time to sunset, sunlight %, Earth visibility %) | right panel |
| Sky panorama with the real horizon, Sun and Earth | *Sky* tab |
| Hourly power and line-of-sight windows for 30 days | *Next 30 days*, *Windows* |
| Sensitivity map: how conditions change within a few km | *Nearby* |
| Launch delay table and best landing dates | *Dates* |
| Sunlight heat map for a whole year | *Year* |
| Side-by-side comparison of up to 3 sites | *Compare* |
| First-person 3D view with descent animation and hazard overlay; "month in 15 s" time-lapse | *3D view* |
| Replay a real mission (sets the actual landing date) | right panel |
| Energy calculator (panel area, efficiency, demand → generation, balance, battery for the longest night) | Expert mode |
| Mission briefing card (PNG) | right panel |
| Open the site in NASA LROC QuickMap | right panel |
| English / Russian interface | header |

## NASA data and methods
| Data | Source | Used for |
|---|---|---|
| South-pole terrain, 80 m (87–90°S) and 240 m (80–87°S) | NASA LRO LOLA `LDEM_80S_80M` | horizon masks, slope, 3D |
| Crater and cliff hazards | NASA LRO LOLA `LDEM_875S_5M` (5 m) aggregated to 80 m cells | hazard check, 3D overlay |
| Global terrain, ~3.8 km | NASA LOLA `ldem_16` (CGI Moon Kit) | horizon outside the pole, 3D Moon |
| Moon colour | NASA LRO LROC (CGI Moon Kit) | 3D Moon |
| Star background | NASA SVS Deep Star Maps | sky |
| Ephemerides | astronomy-engine with the IAU lunar rotation model | Sun and Earth positions |

**Horizon:** for each site a 360° horizon mask is ray-traced through the LOLA terrain, including lunar curvature and observer height.
**Sunlight:** the fraction of the solar disk above the horizon and not covered by Earth; solar flux is scaled by the actual Sun–Moon distance.

## Validation
- Sun and Earth positions agree with **NASA JPL Horizons** to within **0.004°** (21 comparisons).
- **Blue Ghost M1** (landed 2 Mar 2025): the predicted sunset at the site is **16 Mar 2025** — the day the mission ended.
- The **14 Mar 2025** eclipse seen from the Blue Ghost site is reproduced (Earth covers the Sun ≈05:30–09:30 UTC).

## Limitations (stated in the interface)
- This is a **preliminary assessment from orbital data**, not a landing certification.
- Between 80° and 87°S the horizon comes from the 240 m grid (average horizon error ≈1.2°), so percentages there are approximate.
- Mast height is applied only at 87–90°S, where the 80 m terrain is available.
- Boulders smaller than ~5 m are not resolved; landers detect them with onboard hazard detection. In the 3D view, craters smaller than 80 m and rocks are a statistical illustration and are not used in any calculation.
- Earth visibility is a geometric line-of-sight estimate, not a guarantee of a working radio link.
- Solar values are potential irradiance on a Sun-tracking panel; the energy calculator does not include electrical or thermal losses.

## Code
| File | Contents |
|---|---|
| `js/engine.js` | Sun and Earth from a point on the Moon, eclipses, event search |
| `js/terrain.js` | LOLA terrain: height, slope, horizon mask, hazards |
| `js/analysis.js` | site analysis and verdict |
| `js/globe.js`, `js/bodies.js` | 3D Moon, Sun, Earth, sky |
| `js/view3d.js` | first-person 3D view and descent |
| `js/sky.js`, `js/timeline.js` | sky panorama, timeline |
| `js/extras.js`, `js/extras2.js` | Nearby, Dates, Year, Compare, CSV, presentation, briefing, landing history |
| `js/sites.js` | landing sites and real landing dates |
| `js/i18n.js` | English and Russian texts |

## Team
NASA Space Apps Challenge 2026.
