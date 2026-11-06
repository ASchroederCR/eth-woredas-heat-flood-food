# Ethiopia Woredas: Heat, Flooding, and Food Prices (June 2023 →)

Interactive Mapbox map of monthly heat metrics, population and age structure for Ethiopia's
1,148 woredas (OCHA COD-AB admin 3), June 2023 to the present, with El Niño months highlighted, plus
river discharge at the 14 flood gauges OCHA monitors for Ethiopia's flood anticipatory action, and
food prices at 129 World Bank markets lined up with the heat and river flow around them.

**Live map:** https://aschroedercr.github.io/eth-woredas-heat-flood-food/

## Open the map

```bash
python -m http.server 8766 --directory app
```

Then browse to http://localhost:8766. `app/config.js` holds the Mapbox public token (generated from
`../Mapbox_Public_Token.txt`).

## Using the map

- **Single layer** maps one metric in viridis (a "Classic" per-theme palette is in the Colours menu).
  The temperature anomaly keeps a blue–red diverging scale because its sign matters.
- **Heat × population** is a 3×3 bivariate map: each woreda is ranked into thirds on a heat metric
  (cut points fixed across all months) and on a population or age metric. The panel lists the
  woredas in the top third on both for the selected month, ranked by person-days when the heat
  metric is a day count and the population metric is a headcount, and can select them all.
- **Selection:** click a woreda; Shift-click (or tick *Add to selection*) to add more; Shift-drag a
  box on the map; drag a box on the scatter; add a whole zone or region; or search by name. Values
  for several woredas are combined: counts summed, density as total people over total area, and
  everything else population-weighted (LandScan).
- **Forecast:** the *Forecast* layers summarise the Open-Meteo forecast for the days ahead (about 6):
  mean and peak heat, days over the WBGT 28 °C / UTCI 38 °C / 95th-percentile thresholds, and under-5
  and 65+ person-days at WBGT ≥ 28 °C. They also work as the heat axis of the bivariate map and the
  scatter. The *Daily* layers show each of the last three weeks' days and each forecast day, with a
  day slider; their chart shades and dashes the forecast days.
- **Flood gauges:** the 14 GloFAS monitoring points of OCHA's Ethiopia flood anticipatory-action
  project ([OCHA-DAP/ds-aa-eth-flooding](https://github.com/OCHA-DAP/ds-aa-eth-flooding)) on 7 river
  systems (Wabi Shebelle, Genale Dawa, Omo, Bilate, Abaya–Chamo lakes, Baro, Akobo). Each dot is
  coloured and sized by discharge relative to the 2-year flood (RP2) for the chosen month (its peak) or,
  with a Daily layer, the chosen day. Click a gauge, or pick one below the map, for:
  - a daily discharge chart from June 2023 through the 30-day GloFAS ensemble forecast (median, middle
    half, full range), with the 1991–2020 normal range, RP2 and RP5 lines, OCHA's OND trigger level
    (drawn for October–December only, as the trigger applies), and El Niño months shaded;
  - headline numbers: latest vs normal, forecast peak vs RP2 and the trigger, peak since June 2023,
    days at or above RP2, and the share of days at or above RP2 in El Niño vs other months;
  - an overview grid of every gauge × month (monthly peak vs RP2), clickable to jump to a gauge and month;
  - *Select at-risk woredas*: selects the EDRMC riverine zones OCHA links to that river, so the side
    panel shows their combined population, age and heat.
  - **Rivers** (HydroRIVERS): each gauge's channel traced downstream to the sea, a lake or the edge of
    the map, plus its upstream tributaries (catchments over 1,500 km²), with width by mean flow and
    arrows for flow direction. Selecting a gauge highlights its catchment (light orange) and downstream
    path (orange-red); white dots mark where gauged rivers meet. The panel lists upstream and
    downstream gauges with distances along the channel, and *Compare with a connected gauge* overlays
    that gauge's discharge and reports how closely the two move together day to day.
- **Food markets:** the 129 Ethiopian markets in the World Bank Real-Time Food Prices dataset, as
  diamonds coloured by the chosen price measure for the month. Click one, or pick it below the map, for
  three stacked panels on one month axis (each with its own scale, El Niño shaded):
  1. the market's price measure (dots mark months with a survey price; the rest are World Bank estimates);
  2. the chosen monthly heat metric for the woreda the market sits in;
  3. river flow at the nearest gauge whose at-risk zones contain the market (14 markets), as % of
     normal or monthly peak ÷ RP2.
  Price measures: *vs national average* (%), *monthly change vs national* (percentage points, the
  default), *monthly price change* (%), and *year-on-year inflation* (food price index only).
  Commodities: the RTFP food price index, maize, sorghum, wheat, teff, pasta, goats and sheep.
  Below them, **lag charts** show Spearman ρ between heat (or flow) in month *t − lag* and the price
  measure in month *t*, for lags 0–6 months: pooled over all markets (each market's own mean removed)
  and for the selected market. *Survey months only* restricts the test to months with a survey price
  for that commodity.
- **PNG export:** every chart has a *PNG* button, and the map has one under the zoom buttons. Each
  saves a 2× resolution image with the chart's title, subtitle, legend and a source line (plus the
  Mapbox / OpenStreetMap attribution for the map). The map image shows what's switched on: the layer or
  bivariate legend, gauges, rivers and markets. It uses the page's current theme (light or dark).
- **Scatter:** any population/age metric (x, log scale for counts) against any heat metric (y) for
  the selected month, with Spearman ρ. In bivariate mode its dots take the map colours and show the
  tercile cut lines.

## Pipeline

| Step | Command | What it does |
|---|---|---|
| 1 | `python prepare_projects.py` | Splits the woredas into 6 HeatReady projects that fit the API's 1,500-polygon / 50 sq° bbox limits. Polygon `name` = admin3 pcode. |
| 2 | `python heat_api.py create` | Creates the projects (already done: `eth-woreda-heat-1-as2026` … `-6-as2026`). |
| 3 | `python heat_api.py backfill` | Extends every project back to 2023-06-01, 30 days per call, one call at a time. |
| 4 | `python heat_api.py download` | Pulls daily rows month by month into `build/raw/<project>/<YYYY-MM>.jsonl` as backfill covers each month. Run alongside step 3. |
| 5 | `python heat_api.py vuln` | Pulls vulnerability layers (WorldPop age structure, etc.) per woreda. |
| 5b | `python heat_api.py forecast` | Replaces `build/forecast/<project>.jsonl` with the forecast days now on the server (refreshed by the API about 06:00 UTC daily). |
| — | `compute-wmo-reference` (API action, run once per project) | Builds the 2016–2025 climatology behind the `ref_*` columns, used for the anomaly layers. Months downloaded before it finished must be re-pulled (delete their `.jsonl`). |
| 6 | `python build_map_data.py` | Aggregates to monthly woreda metrics, adds ONI El Niño flags (`build/oni.ascii.txt` from NOAA CPC), writes `app/data/*.js`. |
| 7 | `python flood_gauges.py all` | Gauges and OND trigger levels from OCHA's published dashboard; GloFAS v4 daily discharge (1984–present) and the 30-day ensemble forecast from the Open-Meteo Flood API; writes `app/data/flood.js`. Run after step 6 (it uses the map's months). `cells` matches each gauge to its Open-Meteo grid cell once (cached in `build/flood/cells.json`). |
| 8 | `python food_prices.py all` | Downloads the World Bank RTFP market-level file (136 MB zip, all countries) into `build/food/`, keeps Ethiopia (`eth_rtfp_mkt.csv`), links each market to its woreda (point in polygon) and to a flood gauge, and writes `app/data/food.js`. Run after step 7. `build` alone reuses the downloaded file. |
| 9 | `python rivers.py download` then `python rivers.py build` | HydroRIVERS v1.0 Africa (108 MB zip) into `build/rivers/`; snaps each gauge to its channel, traces paths and confluences, writes `app/data/rivers.js`. Run after step 7. Static: rerun only if the gauges change. |

Each step is resumable. To refresh later: `python heat_api.py download final` (re-pulls the two
latest months, whose provisional Open-Meteo days get replaced by ERA5), `python heat_api.py forecast`,
download a fresh `oni.ascii.txt`, then rerun step 6. For a daily forecast update alone, `forecast`
then step 6 is enough (about 2 minutes).

### Automatic daily refresh

`refresh_daily.ps1` runs `download final`, `forecast`, steps 6 and 7, and `food_prices.py build` (no
download) in turn, then publishes `app/` to GitHub Pages (about 7 minutes in all), and logs
to `build/logs/refresh.log`. The build also stamps the `data.js?v=` URL in `index.html`, so a plain
reload of the map shows the new data. It is registered as the Windows scheduled task
**Ethiopia woreda heat refresh**: daily at 07:30 local time (after the API's ~06:00 UTC forecast
update). If the PC is off or asleep then, it runs at the next chance. It runs only while you are
logged on. The ONI file and the World Bank price file are not refreshed automatically: when a new RTFP
release appears in microdata catalog 4483, update `URL` in `food_prices.py` and run `python food_prices.py download`.

```powershell
Start-ScheduledTask -TaskName 'Ethiopia woreda heat refresh'        # run now
Get-ScheduledTaskInfo -TaskName 'Ethiopia woreda heat refresh'      # last result (0 = OK), next run
Unregister-ScheduledTask -TaskName 'Ethiopia woreda heat refresh'   # remove it
```

### Publishing

The public site is the `app/` folder, served by GitHub Pages from the `gh-pages` branch.
`publish_pages.ps1` pushes the current `app/` there as a single commit with no history (force push),
so daily data doesn't accumulate in the repository; it skips the push if `app/` hasn't changed. The
daily refresh runs it after a successful build (a failed build step leaves the live site as it was).
To publish by hand:

```powershell
powershell -File publish_pages.ps1
```

`main` holds the code and a snapshot of `app/` from the last commit; the live data is on `gh-pages`.
Commit code changes to `main` as usual.

`app/config.js` carries the Mapbox *public* token; restrict it to the Pages URL in the Mapbox
account (Tokens → URL restrictions). The HeatReady credentials stay in `../heat_api_key.txt`, outside
the repository.

## Metrics

- **Heat (monthly, per woreda):** mean daily max temperature, mean night-time low, mean daily max
  WBGT, mean daytime max UTCI, peak heat index (°C), days with WBGT ≥ 28 °C, days with UTCI ≥ 38 °C,
  hot nights (min ≥ 25 °C). When the API's 2016–2025 reference climatology is filled in, the
  anomaly vs normal and days above the 95th percentile appear too.
- **Population:** LandScan Global 2024, and density from the OCHA woreda area.
- **Age:** WorldPop R2025A share and count under 5 and 65+, old-age dependency ratio.
- **Exposure:** WorldPop under-5 / 65+ counts × days with WBGT ≥ 28 °C.

The national line in the chart is population-weighted (LandScan). Exposure is summed instead.

## Flood gauges

- **Discharge:** GloFAS v4 (Copernicus EMS), the same version OCHA's dashboard and trigger use, served
  by the Open-Meteo Flood API on the 0.05° grid. Open-Meteo's nearest-cell lookup can fall on a dry
  cell beside the channel, so each gauge uses the neighbouring cell whose last 30 days best match OCHA's
  published values: within 0.1–3.4 % for 13 gauges, 7.3 % for Baro at Itang.
- **RP2 / RP5:** Gumbel (method of moments) fit to the 1984–2025 annual maxima at each cell. These are
  annual levels; OCHA's trigger work shows Gu and Deyr floods need seasonal thresholds, which is why
  their **OND trigger** (3rd-largest OND season on 2003–2025 reanalysis, adjusted for a 1-in-3 overall
  activation rate) is drawn separately for October–December.
- **Normal:** 10th, 50th and 90th percentiles of 1991–2020 daily discharge within ±7 days of the date.
- Genale/Juba at Dolow sits on the Somalia border and has no woreda of its own; its at-risk zones are
  still selectable.
- **Rivers:** HydroRIVERS (HydroSHEDS 15 arc-second network) is a different model grid from GloFAS, so
  each gauge is snapped to the HydroRIVERS reach within 25 km that best matches its GloFAS mean flow,
  favouring nearby channels (all within 2 km except Gode, Genale upper, Dolow, Omo: 4–7 km). Mean flows
  differ between the two models (HydroRIVERS is often ~half of GloFAS here). The Abaya–Chamo point is a
  GloFAS lake cell; HydroRIVERS has only a small stream there, so its lines are indicative. Traced links:
  Shabelle upstream → mid (161 km) → lower (46 km) → Gode (68 km) → border (1 km); Genale upper (378 km),
  Webe Gestro (79 km) and Dawa (231 km) → Dolow; Akobo meets the Baro 104 km downstream (the Sobat).
- **Upstream–downstream agreement:** GloFAS daily values at these points rise and fall on the same day
  even 1,000 km apart (day-to-day changes correlate 0.9 at no lag, 0.5 by day 2), so they can't give
  river travel times. The comparison card reports the correlation and the best lag, not a travel time.
- GloFAS v4 is known to under-represent the Wabi Shebelle: it misses the 2023 Deyr floods at Gode
  (noted in OCHA's README; v5 fixes it but isn't operational yet). Treat the Shabelle gauges with care.

## Rivers

HydroRIVERS v1.0, Lehner, B. & Grill, G. (2013), *Hydrological Processes* 27(15): 2171–2186,
www.hydrosheds.org, CC-BY 4.0.

## Food prices

- **Source:** World Bank Real-Time Food Prices, market level (release `WLD_RTFP_mkt_2026-10-05`),
  monthly to October 2026. RTFP fills months without a survey with modelled estimates; the map uses the
  monthly close estimate (`c_*`) and marks surveyed months. 42 % of the 129 markets × 42 months have a
  survey price for at least one commodity; for teff and sorghum it is far fewer, so their survey-only
  tests are thin.
- **Why "vs national":** Ethiopia's food price index rose ~49 % year on year by October 2026 after the
  2024 birr float. Dividing each market by the RTFP *Market Average* removes those nationwide moves and
  leaves the local signal that local heat or flooding could plausibly drive. Year-on-year inflation is
  dominated by the national trend; its lag result mostly reflects heat anomalies and inflation both
  rising over 2025–26, not a local effect.
- **Linking:** each market is placed in the woreda containing its coordinates (nearest woreda if just
  outside), and takes that woreda's heat. It takes river flow from the nearest gauge whose river's
  EDRMC at-risk zones contain that woreda.
- **Reading the lag charts:** the pooled test treats market-months as independent, but neighbouring
  markets and consecutive months are correlated (and modelled prices are smoothed), so the faded/solid
  cut-off (|ρ| > 1.96/√n) overstates significance; picking the strongest of 7 lags adds to that. Treat
  results as exploratory. In the October 2026 release, monthly change vs national, max temp vs normal:
  maize ρ ≈ +0.11–0.12 and wheat ≈ +0.09–0.19 at a 2–4-month lag (both with all months and survey-only),
  goats ≈ −0.10 to −0.16 at 4 months; the food price index as a whole shows nothing (|ρ| ≤ 0.03).
  Higher river flow goes with relatively higher goat prices 4–5 months later (ρ ≈ +0.15–0.30) at the
  14 gauge-linked markets.

## El Niño

From NOAA CPC's Oceanic Niño Index: a month is El Niño when its centred 3-month ONI season is part
of a run of ≥ 5 seasons at ≥ +0.5 °C. A run still open at the end of the record with ≥ 3 seasons
is shown as *provisional* and carried to the latest mapped month.

## Caveats

- ERA5-Land is ~9 km. Small woredas share grid-cell values, and heat is the uncorrected base (no
  neighbourhood downscaling for backfilled days).
- The most recent ~10 days come from Open-Meteo and can change when ERA5 catches up. A backfill
  chunk that hit an ERA5 outage is permanently Open-Meteo. The chart tooltip flags months that are
  mostly Open-Meteo.
- A trailing month with fewer than 20 days of data is left off the map.
- Forecast layers are a weather forecast, not observations: skill drops with lead time, and the
  values are the uncorrected Open-Meteo grid. They go stale after a day; refresh as above.
