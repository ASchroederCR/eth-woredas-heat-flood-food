/* Ethiopia woreda heat explorer: Mapbox choropleth or heat × population bivariate map,
   time series with El Niño bands, heat vs population scatter, multi-woreda aggregation. */
(() => {
  const D = window.DATA, G = window.GEO;
  const M = D.metrics, months = D.months, n = D.woredas.length;
  const VIRIDIS = ['#440154', '#443983', '#31688e', '#21918c', '#35b779', '#90d743', '#fde725'];
  const CLASSIC = {
    Heat: ['#fde3d3', '#f9c2a3', '#f39d73', '#eb6834', '#c94f1f', '#9c3b16', '#6e2a10'],
    Exposure: ['#fde3d3', '#f9c2a3', '#f39d73', '#eb6834', '#c94f1f', '#9c3b16', '#6e2a10'],
    Population: ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'],
    Age: ['#e4e0fa', '#c6bef3', '#a297ea', '#7f6fe0', '#6250d6', '#4a3aa7', '#2f2470'],
  };
  CLASSIC.Forecast = CLASSIC.Daily = CLASSIC.Heat;
  CLASSIC.Rainfall = ['#e0f3ef', '#b3e2d6', '#7fcdbb', '#41b6c4', '#1d91c0', '#225ea8', '#0c2c84'];
  // rainfall vs normal: brown (drier) through a neutral middle (80-120%) to green (wetter)
  // percentile classes (driest 10% ... wettest 10%): five steps of the same brown-green scale
  const RANK5 = ['#a6611a', '#dfc27d', '#f0efec', '#80cdc1', '#018571'];
  const BRBG = ['#8c510a', '#d8b365', '#f6e8c3', '#f0efec', '#c7eae5', '#5ab4ac', '#01665e'];
  // Anomalies keep a diverging ramp in both schemes: the sign (above/below normal) is the point.
  const DIVERGING = ['#1c5cab', '#6da7ec', '#b7d3f6', '#f0efec', '#f4b8b7', '#e66767', '#b22b2b'];
  // Bivariate 3×3 (J. Stevens): BIV[populationClass][heatClass]; heat runs to red, population to blue, both to dark.
  const BIV = [
    ['#e8e8e8', '#e4acac', '#c85a5a'],
    ['#b0d5df', '#ad9ea5', '#985356'],
    ['#64acbe', '#627f8c', '#574249'],
  ];
  const TERCILE = ['Low', 'Mid', 'High'];
  const MONTH_FMT = new Intl.DateTimeFormat('en', { month: 'short', year: 'numeric', timeZone: 'UTC' });
  const monthName = (m) => MONTH_FMT.format(new Date(m + '-01T00:00:00Z'));
  const DAY_FMT = new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const WDAY_FMT = new Intl.DateTimeFormat('en', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const dayName = (d, long = false) => (long ? WDAY_FMT : DAY_FMT).format(new Date(d + 'T00:00:00Z'));

  // Daily layers (recent observed days, then the forecast days) join M as dy_* with daily: true.
  const DY = D.daily || { days: [], fc_start: 0, metrics: {} };
  const days = DY.days, hasFc = DY.fc_start < days.length;
  const isFcDay = (d) => d >= DY.fc_start;
  const FC_SPAN = hasFc ? `${dayName(days[DY.fc_start])} – ${dayName(days[days.length - 1])}` : '';
  for (const [k, s] of Object.entries(DY.metrics)) {
    M['dy_' + k] = { ...s, group: 'Daily', daily: true, temporal: false,
      desc: `${s.label} each day, ${dayName(days[0])} – ${dayName(days[days.length - 1])}; days from ${FC_SPAN.split(' – ')[0]} are the Open-Meteo forecast` };
  }
  // CHIRPS v3 rainfall: per dekad (dk_*, dekadal: true, own slider) and monthly totals on the month slider
  const RN = window.RAIN || null;
  const dekads = RN ? RN.dekads : [];
  const DEK_MON = new Intl.DateTimeFormat('en', { month: 'short', timeZone: 'UTC' });
  function dekName(k, long = false) {
    const [y, m, d] = k.split('.').map(Number);
    const end = d < 3 ? d * 10 : new Date(Date.UTC(y, m, 0)).getUTCDate();
    return `${(d - 1) * 10 + 1}–${end} ${DEK_MON.format(new Date(Date.UTC(y, m - 1, 1)))}${long ? ' ' + y : ''}`;
  }
  const dekMonth = (k) => k.slice(0, 7).replace('.', '-');
  const dekIdx = new Map(dekads.map((k, j) => [k, j]));
  const dekOfDay = (d) => dekIdx.get(`${d.slice(0, 4)}.${d.slice(5, 7)}.${+d.slice(8, 10) <= 10 ? 1 : +d.slice(8, 10) <= 20 ? 2 : 3}`);
  const monthIdx = new Map(months.map((m, t) => [m, t]));
  const PRE0 = RN ? (RN.prelim.indexOf(true) < 0 ? dekads.length : RN.prelim.indexOf(true)) : 0;   // first preliminary dekad
  const isPre = (j) => j >= PRE0;
  const RAIN_KEYS = [];
  if (RN && dekads.length) {
    const span = `${dekName(dekads[0], true)} – ${dekName(dekads[dekads.length - 1], true)}`;
    const clim = RN.clim.replace('-', '–');
    const nPre = RN.prelim.filter(Boolean).length;
    const preNote = nPre ? ` The last ${nPre === 1 ? 'dekad is' : `${nPre} dekads are`} CHIRPS preliminary data, replaced as the final product arrives.` : '';
    const rankDesc = (per) => `How this ${per}'s rainfall ranks against the same ${per} in each year ${clim}, as a percentile ` +
      '(50 = a typical year). Classes: driest 10%, below normal (lowest third), near normal (middle third), above normal, wettest 10%. ';
    const pctDesc = (per) => `Rainfall as a share of the ${clim} average for the same ${per}. Rainfall is skewed (a few very wet years ` +
      `raise the average), so a typical ${per} comes in under 100%: the percentile layer is the fairer guide to "normal". `;
    const add = {
      dk_mm: { label: 'Rainfall per dekad', unit: 'mm', dekadal: true, values: RN.woreda.mm, breaks: [1, 10, 25, 50, 100, 150],
        desc: `CHIRPS v3 rainfall total for each 10-day period (dekad), ${span}; area mean over the woreda.` + preNote },
      dk_rank: { label: 'Dekad rainfall vs normal', unit: 'percentile', dekadal: true, values: RN.woreda.rank, breaks: [10, 33.4, 66.7, 90], ramp: RANK5, ref: 50,
        refLabel: `median year (${clim})`, desc: rankDesc('dekad') + 'Blank where the dekad is normally dry (under 2 mm).' + preNote },
      dk_pct: { label: 'Dekad rainfall vs average', unit: '%', dekadal: true, values: RN.woreda.pct, breaks: [25, 50, 80, 120, 150, 200], ramp: BRBG, ref: 100,
        refLabel: `${clim} average`, desc: pctDesc('dekad') + 'Blank where the dekad is normally dry (under 2 mm).' + preNote },
      rain_mm: { label: 'Monthly rainfall', unit: 'mm', temporal: true, values: RN.monthly.mm, breaks: [5, 25, 50, 100, 200, 300],
        desc: 'CHIRPS v3 rainfall total for the month (its three dekads); area mean over the woreda. Blank for months not yet complete.' },
      rain_rank: { label: 'Monthly rainfall vs normal', unit: 'percentile', temporal: true, values: RN.monthly.rank, breaks: [10, 33.4, 66.7, 90], ramp: RANK5, ref: 50,
        refLabel: `median year (${clim})`, desc: rankDesc('month') + 'Blank where the month is normally dry (under 5 mm).' },
      rain_pct: { label: 'Monthly rainfall vs average', unit: '%', temporal: true, values: RN.monthly.pct, breaks: [25, 50, 80, 120, 150, 200], ramp: BRBG, ref: 100,
        refLabel: `${clim} average`, desc: pctDesc('month') + 'Blank where the month is normally dry (under 5 mm).' },
    };
    for (const [k, v] of Object.entries(add)) { M[k] = { ...v, group: 'Rainfall' }; RAIN_KEYS.push(k); }
  }
  const GROUP_LABEL = {
    Forecast: `Forecast · ${FC_SPAN}`,
    Daily: 'Daily · last 3 weeks + forecast',
    Rainfall: 'Rainfall · CHIRPS v3',
  };
  const keys = Object.keys(M);
  const isFcSummary = (k) => M[k].group === 'Forecast';
  // heat axis: monthly heat, forecast summaries (not the exposure products) and daily values
  const HEAT_KEYS = keys.filter((k) => M[k].group === 'Heat' || M[k].daily || (isFcSummary(k) && M[k].unit !== 'person-days'));
  const POP_KEYS = keys.filter((k) => M[k].group === 'Population' || M[k].group === 'Age');
  // the daily series behind each forecast summary, used for the chart
  const FC_BASE = {
    fc_tmax: 'dy_tmax', fc_wbgt: 'dy_wbgt', fc_hi: 'dy_hi', fc_anom: 'dy_tmax_anom', fc_d_wbgt28: 'dy_wbgt',
    fc_d_utci38: 'dy_utci', fc_d_p95: 'dy_tmax', fc_exp_u5: 'dy_wbgt', fc_exp_65: 'dy_wbgt',
  };
  const pick1 = (...ks) => ks.find((k) => M[k]);

  const state = {
    mode: 'single',
    scheme: 'viridis',
    metric: pick1('tmax', keys[0]),
    lastTemporal: pick1('tmax', keys.find((k) => M[k].temporal)),
    x: pick1('pop_65', 'pop', POP_KEYS[0]),       // population / age axis (bivariate + scatter)
    y: pick1('d_wbgt28', 'wbgt', HEAT_KEYS[0]),   // heat axis (bivariate + scatter)
    xLog: true,
    t: months.length - 1,
    d: hasFc ? DY.fc_start : Math.max(0, days.length - 1),
    k: Math.max(0, dekads.length - 1),   // dekad index for the rainfall dekad layers
    sel: [],
    hover: null,
    playing: null,
  };

  // ---------- formatting ----------
  const isCount = (key) => ['people', 'person-days', 'per km²'].includes(M[key].unit);
  function fmt(v, key) {
    if (v === null || v === undefined || Number.isNaN(v)) return '—';
    const u = M[key].unit;
    if (u === 'people' || u === 'person-days') return Math.round(v).toLocaleString('en');
    if (u === 'days') return (Math.round(v * 10) / 10).toLocaleString('en');
    if (u === '') return v.toFixed(2);
    if (u === 'percentile' || (u === '%' && M[key].ref)) return Math.round(v) + '';
    const s = (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1));
    return (M[key].diverging && v > 0 ? '+' : '') + s;
  }
  const withUnit = (v, key) => {
    const u = M[key].unit;
    const s = fmt(v, key);
    if (s === '—' || !u) return s;
    if (u === 'days' && s === '1') return '1 day';
    if (u === '%' && M[key].ref) return s + '%';
    if (u === 'percentile') return ordinal(Math.round(v)) + ' percentile';
    return s + ' ' + u;
  };
  const ordinal = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
  function compact(v) {
    const a = Math.abs(v);
    if (a >= 1e6) return +(v / 1e6).toFixed(a >= 1e7 ? 0 : 1) + 'M';
    if (a >= 1e3) return +(v / 1e3).toFixed(a >= 1e4 ? 0 : 1) + 'k';
    return +v.toFixed(2) + '';
  }
  // t indexes months for monthly layers and days for daily ones; it defaults to the current one.
  function valueAt(key, i, t) {
    const s = M[key];
    if (s.temporal) return s.values[t ?? state.t][i];
    if (s.daily) return s.values[t ?? state.d][i];
    if (s.dekadal) return s.values[t ?? state.k][i];
    return s.values[i];
  }
  function periodOf(key) {
    const s = M[key];
    if (s.temporal) return monthName(months[state.t]);
    if (s.daily) return dayName(days[state.d]) + (isFcDay(state.d) ? ' (forecast)' : '');
    if (s.dekadal) return dekName(dekads[state.k], true);
    if (isFcSummary(key)) return `forecast ${FC_SPAN}`;
    return '';
  }
  const unitSuffix = (key) => (M[key].unit && M[key].unit !== 'people' ? ` (${M[key].unit})` : '');
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ---------- aggregation over a set of woredas ----------
  // Counts are summed; density is total people over total area; everything else is a
  // LandScan population-weighted mean (unweighted if no woreda in the set has population).
  const POP = M.pop ? M.pop.values : new Array(n).fill(null);
  function aggregate(key, idx, t) {
    if (key === 'density') {
      let p = 0, a = 0;
      for (const i of idx) {
        const d = valueAt('density', i), pp = POP[i];
        if (d > 0 && pp > 0) { p += pp; a += pp / d; }
      }
      return a ? p / a : null;
    }
    const sum = M[key].unit === 'people' || M[key].unit === 'person-days';
    let s = 0, w = 0, plain = 0, cnt = 0;
    for (const i of idx) {
      const v = valueAt(key, i, t);
      if (v === null || v === undefined) continue;
      cnt++; plain += v;
      const wt = POP[i] > 0 ? POP[i] : 0;
      s += v * wt; w += wt;
    }
    if (!cnt) return null;
    if (sum) return plain;
    return w ? s / w : plain / cnt;
  }
  {
    const all = [...Array(n).keys()];
    for (const k of RAIN_KEYS) M[k].national = M[k].values.map((_, t) => aggregate(k, all, t));
  }

  // ---------- class breaks (fixed across all months so time steps compare) ----------
  const sortedCache = {};
  function sortedValues(key) {
    if (!sortedCache[key]) {
      const spec = M[key];
      sortedCache[key] = (spec.temporal || spec.daily || spec.dekadal ? spec.values.flat() : spec.values).filter((v) => v !== null).sort((a, b) => a - b);
    }
    return sortedCache[key];
  }
  const quant = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(p * arr.length))];
  const breaksCache = {};
  function breaks(key) {
    if (breaksCache[key]) return breaksCache[key];
    if (M[key].breaks) return (breaksCache[key] = M[key].breaks);
    const spec = M[key], all = sortedValues(key);
    let b;
    if (spec.diverging) {
      const lim = Math.max(Math.abs(quant(all, 0.03)), Math.abs(quant(all, 0.97)));
      const s = lim / 3.5;
      b = [-2.5, -1.5, -0.5, 0.5, 1.5, 2.5].map((k) => +(k * s).toFixed(2));
    } else if (spec.unit === 'days') {
      const nz = all.filter((v) => v > 0);
      b = nz.length ? [0.5, ...[0.2, 0.4, 0.6, 0.8, 0.95].map((p) => Math.max(1, Math.round(quant(nz, p))))] : [0.5];
    } else if (all.length && all[0] >= 0 && quant(all, 1 / 7) <= 0) {
      // mostly zeros (e.g. exposure person-days): a "none" class, then sevenths... of the non-zero values
      const nz = all.filter((v) => v > 0);
      b = nz.length ? [0.5, ...[0.2, 0.4, 0.6, 0.8, 0.95].map((p) => quant(nz, p))] : [0.5];
    } else {
      b = [1, 2, 3, 4, 5, 6].map((k) => quant(all, k / 7));
    }
    b = b.map((x) => niceRound(x, spec)).filter((x, i, a) => i === 0 || x > a[i - 1]);
    breaksCache[key] = b;
    return b;
  }
  function niceRound(x, spec) {
    if (spec.unit === 'people' || spec.unit === 'person-days' || spec.unit === 'per km²') {
      if (x < 10) return Math.round(x * 10) / 10;
      const mag = Math.pow(10, Math.floor(Math.log10(x)) - 1);
      return Math.round(x / mag) * mag;
    }
    if (spec.unit === '') return Math.round(x * 1000) / 1000;
    if (spec.unit === 'days') return x;
    return Math.round(x * 10) / 10;
  }
  // Tercile cut points [a, b]: low < a ≤ mid < b ≤ high. Day counts with many zeros use
  // "no days" as the low class and split the rest at their median.
  const terCache = {};
  function terciles(key) {
    if (terCache[key]) return terCache[key];
    const spec = M[key], all = sortedValues(key);
    let a = quant(all, 1 / 3), b = quant(all, 2 / 3);
    if (spec.unit === 'days' && a <= 0) {
      const nz = all.filter((v) => v > 0);
      a = 0.5; b = Math.max(2, Math.round(quant(nz, 0.5)));
    } else {
      a = niceRound(a, spec); b = niceRound(b, spec);
      if (b <= a) b = all.find((v) => v > a) ?? a + 1;
    }
    return (terCache[key] = [a, b]);
  }
  const tercile = (v, [a, b]) => (v === null || v === undefined ? null : v < a ? 0 : v < b ? 1 : 2);
  function bivClass(i, t = state.t) {
    const h = tercile(valueAt(state.y, i, t), terciles(state.y));
    const p = tercile(valueAt(state.x, i), terciles(state.x));
    return h === null || p === null ? null : p * 3 + h;
  }
  const bivColor = (c) => BIV[Math.floor(c / 3)][c % 3];
  function tercileLabels(key) {
    const [a, b] = terciles(key);
    const f = (v) => (isCount(key) ? compact(v) : fmt(v, key));
    if (M[key].unit === 'days' && a === 0.5) return ['0', `1–${b - 1}`, `≥ ${b}`];
    return [`< ${f(a)}`, `${f(a)}–${f(b)}`, `≥ ${f(b)}`];
  }

  const rampFor = (key) => M[key].ramp || (M[key].diverging ? DIVERGING : state.scheme === 'viridis' ? VIRIDIS : CLASSIC[M[key].group]);
  const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  function colorExpr(key) {
    const b = breaks(key), ramp = rampFor(key).slice(-(b.length + 1));
    const step = ['step', ['feature-state', 'v'], ramp[0]];
    b.forEach((x, i) => step.push(x, ramp[i + 1]));
    return ['case', ['==', ['typeof', ['feature-state', 'v']], 'number'], step, cssVar('--nodata')];
  }
  function bivExpr() {
    const m = ['match', ['coalesce', ['feature-state', 'b'], -1]];
    for (let c = 0; c < 9; c++) m.push(c, bivColor(c));
    m.push(cssVar('--nodata'));
    return m;
  }

  // ---------- controls ----------
  const $ = (id) => document.getElementById(id);
  const metricSel = $('metric');
  function fillGrouped(selEl, ks) {
    const groups = {};
    for (const k of ks) {
      const g = M[k].group;
      if (!groups[g]) {
        groups[g] = document.createElement('optgroup');
        groups[g].label = GROUP_LABEL[g] || g;
        selEl.appendChild(groups[g]);
      }
      groups[g].appendChild(new Option(M[k].label + unitSuffix(k), k));
    }
  }
  fillGrouped(metricSel, keys);
  metricSel.value = state.metric;
  metricSel.addEventListener('change', () => setMetric(metricSel.value));

  // The bivariate map and the scatter share one heat axis (y) and one population axis (x).
  const axisSels = [$('biX'), $('biY'), $('sX'), $('sY')];
  for (const s of axisSels) {
    fillGrouped(s, s.dataset.axis === 'x' ? POP_KEYS : HEAT_KEYS);
    s.addEventListener('change', () => setAxis(s.dataset.axis, s.value));
  }
  const sLog = $('sLog');
  sLog.addEventListener('change', () => { state.xLog = sLog.checked; renderScatter(); });

  const schemeSel = $('scheme');
  schemeSel.addEventListener('change', () => {
    state.scheme = schemeSel.value;
    try { localStorage.setItem('eth-heat-scheme', state.scheme); } catch (e) { /* ignore */ }
    renderLegend(); paint();
  });
  try { const s = localStorage.getItem('eth-heat-scheme'); if (s === 'classic' || s === 'viridis') state.scheme = s; } catch (e) { /* ignore */ }
  schemeSel.value = state.scheme;

  for (const b of document.querySelectorAll('.seg button')) b.addEventListener('click', () => setMode(b.dataset.mode));

  const slider = $('slider');
  slider.max = months.length - 1;
  slider.value = state.t;
  slider.addEventListener('input', () => setMonth(+slider.value));
  $('playBtn').addEventListener('click', () => togglePlay('month'));
  const dekSlider = $('dekSlider');
  dekSlider.max = Math.max(0, dekads.length - 1);
  dekSlider.value = state.k;
  dekSlider.addEventListener('input', () => setDekad(+dekSlider.value));
  $('dekPlay').addEventListener('click', () => togglePlay('dek'));
  const daySlider = $('daySlider');
  daySlider.max = Math.max(0, days.length - 1);
  daySlider.value = state.d;
  daySlider.addEventListener('input', () => setDay(+daySlider.value));

  $('coverage').textContent =
    `${n.toLocaleString('en')} woredas · monthly, ${monthName(months[0])} – ${monthName(months[months.length - 1])}` +
    ` · daily data ${D.first_date} to ${D.last_date}` +
    (hasFc ? ` · forecast to ${dayName(days[days.length - 1])}` : '') +
    (dekads.length ? ` · rainfall by dekad to ${dekName(dekads[dekads.length - 1], true)}` : '');

  // woreda search (names repeat across zones, so the option text carries zone and region)
  const findText = D.woredas.map((w) => `${w.name} — ${w.zone}, ${w.region}`);
  const byText = new Map(findText.map((s, i) => [s, i]));
  $('woredaList').innerHTML = findText.map((s) => `<option value="${esc(s)}"></option>`).join('');
  const addMode = $('addMode');
  $('find').addEventListener('change', (e) => {
    const i = byText.get(e.target.value);
    if (i === undefined) return;
    pick(i, addMode.checked, true);
    e.target.value = '';
  });

  const AXES = {
    month: { btn: 'playBtn', len: () => months.length, get: () => state.t, set: (v) => setMonth(v), ms: 700 },
    dek: { btn: 'dekPlay', len: () => dekads.length, get: () => state.k, set: (v) => setDekad(v), ms: 450 },
  };
  function togglePlay(ax) {
    if (state.playing) {
      clearInterval(state.playing); state.playing = null;
      for (const a of Object.values(AXES)) { $(a.btn).textContent = '▶'; $(a.btn).ariaLabel = 'Play'; }
      return;
    }
    const A = AXES[ax];
    if (A.get() >= A.len() - 1) A.set(0);
    $(A.btn).textContent = '❚❚'; $(A.btn).ariaLabel = 'Pause';
    state.playing = setInterval(() => {
      if (A.get() >= A.len() - 1) return togglePlay(ax);
      A.set(A.get() + 1);
    }, A.ms);
  }

  // The key the map is coloured by (its heat axis in bivariate mode), and the series the chart shows.
  const mapKey = () => (state.mode === 'bi' ? state.y : state.metric);
  const seriesFor = (k) => (M[k].temporal || M[k].daily || M[k].dekadal ? k : M[FC_BASE[k]] ? FC_BASE[k] : null);
  const chartKey = () => seriesFor(mapKey()) || state.lastTemporal;
  function syncTimeCtl() {
    const s = M[mapKey()];
    $('dayCtl').hidden = !s.daily;
    $('dekCtl').hidden = !s.dekadal;
    $('timeCtl').hidden = !!(s.daily || s.dekadal);
    $('timeCtl').style.opacity = s.temporal ? 1 : 0.45;
    const note = $('staticNote');
    note.hidden = s.temporal || s.daily || s.dekadal;
    note.textContent = isFcSummary(mapKey())
      ? `Summary of the Open-Meteo forecast for ${FC_SPAN} (issued ${DY.issued ? DY.issued.slice(0, 10) : '—'}). The chart below shows the daily values behind it.`
      : "This layer doesn't change over time. The chart below shows the heat metric you last picked.";
  }
  function setMode(mode) {
    state.mode = mode;
    for (const b of document.querySelectorAll('.seg button')) b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
    $('singleCtl').hidden = mode !== 'single';
    $('biCtl').hidden = mode !== 'bi';
    syncTimeCtl();
    renderLegend(); paint(); renderBiv(); renderChart(); renderScatter();
  }
  function setMetric(key) {
    state.metric = key;
    metricSel.value = key;
    if (seriesFor(key)) state.lastTemporal = seriesFor(key);
    $('metricDesc').textContent = M[key].desc;
    syncTimeCtl();
    renderLegend(); paint(); renderDetail(); renderChart();
    if (fl) { paintGauges(); renderFlood(); }
    if (fp) { paintMarkets(); renderFood(); }
  }
  function setAxis(axis, key) {
    state[axis] = key;
    for (const s of axisSels) if (s.dataset.axis === axis) s.value = key;
    if (axis === 'x') { state.xLog = isCount(key); sLog.checked = state.xLog; }
    if (state.mode === 'bi') { syncTimeCtl(); paint(); renderChart(); }
    renderBiv(); renderScatter();
  }
  function setMonth(t) {
    state.t = t;
    slider.value = t;
    $('monthLabel').textContent = monthName(months[t]);
    const badge = $('ensoBadge');
    badge.hidden = !D.enso.elnino[t];
    badge.textContent = D.enso.provisional[t] ? 'El Niño (provisional)' : 'El Niño';
    if (M[mapKey()].temporal) paint();
    renderBiv(); renderDetail(); renderChart(); renderScatter();
    if (fl) { paintGauges(); renderFlood(); }
    if (fp) { paintMarkets(); renderFood(); }
  }
  function setDekad(k) {
    if (!dekads.length) return;
    state.k = k;
    dekSlider.value = k;
    $('dekLabel').textContent = dekName(dekads[k], true);
    $('dekPre').hidden = !isPre(k);
    const t = monthIdx.get(dekMonth(dekads[k]));
    $('dekBadge').hidden = !(t !== undefined && D.enso.elnino[t]);
    if (M[mapKey()].dekadal) paint();
    renderDetail(); renderChart();
    if (fl) { paintGauges(); renderFlood(); }
  }
  function setDay(d) {
    if (!days.length) return;
    state.d = d;
    daySlider.value = d;
    $('dayLabel').textContent = dayName(days[d], true);
    $('fcBadge').hidden = !isFcDay(d);
    if (M[mapKey()].daily) paint();
    renderBiv(); renderDetail(); renderChart(); renderScatter();
    if (fl) { paintGauges(); renderFlood(); }
    if (fp) { paintMarkets(); renderFood(); }
  }

  function renderLegend() {
    const key = state.metric, b = breaks(key), ramp = rampFor(key).slice(-(b.length + 1));
    $('legend').innerHTML =
      `<div class="legBar">${ramp.map((c) => `<span style="background:${c}"></span>`).join('')}</div>` +
      `<div class="legTicks"><span></span>${b.map((x) => `<span>${fmt(x, key)}</span>`).join('')}<span></span></div>` +
      `<div class="legNo"><i></i>No data${M[key].unit ? ` · units: ${M[key].unit}` : ''}</div>`;
  }

  // Bivariate legend plus the woredas that are high on both axes this month.
  function renderBiv() {
    if (state.mode !== 'bi') return;
    const yl = tercileLabels(state.y), xl = tercileLabels(state.x);
    let g = '<div class="biv">';
    for (let p = 2; p >= 0; p--) {
      g += `<span class="yl">${xl[p]}</span>`;
      for (let h = 0; h < 3; h++) g += `<span class="c" style="background:${BIV[p][h]}" title="${TERCILE[h]} heat · ${TERCILE[p]} population"></span>`;
    }
    g += `<span></span>${yl.map((s) => `<span class="xl" title="${s}">${s}</span>`).join('')}</div>`;
    g += `<div class="bivAxes"><span>↑ ${esc(M[state.x].label)}</span><span>${esc(M[state.y].label)} →</span></div>`;
    $('bivLegend').innerHTML = g + '<div class="legNo"><i></i>No data</div>';

    const hh = [];
    for (let i = 0; i < n; i++) if (bivClass(i) === 8) hh.push(i);
    const personDays = M[state.y].unit === 'days' && M[state.x].unit === 'people';
    const score = (i) => (personDays ? valueAt(state.x, i) * valueAt(state.y, i) : valueAt(state.x, i));
    hh.sort((a, b) => score(b) - score(a));
    const popTot = hh.reduce((s, i) => s + (POP[i] || 0), 0);
    let h = `<div class="hot"><span class="lbl">High heat × high population · ${periodOf(state.y)}</span>`;
    if (!hh.length) { $('hotspots').innerHTML = h + '<p>No woreda is in the top third on both for this period.</p></div>'; return; }
    const groupTot = M[state.x].unit === 'people' && state.x !== 'pop' ? hh.reduce((s, i) => s + (valueAt(state.x, i) || 0), 0) : null;
    h += `<p>${hh.length} woredas · ${compact(popTot)} people` +
      (groupTot !== null ? `, of whom ${compact(groupTot)} are ${M[state.x].label.replace(/ \(count\)$/, '').toLowerCase()}` : '') +
      `. Ranked by ${personDays ? `${M[state.x].label.replace(/ \(count\)$/, '').toLowerCase()} × days (person-days)` : M[state.x].label.toLowerCase()}:</p><ol>`;
    for (const i of hh.slice(0, 10)) {
      const v = personDays ? compact(score(i)) + ' p-d' : isCount(state.x) ? compact(score(i)) : fmt(score(i), state.x);
      h += `<li data-i="${i}"><span class="n">${esc(D.woredas[i].name)}</span> <span class="v">${v}</span></li>`;
    }
    h += `</ol><button type="button" id="selHot">Select all ${hh.length}</button></div>`;
    $('hotspots').innerHTML = h;
    for (const li of $('hotspots').querySelectorAll('li')) li.onclick = (e) => pick(+li.dataset.i, e.shiftKey || addMode.checked, true);
    $('selHot').onclick = () => setSelection(hh);
  }

  // ---------- map ----------
  mapboxgl.accessToken = window.MAPBOX_TOKEN;
  const isDark = () => {
    const t = document.documentElement.dataset.theme;
    return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  };
  const styleUrl = () => (isDark() ? 'mapbox://styles/mapbox/dark-v11' : 'mapbox://styles/mapbox/light-v11');
  const map = new mapboxgl.Map({
    container: 'map', style: styleUrl(), center: [40.5, 9.1], zoom: 4.6, attributionControl: true, boxZoom: false, preserveDrawingBuffer: true,
  });
  map.once('load', () => {
    map.resize();
    map.fitBounds([[32.9, 3.3], [48.1, 15.0]], { padding: 16, duration: 0 });
  });
  map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');
  map.on('error', (e) => console.error('Map error:', e && e.error ? e.error.message : e));
  const fs = (i, s) => map.getSource('w') && map.setFeatureState({ source: 'w', id: i }, s);

  map.on('style.load', () => {
    map.addSource('w', { type: 'geojson', data: G, promoteId: 'i' });
    const firstSymbol = map.getStyle().layers.find((l) => l.type === 'symbol')?.id;
    const sel = ['boolean', ['feature-state', 'sel'], false], hov = ['boolean', ['feature-state', 'hover'], false];
    map.addLayer({ id: 'w-fill', type: 'fill', source: 'w', paint: { 'fill-color': cssVar('--nodata'), 'fill-opacity': 0.85 } }, firstSymbol);
    map.addLayer({ id: 'w-line', type: 'line', source: 'w', paint: { 'line-color': isDark() ? '#1a1a19' : '#fcfcfb', 'line-width': 0.4, 'line-opacity': 0.8 } }, firstSymbol);
    // Selected woredas get a white line on a dark casing so they read on every viridis step.
    map.addLayer({ id: 'w-case', type: 'line', source: 'w', paint: { 'line-color': '#0b0b0b', 'line-width': ['case', sel, 4, 0] } }, firstSymbol);
    map.addLayer({
      id: 'w-hi', type: 'line', source: 'w',
      paint: {
        'line-color': ['case', sel, '#ffffff', isDark() ? '#f0efec' : '#0b0b0b'],
        'line-width': ['case', sel, 1.8, hov, 1.5, 0],
      },
    }, firstSymbol);
    paint();
    for (const i of state.sel) fs(i, { sel: true });
    addGaugeLayer();
    addMarketLayer();
    addRiverLayers();
  });

  function paint() {
    if (!map.getSource('w')) return;
    if (state.mode === 'bi') {
      for (let i = 0; i < n; i++) fs(i, { b: bivClass(i) });
      map.setPaintProperty('w-fill', 'fill-color', bivExpr());
    } else {
      const key = state.metric;
      for (let i = 0; i < n; i++) fs(i, { v: valueAt(key, i) });
      map.setPaintProperty('w-fill', 'fill-color', colorExpr(key));
    }
  }

  const tip = $('tip');
  map.on('mousemove', 'w-fill', (e) => {
    const i = e.features[0].id;
    if (state.hover !== null && state.hover !== i) fs(state.hover, { hover: false });
    state.hover = i;
    fs(i, { hover: true });
    map.getCanvas().style.cursor = 'pointer';
    const w = D.woredas[i];
    let body;
    if (state.mode === 'bi') {
      const c = bivClass(i);
      body = (c === null ? '' : `<i class="sw" style="background:${bivColor(c)}"></i>${TERCILE[c % 3]} heat · ${TERCILE[Math.floor(c / 3)]} population<br>`) +
        `${M[state.y].label}: <b>${withUnit(valueAt(state.y, i), state.y)}</b> <span class="m">· ${periodOf(state.y)}</span><br>` +
        `${M[state.x].label}: <b>${withUnit(valueAt(state.x, i), state.x)}</b>`;
    } else {
      const key = state.metric;
      body = `${M[key].label}: <b>${withUnit(valueAt(key, i), key)}</b>` +
        (periodOf(key) ? ` <span class="m">· ${periodOf(key)}</span>` : '');
    }
    tip.innerHTML = `<b>${esc(w.name)}</b> <span class="m">${esc(w.region)}</span><br>${body}`;
    tip.hidden = false;
    const r = map.getContainer().getBoundingClientRect();
    tip.style.left = Math.min(e.point.x + 14, r.width - tip.offsetWidth - 8) + 'px';
    tip.style.top = Math.min(e.point.y + 14, r.height - tip.offsetHeight - 8) + 'px';
  });
  map.on('mouseleave', 'w-fill', () => {
    if (state.hover !== null) fs(state.hover, { hover: false });
    state.hover = null; tip.hidden = true; map.getCanvas().style.cursor = '';
  });
  map.on('click', 'w-fill', (e) => {
    const over = ['g-pt', 'm-pt'].filter((id) => map.getLayer(id));
    if (over.length && map.queryRenderedFeatures(e.point, { layers: over }).length) return;
    const o = e.originalEvent;
    pick(e.features[0].id, o.shiftKey || o.ctrlKey || o.metaKey || addMode.checked);
  });

  // Shift-drag draws a box and adds every woreda under it to the selection.
  const canvas = map.getCanvasContainer();
  let box = null, boxStart = null;
  const mousePos = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left - canvas.clientLeft, e.clientY - r.top - canvas.clientTop]; };
  canvas.addEventListener('mousedown', (e) => {
    if (!e.shiftKey || e.button !== 0) return;
    map.dragPan.disable();
    boxStart = mousePos(e);
    document.addEventListener('mousemove', onBoxMove);
    document.addEventListener('mouseup', onBoxUp);
  }, true);
  function onBoxMove(e) {
    const p = mousePos(e);
    if (!box && Math.hypot(p[0] - boxStart[0], p[1] - boxStart[1]) < 4) return;
    if (!box) { box = document.createElement('div'); box.className = 'boxdraw'; canvas.appendChild(box); }
    Object.assign(box.style, {
      left: Math.min(p[0], boxStart[0]) + 'px', top: Math.min(p[1], boxStart[1]) + 'px',
      width: Math.abs(p[0] - boxStart[0]) + 'px', height: Math.abs(p[1] - boxStart[1]) + 'px',
    });
  }
  function onBoxUp(e) {
    document.removeEventListener('mousemove', onBoxMove);
    document.removeEventListener('mouseup', onBoxUp);
    map.dragPan.enable();
    if (!box) return;
    box.remove(); box = null;
    const feats = map.queryRenderedFeatures([boxStart, mousePos(e)], { layers: ['w-fill'] });
    setSelection([...state.sel, ...feats.map((f) => f.id)]);
  }

  // ---------- selection ----------
  const bboxCache = {};
  function bbox(i) {
    if (bboxCache[i]) return bboxCache[i];
    const f = G.features.find((g) => g.properties.i === i);
    const b = [Infinity, Infinity, -Infinity, -Infinity];
    const walk = (c) => (typeof c[0] === 'number' ? (b[0] = Math.min(b[0], c[0]), b[1] = Math.min(b[1], c[1]), b[2] = Math.max(b[2], c[0]), b[3] = Math.max(b[3], c[1])) : c.forEach(walk));
    walk(f.geometry.coordinates);
    return (bboxCache[i] = b);
  }
  function setSelection(list) {
    const next = [...new Set(list)];
    const keep = new Set(next);
    for (const i of state.sel) if (!keep.has(i)) fs(i, { sel: false });
    for (const i of next) fs(i, { sel: true });
    state.sel = next;
    renderDetail(); renderChart(); renderScatter();
  }
  function pick(i, add, fly = false) {
    if (add) setSelection(state.sel.includes(i) ? state.sel.filter((j) => j !== i) : [...state.sel, i]);
    else setSelection(state.sel.length === 1 && state.sel[0] === i ? [] : [i]);
    if (fly && state.sel.includes(i)) {
      const b = bbox(i);
      map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 60, maxZoom: 8.5, duration: 600 });
    }
  }
  const select = (i) => setSelection(i === null ? [] : [i]);
  const selLabel = () => (state.sel.length === 1 ? D.woredas[state.sel[0]].name : `${state.sel.length} selected woredas`);

  function renderDetail() {
    const el = $('detail');
    const S = state.sel;
    if (!S.length) {
      el.innerHTML = '<p class="hint">Click a woreda to see its time series and details. Shift-click to add more, or Shift-drag a box on the map; ' +
        'values are then combined (counts summed, the rest population-weighted).</p>';
      return;
    }
    let html;
    if (S.length === 1) {
      const w = D.woredas[S[0]];
      html = `<h3>${esc(w.name)}</h3><div class="where">${esc(w.zone)}, ${esc(w.region)} · ${w.pcode}</div>`;
    } else {
      const regions = [...new Set(S.map((i) => D.woredas[i].region))];
      html = `<h3>${S.length} woredas</h3><div class="where">${regions.length <= 3 ? regions.map(esc).join(', ') : `${regions.length} regions`}` +
        ' · counts summed, others population-weighted</div><div class="chips">' +
        S.map((i) => `<span class="chip">${esc(D.woredas[i].name)}<button type="button" data-i="${i}" aria-label="Remove ${esc(D.woredas[i].name)}">×</button></span>`).join('') +
        '</div>';
    }
    html += '<table>';
    let grp = null;
    for (const [k, spec] of Object.entries(M)) {
      const g = spec.temporal || spec.daily || spec.dekadal ? `${spec.group} · ${periodOf(k)}` : GROUP_LABEL[spec.group] || spec.group;
      if (g !== grp) { html += `<tr class="grp"><td colspan="2">${g}</td></tr>`; grp = g; }
      const v = S.length === 1 ? valueAt(k, S[0]) : aggregate(k, S);
      html += `<tr><td>${spec.label}</td><td>${withUnit(v, k)}</td></tr>`;
    }
    html += '</table><div class="btns">';
    const last = D.woredas[S[S.length - 1]];
    const inZone = D.woredas.map((w, i) => (w.zone === last.zone && w.region === last.region ? i : -1)).filter((i) => i >= 0);
    const inRegion = D.woredas.map((w, i) => (w.region === last.region ? i : -1)).filter((i) => i >= 0);
    html += `<button type="button" id="addZone">+ ${esc(last.zone)} zone (${inZone.length})</button>`;
    html += `<button type="button" id="addRegion">+ ${esc(last.region)} (${inRegion.length})</button>`;
    html += '<button type="button" id="clearSel">Clear</button></div>';
    el.innerHTML = html;
    $('clearSel').onclick = () => select(null);
    $('addZone').onclick = () => setSelection([...S, ...inZone]);
    $('addRegion').onclick = () => setSelection([...S, ...inRegion]);
    for (const b of el.querySelectorAll('.chip button')) b.onclick = () => setSelection(S.filter((j) => j !== +b.dataset.i));
  }

  // ---------- time series chart (monthly with El Niño bands, or daily with the forecast days) ----------
  const chartEl = $('chart'), chartTip = $('chartTip');
  // danger thresholds drawn on the daily chart, matching the day-count layers
  const THRESH = { dy_wbgt: [28, 'WBGT 28 °C'], dy_utci: [38, 'UTCI 38 °C'], dy_tmin: [25, 'hot night 25 °C'] };
  function renderChart() {
    const key = chartKey();
    const spec = M[key];
    const daily = !!spec.daily, dek = !!spec.dekadal;
    const N = daily ? days.length : dek ? dekads.length : months.length, cur = daily ? state.d : dek ? state.k : state.t;
    // El Niño flag for each step (dekads take their month's)
    const monOf = (t) => (dek ? monthIdx.get(dekMonth(dekads[t])) : t);
    const ensoAt = (t) => { const m = monOf(t); return m !== undefined && !!D.enso.elnino[m]; };
    const provAt = (t) => { const m = monOf(t); return m !== undefined && !!D.enso.provisional[m]; };
    const nat = spec.national;
    const S = state.sel;
    const wor = !S.length ? null : Array.from({ length: N }, (_, t) => (S.length === 1 ? valueAt(key, S[0], t) : aggregate(key, S, t)));
    const natLabel = spec.group === 'Exposure' ? 'Ethiopia total' : 'Ethiopia (population-weighted)';
    $('chartTitle').textContent = `${spec.label}${spec.unit ? ` (${spec.unit})` : ''} ${daily ? 'by day' : dek ? 'by dekad' : 'by month'}`;
    $('chartLegend').innerHTML =
      (wor ? `<span><i style="background:var(--accent)"></i>${esc(selLabel())}</span>` : '') +
      `<span><i style="background:var(--national)"></i>${natLabel}</span>` +
      (daily ? (hasFc ? '<span><i class="box" style="background:var(--brush);border-color:var(--accent)"></i>Forecast (Open-Meteo)</span>' : '')
        : '<span><i class="box"></i>El Niño (NOAA ONI)</span>');

    const W = chartEl.clientWidth, H = chartEl.clientHeight;
    if (W < 120 || H < 80) return;
    const pad = { l: 48, r: 12, t: 18, b: 24 };
    const th = daily ? THRESH[key] : null;
    const vals = [...nat, ...(wor || []), ...(th ? [th[0]] : []), ...(spec.ref ? [spec.ref] : [])].filter((v) => v !== null);
    let lo = Math.min(...vals), hi = Math.max(...vals);
    if (spec.unit === 'days' || spec.group === 'Exposure' || spec.group === 'Rainfall') lo = 0;
    if (spec.diverging) { const a = Math.max(Math.abs(lo), Math.abs(hi)); lo = -a; hi = a; }
    if (hi - lo < 1) { const mid = (hi + lo) / 2; lo = mid - 0.5; hi = mid + 0.5; }
    const ticks = niceTicks(lo, hi, 4);
    lo = Math.min(lo, ticks[0]); hi = Math.max(hi, ticks[ticks.length - 1]);
    const x = (t) => pad.l + ((W - pad.l - pad.r) * (t + 0.5)) / N;
    const y = (v) => pad.t + (H - pad.t - pad.b) * (1 - (v - lo) / (hi - lo));
    const bw = (W - pad.l - pad.r) / N;

    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(spec.label)} ${daily ? 'daily' : dek ? 'dekadal' : 'monthly'} time series">`;
    const band = (t0, t1, fill, cls, label) =>
      `<rect x="${x(t0) - bw / 2}" y="${pad.t}" width="${bw * (t1 - t0)}" height="${H - pad.t - pad.b}" fill="${fill}"/>` +
      `<text class="${cls}" x="${x(t0) - bw / 2 + 4}" y="${pad.t - 5}">${label}</text>`;
    if (daily) {
      if (hasFc) s += band(DY.fc_start, N, 'var(--brush)', 'fcLbl', `Forecast${DY.issued ? ` · issued ${dayName(DY.issued.slice(0, 10))}` : ''}`);
    } else {
      let t0 = null;
      for (let t = 0; t <= N; t++) {
        const on = t < N && ensoAt(t);
        if (on && t0 === null) t0 = t;
        if (!on && t0 !== null) {
          const prov = provAt(t0) && provAt(t - 1);
          s += band(t0, t, 'var(--enso)', 'ensoLbl', `El Niño${prov ? ' (provisional)' : ''}`);
          t0 = null;
        }
      }
    }
    for (const v of ticks) {
      s += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}" stroke="var(--grid)" stroke-width="1"/>`;
      s += `<text x="${pad.l - 6}" y="${y(v) + 4}" text-anchor="end">${fmtTick(v, spec)}</text>`;
    }
    if (spec.diverging) s += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(0)}" y2="${y(0)}" stroke="var(--axis)"/>`;
    if (th) {
      s += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(th[0])}" y2="${y(th[0])}" stroke="var(--ink-2)" stroke-dasharray="6 4"/>`;
      s += `<text x="${pad.l + 4}" y="${y(th[0]) - 4}">${th[1]}</text>`;
    }
    if (spec.ref) {
      s += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(spec.ref)}" y2="${y(spec.ref)}" stroke="var(--ink-2)" stroke-dasharray="6 4"/>`;
      s += `<text x="${pad.l + 4}" y="${y(spec.ref) - 4}">${spec.refLabel || 'normal'}</text>`;
    }
    for (let t = 0; t < N; t++) {
      const tick = daily ? (N - 1 - t) % 7 === 0 : dek ? dekads[t].endsWith('.01.1') || t === 0 : months[t].endsWith('-01') || t === 0;
      if (!tick) continue;
      s += `<line x1="${x(t)}" x2="${x(t)}" y1="${H - pad.b}" y2="${H - pad.b + 4}" stroke="var(--axis)"/>`;
      s += `<text x="${x(t)}" y="${H - 6}" text-anchor="middle">${daily ? dayName(days[t]) : dek ? monthName(dekMonth(dekads[t])) : monthName(months[t])}</text>`;
    }
    s += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${H - pad.b}" y2="${H - pad.b}" stroke="var(--axis)"/>`;
    s += `<line x1="${x(cur)}" x2="${x(cur)}" y1="${pad.t}" y2="${H - pad.b}" stroke="var(--muted)" stroke-dasharray="3 3"/>`;
    const path = (arr, from = 0, to = N - 1) => {
      let d = '', pen = false;
      for (let t = from; t <= to; t++) {
        const v = arr[t];
        if (v === null || v === undefined) { pen = false; continue; }
        d += `${pen ? 'L' : 'M'}${x(t).toFixed(1)},${y(v).toFixed(1)}`; pen = true;
      }
      return d;
    };
    // observed part solid; forecast part dashed, joined to the last observed day
    const line = (arr, c) => {
      const split = daily && hasFc ? DY.fc_start : dek && PRE0 < N ? PRE0 : N;
      let out = `<path d="${path(arr, 0, split - 1)}" fill="none" stroke="${c}" stroke-width="2" stroke-linejoin="round"/>`;
      if (split < N) out += `<path d="${path(arr, Math.max(0, split - 1), N - 1)}" fill="none" stroke="${c}" stroke-width="2" stroke-dasharray="5 4" stroke-linejoin="round"/>`;
      return out;
    };
    s += line(nat, 'var(--national)');
    if (wor) s += line(wor, 'var(--accent)');
    const mark = (v, c) => (v === null ? '' : `<circle cx="${x(cur)}" cy="${y(v)}" r="4" fill="${c}" stroke="var(--surface)" stroke-width="2"/>`);
    s += mark(nat[cur], 'var(--national)');
    if (wor) s += mark(wor[cur], 'var(--accent)');
    s += `<g id="hov"></g><rect x="${pad.l}" y="0" width="${W - pad.l - pad.r}" height="${H}" fill="transparent" id="hit" style="cursor:pointer"/></svg>`;
    chartEl.innerHTML = s;

    const hit = chartEl.querySelector('#hit'), hov = chartEl.querySelector('#hov');
    const tAt = (ev) => {
      const r = chartEl.getBoundingClientRect();
      return Math.max(0, Math.min(N - 1, Math.floor((ev.clientX - r.left - pad.l) / bw)));
    };
    hit.addEventListener('mousemove', (ev) => {
      const t = tAt(ev);
      hov.innerHTML = `<line x1="${x(t)}" x2="${x(t)}" y1="${pad.t}" y2="${H - pad.b}" stroke="var(--axis)"/>` +
        (nat[t] === null ? '' : `<circle cx="${x(t)}" cy="${y(nat[t])}" r="4" fill="var(--national)" stroke="var(--surface)" stroke-width="2"/>`) +
        (wor && wor[t] !== null ? `<circle cx="${x(t)}" cy="${y(wor[t])}" r="4" fill="var(--accent)" stroke="var(--surface)" stroke-width="2"/>` : '');
      let head;
      if (daily) {
        head = `<b>${dayName(days[t], true)}</b>${isFcDay(t) ? ' · <b>Forecast</b>' : ''}`;
      } else if (dek) {
        head = `<b>${dekName(dekads[t], true)}</b>${ensoAt(t) ? ' · <b>El Niño</b>' : ''}${isPre(t) ? ' <span class="m">· preliminary</span>' : ''}`;
      } else {
        const prov = D.provisional_share[t] > 0.5 ? '<br><span class="m">Mostly Open-Meteo (provisional)</span>' : '';
        head = `<b>${monthName(months[t])}</b>${D.enso.elnino[t] ? ' · <b>El Niño</b>' : ''}` +
          (D.enso.oni[t] !== null ? ` <span class="m">ONI ${D.enso.oni[t] > 0 ? '+' : ''}${D.enso.oni[t]}</span>` : '') + prov;
      }
      chartTip.innerHTML = head +
        (wor ? `<br>${esc(selLabel())}: <b>${withUnit(wor[t], key)}</b>` : '') +
        `<br>${natLabel}: <b>${withUnit(nat[t], key)}</b>`;
      chartTip.hidden = false;
      const wrap = chartEl.parentElement.getBoundingClientRect();
      chartTip.style.left = Math.min(ev.clientX - wrap.left + 12, wrap.width - chartTip.offsetWidth - 8) + 'px';
      chartTip.style.top = chartEl.offsetTop + 8 + 'px';
    });
    hit.addEventListener('mouseleave', () => { hov.innerHTML = ''; chartTip.hidden = true; });
    hit.addEventListener('click', (ev) => (daily ? setDay(tAt(ev)) : dek ? setDekad(tAt(ev)) : setMonth(tAt(ev))));
  }
  function niceTicks(lo, hi, count) {
    const span = hi - lo, step0 = span / count, mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((s) => s >= step0);
    const out = [];
    for (let v = Math.floor(lo / step) * step; v <= hi + step * 0.5; v += step) out.push(+v.toFixed(6));
    return out;
  }
  function fmtTick(v, spec) {
    if (spec.group === 'Exposure' || spec.unit === 'people' || spec.unit === 'per km²') return compact(v);
    return Number.isInteger(v) ? v.toString() : +v.toFixed(2) + '';
  }

  // ---------- scatter: population / age (x) vs heat (y) ----------
  const scEl = $('scatter'), scTip = $('scatterTip');
  let scPts = [];
  function spearman(xs, ys) {
    const rank = (a) => {
      const o = a.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]), r = new Array(a.length);
      for (let i = 0; i < o.length;) {
        let j = i; while (j + 1 < o.length && o[j + 1][0] === o[i][0]) j++;
        for (let k = i; k <= j; k++) r[o[k][1]] = (i + j) / 2;
        i = j + 1;
      }
      return r;
    };
    const rx = rank(xs), ry = rank(ys), m = xs.length, mx = (m - 1) / 2;
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < m; i++) { sxy += (rx[i] - mx) * (ry[i] - mx); sxx += (rx[i] - mx) ** 2; syy += (ry[i] - mx) ** 2; }
    return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null;
  }
  function renderScatter() {
    const kx = state.x, ky = state.y;
    $('scatterTitle').textContent = `Heat vs population · ${periodOf(state.y)}`;
    const W = scEl.clientWidth, H = scEl.clientHeight;
    if (W < 120 || H < 80) return;
    const logX = state.xLog;
    const pts = [];
    for (let i = 0; i < n; i++) {
      const xv = valueAt(kx, i), yv = valueAt(ky, i);
      if (xv === null || yv === null || (logX && !(xv > 0))) continue;
      pts.push({ i, xv, yv });
    }
    const rho = pts.length > 2 ? spearman(pts.map((p) => p.xv), pts.map((p) => p.yv)) : null;
    $('rho').textContent = rho === null ? '' : `Spearman ρ = ${rho.toFixed(2)} · ${pts.length.toLocaleString('en')} woredas`;
    const pad = { l: 44, r: 12, t: 20, b: 36 };
    const fx = logX ? Math.log10 : (v) => v;
    let xlo = Math.min(...pts.map((p) => fx(p.xv))), xhi = Math.max(...pts.map((p) => fx(p.xv)));
    let ylo = Math.min(...pts.map((p) => p.yv)), yhi = Math.max(...pts.map((p) => p.yv));
    if (M[ky].unit === 'days') ylo = 0;
    if (yhi - ylo < 1) { yhi = ylo + 1; }
    const yt = niceTicks(ylo, yhi, 4);
    ylo = Math.min(ylo, yt[0]); yhi = Math.max(yhi, yt[yt.length - 1]);
    let xt;
    if (logX) {
      xlo = Math.floor(xlo * 2) / 2; xhi = Math.ceil(xhi * 2) / 2;
      xt = []; for (let e = Math.ceil(xlo); e <= Math.floor(xhi); e++) xt.push(e);
    } else {
      if (xhi - xlo === 0) xhi = xlo + 1;
      xt = niceTicks(xlo, xhi, 4); xlo = Math.min(xlo, xt[0]); xhi = Math.max(xhi, xt[xt.length - 1]);
    }
    const X = (v) => pad.l + (W - pad.l - pad.r) * ((fx(v) - xlo) / (xhi - xlo));
    const Xr = (u) => pad.l + (W - pad.l - pad.r) * ((u - xlo) / (xhi - xlo));
    const Y = (v) => pad.t + (H - pad.t - pad.b) * (1 - (v - ylo) / (yhi - ylo));
    const bi = state.mode === 'bi';

    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Scatter of ${esc(M[ky].label)} against ${esc(M[kx].label)}">`;
    for (const v of yt) {
      s += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--grid)"/>`;
      s += `<text x="${pad.l - 6}" y="${Y(v) + 4}" text-anchor="end">${fmtTick(v, M[ky])}</text>`;
    }
    for (const u of xt) {
      const lab = logX ? compact(10 ** u) : fmtTick(u, M[kx]);
      s += `<line x1="${Xr(u)}" x2="${Xr(u)}" y1="${pad.t}" y2="${H - pad.b}" stroke="var(--grid)"/>`;
      s += `<text x="${Xr(u)}" y="${H - pad.b + 14}" text-anchor="middle">${lab}</text>`;
    }
    s += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${H - pad.b}" y2="${H - pad.b}" stroke="var(--axis)"/>`;
    s += `<text class="axTitle" x="${W - pad.r}" y="${H - 4}" text-anchor="end">${esc(M[kx].label)}${esc(unitSuffix(kx))}${logX ? ' · log' : ''} →</text>`;
    s += `<text class="axTitle" x="${pad.l}" y="${pad.t - 8}">↑ ${esc(M[ky].label)}${esc(unitSuffix(ky))}</text>`;
    if (bi) {
      // tercile cut lines, so the scatter doubles as the bivariate legend
      const [xa, xb] = terciles(kx), [ya, yb] = terciles(ky);
      for (const v of [xa, xb]) if (!logX || v > 0) s += `<line x1="${X(v)}" x2="${X(v)}" y1="${pad.t}" y2="${H - pad.b}" stroke="var(--axis)" stroke-dasharray="4 3"/>`;
      for (const v of [ya, yb]) s += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--axis)" stroke-dasharray="4 3"/>`;
    }
    const selSet = new Set(state.sel);
    scPts = pts.map((p) => ({ ...p, px: X(p.xv), py: Y(p.yv) }));
    let dots = '', top = '';
    for (const p of scPts) {
      if (selSet.has(p.i)) {
        top += `<circle cx="${p.px.toFixed(1)}" cy="${p.py.toFixed(1)}" r="4.5" fill="var(--accent)" stroke="var(--surface)" stroke-width="1.5"/>`;
      } else if (bi) {
        const c = bivClass(p.i);
        dots += `<circle cx="${p.px.toFixed(1)}" cy="${p.py.toFixed(1)}" r="3" fill="${c === null ? 'var(--nodata)' : bivColor(c)}" stroke="var(--surface)" stroke-width="0.6"/>`;
      } else {
        dots += `<circle cx="${p.px.toFixed(1)}" cy="${p.py.toFixed(1)}" r="3" fill="var(--dot)"/>`;
      }
    }
    s += dots + top + '<g id="scHov"></g><rect id="scBrush" fill="var(--brush)" stroke="var(--ink)" stroke-dasharray="3 2" visibility="hidden"/>';
    s += `<rect id="scHit" x="0" y="0" width="${W}" height="${H}" fill="transparent" style="cursor:crosshair"/></svg>`;
    scEl.innerHTML = s;

    const hit = scEl.querySelector('#scHit'), hov = scEl.querySelector('#scHov'), brush = scEl.querySelector('#scBrush');
    const pos = (ev) => { const r = scEl.getBoundingClientRect(); return [ev.clientX - r.left, ev.clientY - r.top]; };
    const nearest = ([mx, my]) => {
      let best = null, bd = 100;
      for (const p of scPts) { const d = (p.px - mx) ** 2 + (p.py - my) ** 2; if (d < bd) { bd = d; best = p; } }
      return best;
    };
    let start = null, dragging = false;
    hit.addEventListener('pointerdown', (ev) => { start = pos(ev); dragging = false; hit.setPointerCapture(ev.pointerId); });
    hit.addEventListener('pointermove', (ev) => {
      const p = pos(ev);
      if (start && (dragging || Math.hypot(p[0] - start[0], p[1] - start[1]) > 4)) {
        dragging = true; scTip.hidden = true; hov.innerHTML = '';
        brush.setAttribute('x', Math.min(p[0], start[0])); brush.setAttribute('y', Math.min(p[1], start[1]));
        brush.setAttribute('width', Math.abs(p[0] - start[0])); brush.setAttribute('height', Math.abs(p[1] - start[1]));
        brush.setAttribute('visibility', 'visible');
        return;
      }
      const q = nearest(p);
      if (!q) { hov.innerHTML = ''; scTip.hidden = true; return; }
      hov.innerHTML = `<circle cx="${q.px}" cy="${q.py}" r="6" fill="none" stroke="var(--ink)" stroke-width="1.5"/>`;
      const w = D.woredas[q.i], c = bi ? bivClass(q.i) : null;
      scTip.innerHTML = `<b>${esc(w.name)}</b> <span class="m">${esc(w.region)}</span><br>` +
        (c !== null ? `<i class="sw" style="background:${bivColor(c)}"></i>${TERCILE[c % 3]} heat · ${TERCILE[Math.floor(c / 3)]} population<br>` : '') +
        `${M[ky].label}: <b>${withUnit(q.yv, ky)}</b><br>${M[kx].label}: <b>${withUnit(q.xv, kx)}</b>`;
      scTip.hidden = false;
      const wrap = scEl.parentElement.getBoundingClientRect(), r = scEl.getBoundingClientRect();
      const left = r.left - wrap.left + q.px + 12, topY = r.top - wrap.top + q.py - scTip.offsetHeight - 8;
      scTip.style.left = Math.min(left, wrap.width - scTip.offsetWidth - 8) + 'px';
      scTip.style.top = Math.max(4, topY) + 'px';
    });
    hit.addEventListener('pointerup', (ev) => {
      const p = pos(ev), add = ev.shiftKey || ev.ctrlKey || ev.metaKey || addMode.checked;
      if (dragging) {
        const [x0, x1] = [Math.min(p[0], start[0]), Math.max(p[0], start[0])], [y0, y1] = [Math.min(p[1], start[1]), Math.max(p[1], start[1])];
        const inside = scPts.filter((q) => q.px >= x0 && q.px <= x1 && q.py >= y0 && q.py <= y1).map((q) => q.i);
        start = null; dragging = false;
        setSelection(add ? [...state.sel, ...inside] : inside);
        return;
      }
      start = null;
      const q = nearest(p);
      if (q) pick(q.i, add);
    });
    hit.addEventListener('pointerleave', () => { if (!start) { hov.innerHTML = ''; scTip.hidden = true; } });
  }

  // ---------- river flood gauges (GloFAS discharge at OCHA's monitoring points) ----------
  const F = window.FLOOD;
  const fl = F ? {
    st: F.stations, days: F.days, fc0: F.fc_start, gi: 0, range: 'all', normal: true,
    dayIdx: new Map(F.days.map((d, k) => [d, k])),
    monIdx: new Map(months.map((m, k) => [m, k])),
  } : null;
  // 4 ordered classes by discharge relative to the 2-year flood (RP2); size grows with class too
  const FL_CLS = [
    { c: '#c6dbef', r: 5, label: 'Below half of RP2' },
    { c: '#6baed6', r: 6, label: 'Half of RP2 to RP2' },
    { c: '#2171b5', r: 8, label: 'At or above RP2' },
    { c: '#08306b', r: 10, label: 'At or above RP5' },
  ];
  const flClass = (v, s) => (v === null || v === undefined || !s.rp[2] ? null : v >= s.rp[5] ? 3 : v >= s.rp[2] ? 2 : v >= s.rp[2] / 2 ? 1 : 0);
  const fmtQ = (v) => (v === null || v === undefined ? '—' : `${Math.round(v).toLocaleString('en')} m³/s`);
  const inOND = (d) => +d.slice(5, 7) >= 10;
  // The period the gauges show: the chosen day for daily layers, otherwise the chosen month (its peak).
  function flPeriod() {
    if (M[mapKey()].daily && days.length) {
      const k = fl.dayIdx.get(days[state.d]);
      if (k !== undefined) return { kind: 'day', k, label: dayName(days[state.d], true) + (k >= fl.fc0 ? ' (forecast median)' : '') };
    }
    // rainfall dekad layers: the peak of the dekad's month
    if (M[mapKey()].dekadal && dekads.length) {
      const t = monthIdx.get(dekMonth(dekads[state.k]));
      if (t !== undefined) return { kind: 'month', t, label: `${monthName(months[t])} peak` };
    }
    return { kind: 'month', t: state.t, label: `${monthName(months[state.t])} peak` };
  }
  const flValue = (gi, p) => (p.kind === 'day' ? F.q[gi][p.k] : F.monthly.peak[gi][p.t]);

  function addGaugeLayer() {
    if (!fl || map.getSource('g')) return;
    map.addSource('g', {
      type: 'geojson', promoteId: 'k',
      data: { type: 'FeatureCollection', features: fl.st.map((s, k) => ({ type: 'Feature', properties: { k }, geometry: { type: 'Point', coordinates: [s.lon, s.lat] } })) },
    });
    const cls = ['coalesce', ['feature-state', 'c'], -1], on = ['boolean', ['feature-state', 'on'], false];
    const vis = $('showGauges').checked ? 'visible' : 'none';
    if (RN && RN.catchments) {
      map.addSource('catch', { type: 'geojson', data: catchData() });
      map.addLayer({ id: 'catch-line', type: 'line', source: 'catch', layout: { visibility: vis },
        paint: { 'line-color': isDark() ? '#f0efec' : '#0b0b0b', 'line-width': 1.3, 'line-dasharray': [3, 2], 'line-opacity': 0.75 } });
    }
    // selected gauge: a dark halo behind a white ring, so it reads on every viridis step
    map.addLayer({
      id: 'g-sel', type: 'circle', source: 'g', layout: { visibility: vis },
      paint: { 'circle-color': '#0b0b0b', 'circle-radius': ['match', cls, 0, 10, 1, 11, 2, 13, 3, 15, 10], 'circle-opacity': ['case', on, 1, 0] },
    });
    map.addLayer({
      id: 'g-pt', type: 'circle', source: 'g',
      layout: { visibility: vis },
      paint: {
        'circle-color': ['match', cls, 0, FL_CLS[0].c, 1, FL_CLS[1].c, 2, FL_CLS[2].c, 3, FL_CLS[3].c, cssVar('--nodata')],
        'circle-radius': ['match', cls, 0, 5, 1, 6, 2, 8, 3, 10, 5],
        'circle-stroke-color': ['case', on, '#ffffff', '#0b0b0b'],
        'circle-stroke-width': ['case', on, 2.5, 1.2],
      },
    });
    paintGauges();
  }
  function paintGauges() {
    if (!fl) return;
    const p = flPeriod();
    if (map.getSource('g')) fl.st.forEach((s, k) => map.setFeatureState({ source: 'g', id: k }, { c: flClass(flValue(k, p), s), on: k === fl.gi }));
    const counts = [0, 0, 0, 0];
    fl.st.forEach((s, k) => { const c = flClass(flValue(k, p), s); if (c !== null) counts[c]++; });
    $('gaugeLegend').innerHTML = `<div class="gPeriod">${esc(p.label)}</div>` + FL_CLS.map((c, i) =>
      `<div class="gRow"><i style="background:${c.c};width:${c.r * 2}px;height:${c.r * 2}px"></i>${c.label}<span>${counts[i]}</span></div>`).join('');
  }
  function catchData() {
    const g = RN && RN.catchments && RN.catchments[fl.gi];
    return { type: 'FeatureCollection', features: g ? [{ type: 'Feature', properties: {}, geometry: g }] : [] };
  }
  function setGauge(k, fly = false) {
    fl.gi = k;
    if (map.getSource('catch')) map.getSource('catch').setData(catchData());
    if (RV) { paintRivers(); fillCompare(); }
    $('gaugeSel').value = String(k);
    paintGauges(); renderFlood();
    if (fly) map.flyTo({ center: [fl.st[k].lon, fl.st[k].lat], zoom: Math.max(map.getZoom(), 7), duration: 600 });
  }

  // daily chart: observed discharge, normal band, RP2 / RP5 / OND trigger, forecast median and spread
  const fchart = $('fchart'), ftip = $('fchartTip');
  function flWindow() {
    const N = fl.days.length;
    if (fl.range === 'recent') return [Math.max(0, fl.fc0 - 180), N - 1];
    if (fl.range === 'fc') return [Math.max(0, fl.fc0 - 60), N - 1];
    return [0, N - 1];
  }
  function renderFlood() {
    if (!fl) return;
    const s = fl.st[fl.gi], gi = fl.gi, Q = F.q[gi], C = F.clim[gi], B = F.fc_band[gi];
    $('floodTitle').textContent = `River discharge · ${s.label}`;
    $('floodWhere').textContent = `${s.river} · at-risk zones: ${s.zones.join(', ')} · GloFAS cell ${s.cell[0].toFixed(3)}, ${s.cell[1].toFixed(3)}`;
    $('floodLinks').textContent = RV ? riverLinks(gi) : '';
    const cmpK = RV && $('gaugeCmp').value !== '' ? +$('gaugeCmp').value : null, Qc = cmpK !== null ? F.q[cmpK] : null;
    $('cmpKey').hidden = cmpK === null;
    if (cmpK !== null) $('cmpKey').lastChild.textContent = fl.st[cmpK].label;
    const [a, b] = flWindow(), N = b - a + 1;
    const R = RN && RN.gauges[gi];
    $('rainKey').hidden = $('rainNorm').hidden = !R;
    // the bottom RH pixels hold the catchment rainfall panel, on the same time axis
    const RH = R ? 112 : 0;
    const W = fchart.clientWidth, HT = fchart.clientHeight, H = HT - RH;
    if (W < 160 || H < 100) { renderFloodStats(); renderStrip(); return; }
    const pad = { l: 56, r: 74, t: 18, b: 24 };
    const fcB = (k, j) => (k >= fl.fc0 ? B[j][k - fl.fc0] : null);
    let hi = 0;
    for (let k = a; k <= b; k++) {
      hi = Math.max(hi, Q[k] || 0, fl.normal ? C[2][k] || 0 : 0, fcB(k, 3) || 0, Qc ? Qc[k] || 0 : 0);
    }
    hi = Math.max(hi, s.rp[2] * 1.05);
    const ticks = niceTicks(0, hi, 4); hi = ticks[ticks.length - 1];
    const x = (k) => pad.l + ((W - pad.l - pad.r) * (k - a + 0.5)) / N;
    const y = (v) => pad.t + (H - pad.t - pad.b) * (1 - v / hi);
    const bw = (W - pad.l - pad.r) / N;
    const mIdx = (k) => fl.monIdx.get(fl.days[k].slice(0, 7));
    let svg = `<svg viewBox="0 0 ${W} ${HT}" role="img" aria-label="Daily river discharge at ${esc(s.label)}${R ? ' and dekadal catchment rainfall' : ''}">`;
    // El Niño months
    let k0 = null;
    for (let k = a; k <= b + 1; k++) {
      const t = k <= b ? mIdx(k) : undefined, on = t !== undefined && D.enso.elnino[t];
      if (on && k0 === null) k0 = k;
      if (!on && k0 !== null) {
        svg += `<rect x="${x(k0) - bw / 2}" y="${pad.t}" width="${bw * (k - k0)}" height="${H - pad.t - pad.b}" fill="var(--enso)"/>` +
          `<text class="ensoLbl" x="${x(k0) - bw / 2 + 4}" y="${pad.t - 5}">El Niño${D.enso.provisional[mIdx(k0)] ? ' (provisional)' : ''}</text>`;
        k0 = null;
      }
    }
    if (fl.fc0 <= b) {
      svg += `<rect x="${x(fl.fc0) - bw / 2}" y="${pad.t}" width="${bw * (b - fl.fc0 + 1)}" height="${H - pad.t - pad.b}" fill="var(--brush)"/>` +
        `<text class="fcLbl" x="${x(fl.fc0) - bw / 2 + 4}" y="${pad.t - 5}">Forecast</text>`;
    }
    for (const v of ticks) {
      svg += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}" stroke="var(--grid)"/>` +
        `<text x="${pad.l - 6}" y="${y(v) + 4}" text-anchor="end">${compact(v)}</text>`;
    }
    svg += `<text x="${pad.l - 6}" y="${pad.t - 5}" text-anchor="end">m³/s</text>`;
    const area = (lo, up, from, to) => {
      let top = '', bot = '';
      for (let k = from; k <= to; k++) { if (lo(k) === null || up(k) === null) continue; top += `${top ? 'L' : 'M'}${x(k).toFixed(1)},${y(up(k)).toFixed(1)}`; }
      for (let k = to; k >= from; k--) { if (lo(k) === null || up(k) === null) continue; bot += `L${x(k).toFixed(1)},${y(lo(k)).toFixed(1)}`; }
      return top ? top + bot + 'Z' : '';
    };
    const path = (f, from, to) => {
      let d = '', pen = false;
      for (let k = from; k <= to; k++) {
        const v = f(k);
        if (v === null || v === undefined) { pen = false; continue; }
        d += `${pen ? 'L' : 'M'}${x(k).toFixed(1)},${y(v).toFixed(1)}`; pen = true;
      }
      return d;
    };
    if (fl.normal) {
      svg += `<path d="${area((k) => C[0][k], (k) => C[2][k], a, b)}" fill="var(--normal)"/>`;
      svg += `<path d="${path((k) => C[1][k], a, b)}" fill="none" stroke="var(--muted)" stroke-width="1" stroke-dasharray="2 3"/>`;
    }
    // thresholds: RP2 and RP5 all year; OCHA's trigger level applies in Oct–Dec only
    const hline = (v, label, dash) => (v > hi ? '' :
      `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}" stroke="var(--ink-2)" stroke-dasharray="${dash}"/>` +
      `<text x="${W - pad.r + 4}" y="${y(v) + 4}">${label}</text>`);
    svg += hline(s.rp[2], 'RP2', '6 4') + hline(s.rp[5], 'RP5', '2 3');
    if (s.trigger && s.trigger <= hi) {
      let seg = '', kk = null;
      for (let k = a; k <= b + 1; k++) {
        const on = k <= b && inOND(fl.days[k]);
        if (on && kk === null) kk = k;
        if (!on && kk !== null) { seg += `M${x(kk) - bw / 2},${y(s.trigger)}H${x(k - 1) + bw / 2}`; kk = null; }
      }
      svg += `<path d="${seg}" stroke="var(--trigger)" stroke-width="2" fill="none"/>` +
        `<text x="${W - pad.r + 4}" y="${y(s.trigger) - 6}" class="trgLbl">OND trigger</text>`;
    }
    for (let k = a; k <= b; k++) {
      const d = fl.days[k];
      const tick = N > 400 ? d.endsWith('-01-01') || d.endsWith('-07-01') || k === a : N > 120 ? d.endsWith('-01') : d.endsWith('-01') || d.endsWith('-15');
      if (!tick) continue;
      svg += `<line x1="${x(k)}" x2="${x(k)}" y1="${H - pad.b}" y2="${H - pad.b + 4}" stroke="var(--axis)"/>` +
        `<text x="${x(k)}" y="${H - 6}" text-anchor="middle">${N > 120 ? monthName(d.slice(0, 7)) : dayName(d)}</text>`;
    }
    svg += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${H - pad.b}" y2="${H - pad.b}" stroke="var(--axis)"/>`;
    // the period shown on the map
    const p = flPeriod();
    if (p.kind === 'day' && p.k >= a) {
      svg += `<line x1="${x(p.k)}" x2="${x(p.k)}" y1="${pad.t}" y2="${H - pad.b}" stroke="var(--muted)" stroke-dasharray="3 3"/>`;
    } else if (p.kind === 'month') {
      const ks = fl.days.map((d, k) => (d.startsWith(months[p.t]) && k >= a && k <= b ? k : -1)).filter((k) => k >= 0);
      if (ks.length) svg += `<rect x="${x(ks[0]) - bw / 2}" y="${pad.t}" width="${bw * ks.length}" height="${H - pad.t - pad.b}" fill="none" stroke="var(--muted)" stroke-dasharray="3 3"/>`;
    }
    if (fl.fc0 <= b) {
      svg += `<path d="${area((k) => fcB(k, 2), (k) => fcB(k, 3), fl.fc0, b)}" fill="var(--brush)"/>`;
      svg += `<path d="${area((k) => fcB(k, 0), (k) => fcB(k, 1), fl.fc0, b)}" fill="var(--fc-iqr)"/>`;
      svg += `<path d="${path((k) => Q[k], Math.max(a, fl.fc0 - 1), b)}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-dasharray="5 4"/>`;
    }
    if (Qc) svg += `<path d="${path((k) => Qc[k], a, b)}" fill="none" stroke="var(--cmp)" stroke-width="1.5" stroke-linejoin="round"/>`;
    svg += `<path d="${path((k) => Q[k], a, Math.min(b, fl.fc0 - 1))}" fill="none" stroke="var(--accent)" stroke-width="${N > 600 ? 1.5 : 2}" stroke-linejoin="round"/>`;
    // catchment rainfall per dekad (CHIRPS), each bar spanning its dekad's days
    let ry = null;
    if (R) {
      const top = H + 26, bot = HT - 4, ph = bot - top;
      const runs = [];
      for (let k = a, run = null; k <= b; k++) {
        const j = dekOfDay(fl.days[k]);
        if (j === undefined) { run = null; continue; }
        if (run && run.j === j) run.k1 = k; else { run = { j, k0: k, k1: k }; runs.push(run); }
      }
      const mx = runs.reduce((m, r) => Math.max(m, R.mm[r.j] || 0, R.normal[r.j] || 0), 0);
      const rt = niceTicks(0, Math.max(mx, 10), 2), rhi = rt[rt.length - 1];
      ry = (v) => bot - (ph * v) / rhi;
      for (const v of rt) {
        svg += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${ry(v)}" y2="${ry(v)}" stroke="var(--grid)"/>` +
          `<text x="${pad.l - 6}" y="${ry(v) + 4}" text-anchor="end">${compact(v)}</text>`;
      }
      svg += `<text x="${pad.l - 6}" y="${top - 8}" text-anchor="end">mm</text>` +
        `<text class="rainLbl" x="${pad.l}" y="${top - 8}">Catchment rainfall per dekad · CHIRPS v3 · ${R.area_km2.toLocaleString('en')} km² upstream</text>`;
      let nd = '';
      for (const r of runs) {
        const v = R.mm[r.j], x0 = x(r.k0) - bw / 2, w = Math.max(1, (r.k1 - r.k0 + 1) * bw - 1.5);
        if (v !== null) svg += `<rect x="${x0 + 0.75}" y="${ry(v)}" width="${w}" height="${Math.max(0, bot - ry(v))}" fill="var(--rain)"${isPre(r.j) ? ' fill-opacity="0.5"' : ''} rx="1"/>`;
        if (R.normal[r.j] !== null) nd += `M${x0},${ry(R.normal[r.j])}h${(r.k1 - r.k0 + 1) * bw}`;
      }
      svg += `<path d="${nd}" fill="none" stroke="var(--ink-2)" stroke-width="1.5" stroke-dasharray="3 2"/>`;
      svg += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${bot}" y2="${bot}" stroke="var(--axis)"/>`;
      const lastK = runs.length ? runs[runs.length - 1].k1 : a;
      if (lastK < b) svg += `<text x="${x(lastK) + bw + 4}" y="${bot - 4}">CHIRPS to ${dekName(dekads[dekads.length - 1])}</text>`;
    }
    svg += `<g id="fhov"></g><rect x="${pad.l}" y="0" width="${W - pad.l - pad.r}" height="${HT}" fill="transparent" id="fhit" style="cursor:pointer"/></svg>`;
    fchart.innerHTML = svg;

    const hit = fchart.querySelector('#fhit'), hov = fchart.querySelector('#fhov');
    const kAt = (ev) => a + Math.max(0, Math.min(N - 1, Math.floor((ev.clientX - fchart.getBoundingClientRect().left - pad.l) / bw)));
    hit.addEventListener('mousemove', (ev) => {
      const k = kAt(ev), v = Q[k], fc = k >= fl.fc0;
      hov.innerHTML = `<line x1="${x(k)}" x2="${x(k)}" y1="${pad.t}" y2="${H - pad.b}" stroke="var(--axis)"/>` +
        (v === null ? '' : `<circle cx="${x(k)}" cy="${y(v)}" r="4" fill="var(--accent)" stroke="var(--surface)" stroke-width="2"/>`);
      const t = mIdx(k), nm = C[1][k], j = R ? dekOfDay(fl.days[k]) : undefined;
      if (j !== undefined && R.mm[j] !== null) hov.innerHTML += `<line x1="${x(k)}" x2="${x(k)}" y1="${ry(R.mm[j])}" y2="${HT - 4}" stroke="var(--axis)"/>`;
      ftip.innerHTML = `<b>${dayName(fl.days[k], true)}</b>${fc ? ' · <b>Forecast</b>' : ''}${t !== undefined && D.enso.elnino[t] ? ' · <b>El Niño</b>' : ''}` +
        `<br>${fc ? 'Ensemble median' : 'Discharge'}: <b>${fmtQ(v)}</b>` +
        (fc && B[0][k - fl.fc0] !== null ? `<br><span class="m">Middle half ${fmtQ(B[0][k - fl.fc0])} – ${fmtQ(B[1][k - fl.fc0])}; max ${fmtQ(B[3][k - fl.fc0])}</span>` : '') +
        (Qc ? `<br>${esc(fl.st[cmpK].label)}: <b>${fmtQ(Qc[k])}</b>` : '') +
        (nm ? `<br>Normal (1991–2020 median): ${fmtQ(nm)} <span class="m">· ${v === null ? '—' : Math.round((100 * v) / nm) + '%'}</span>` : '') +
        `<br>${v === null ? '' : `${(v / s.rp[2]).toFixed(2)} × RP2`}${s.trigger && inOND(fl.days[k]) && v !== null ? ` <span class="m">· ${Math.round((100 * v) / s.trigger)}% of OND trigger</span>` : ''}` +
        (j !== undefined ? `<br>Catchment rain ${dekName(dekads[j])}${isPre(j) ? ' (prelim.)' : ''}: <b>${R.mm[j] === null ? '—' : R.mm[j] + ' mm'}</b>` +
          (R.rank[j] !== null ? ` <span class="m">· ${ordinal(R.rank[j])} percentile, ${R.pct[j]}% of average</span>` : '') : '');
      ftip.hidden = false;
      const wrap = fchart.parentElement.getBoundingClientRect();
      ftip.style.left = Math.min(ev.clientX - wrap.left + 12, wrap.width - ftip.offsetWidth - 8) + 'px';
      ftip.style.top = fchart.offsetTop + 8 + 'px';
    });
    hit.addEventListener('mouseleave', () => { hov.innerHTML = ''; ftip.hidden = true; });
    hit.addEventListener('click', (ev) => {
      const k = kAt(ev), t = mIdx(k), dd = days.indexOf(fl.days[k]);
      const j = dekOfDay(fl.days[k]);
      if (M[mapKey()].daily && dd >= 0) setDay(dd);
      else if (M[mapKey()].dekadal && j !== undefined) setDekad(j);
      else if (t !== undefined) setMonth(t);
    });
    renderFloodStats();
    renderStrip();
  }

  // headline numbers for the selected gauge
  function renderFloodStats() {
    const s = fl.st[fl.gi], Q = F.q[fl.gi], C = F.clim[fl.gi];
    let pk = -1, pkK = null, dRP2 = 0, enDays = 0, enAbove = 0, otDays = 0, otAbove = 0;
    for (let k = 0; k < fl.fc0; k++) {
      const v = Q[k]; if (v === null) continue;
      if (v > pk) { pk = v; pkK = k; }
      const up = v >= s.rp[2]; dRP2 += up;
      const t = fl.monIdx.get(fl.days[k].slice(0, 7));
      if (t === undefined) continue;
      if (D.enso.elnino[t]) { enDays++; enAbove += up; } else { otDays++; otAbove += up; }
    }
    const last = fl.fc0 - 1, nm = C[1][last];
    let fpk = null, fpkK = null;
    for (let k = fl.fc0; k < fl.days.length; k++) if (Q[k] !== null && (fpk === null || Q[k] > fpk)) { fpk = Q[k]; fpkK = k; }
    const pct = (x, y) => (y ? `${((100 * x) / y).toFixed(1)}%` : '—');
    const card = (h, v, sub) => `<div class="fcard"><span class="lbl">${h}</span><b>${v}</b><span class="m">${sub}</span></div>`;
    $('floodStats').innerHTML =
      card('Latest', fmtQ(Q[last]), `${dayName(fl.days[last])} · ${nm ? Math.round((100 * Q[last]) / nm) + '% of normal' : ''}`) +
      card('Forecast peak', fmtQ(fpk), fpk === null ? '' : `${dayName(fl.days[fpkK])} · ${(fpk / s.rp[2]).toFixed(2)} × RP2` +
        (s.trigger && inOND(fl.days[fpkK]) ? ` · ${Math.round((100 * fpk) / s.trigger)}% of trigger` : '')) +
      card(`Peak since ${monthName(fl.days[0].slice(0, 7))}`, fmtQ(pk), pkK === null ? '' : `${dayName(fl.days[pkK], true)} · ${(pk / s.rp[2]).toFixed(2)} × RP2`) +
      card('Days at or above RP2', dRP2.toLocaleString('en'), `of ${fl.fc0.toLocaleString('en')} days since ${monthName(fl.days[0].slice(0, 7))}`) +
      card('Share of days ≥ RP2', `${pct(enAbove, enDays)} <span class="vs">El Niño</span>`, `${pct(otAbove, otDays)} in other months`) +
      card('Flood levels (1984–2025)', `RP2 ${fmtQ(s.rp[2])}`,
        `RP5 ${fmtQ(s.rp[5])} · OND trigger ${fmtQ(s.trigger)} · record ${fmtQ(s.max_q)} (${s.max_year})`);
    const R = RN && RN.gauges[fl.gi];
    if (R && dekads.length >= 3) {
      const js = [dekads.length - 3, dekads.length - 2, dekads.length - 1];
      const tot = js.reduce((t, j) => (t === null || R.mm[j] === null ? null : t + R.mm[j]), 0);
      const nrm = js.reduce((t, j) => (t === null || R.normal[j] === null ? null : t + R.normal[j]), 0);
      $('floodStats').innerHTML += card('Catchment rainfall, last 3 dekads', tot === null ? '—' : `${Math.round(tot)} mm`,
        `${dekName(dekads[js[0]])} – ${dekName(dekads[js[2]], true)}${isPre(js[2]) ? " (incl. preliminary)" : ""}${tot !== null && nrm >= 5 ? ` · ${Math.round((100 * tot) / nrm)}% of average` : ''}`);
    }
    const cv = RV && $('gaugeCmp').value !== '' ? +$('gaugeCmp').value : null;
    if (cv !== null) {
      const rel = connected(fl.gi).find((o) => o.k === cv);
      const [a, b] = rel && rel.rel === 'downstream' ? [fl.gi, cv] : [cv, fl.gi];   // upstream gauge leads
      const tl = travelLag(a, b);
      // GloFAS daily values at these points rise and fall on the same day even 1,000 km apart, so this
      // reports how closely the two gauges move together rather than a travel time
      $('floodStats').innerHTML += card('Agreement with ' + esc(fl.st[cv].label), tl ? `r ${tl.r.toFixed(2)}` : '—',
        tl ? `day-to-day changes; best at ${tl.lag ? `${tl.lag}-day lag (${esc(fl.st[a].label)} first)` : 'the same day'} · ${tl.n.toLocaleString('en')} days` : 'not enough overlap');
    }
    $('selZone').textContent = `Select at-risk woredas (${s.zone_idx.length})`;
  }

  // overview: every gauge × month, coloured by the month's peak relative to RP2
  function renderStrip() {
    const T = months.length, rows = fl.st.length;
    const lw = 190, cw = Math.max(6, Math.min(22, (($('fstrip').clientWidth || 800) - lw - 8) / T)), ch = 16, top = 22;
    const Wd = lw + cw * T + 8, Hd = top + rows * (ch + 2) + 4;
    let s = `<svg viewBox="0 0 ${Wd} ${Hd}" width="${Wd}" height="${Hd}" role="img" aria-label="Monthly peak discharge relative to RP2 for every gauge">`;
    for (let t = 0; t < T; t++) {
      if (D.enso.elnino[t]) s += `<rect x="${lw + t * cw}" y="${top - 6}" width="${cw}" height="4" fill="var(--enso-ink)"/>`;
      if (months[t].endsWith('-01') || t === 0) s += `<text x="${lw + t * cw}" y="${top - 10}">${monthName(months[t])}</text>`;
    }
    s += `<text x="${lw - 8}" y="${top - 10}" text-anchor="end" class="ensoLbl">▬ El Niño</text>`;
    let prevRiver = null;
    fl.st.forEach((g, r) => {
      const yy = top + r * (ch + 2);
      const name = g.river !== prevRiver ? `${g.river}: ` : '';
      prevRiver = g.river;
      s += `<text x="${lw - 8}" y="${yy + 12}" text-anchor="end" class="${r === fl.gi ? 'on' : ''}" data-r="${r}">${esc(name + g.label.replace(/ \(.*\)$/, ''))}</text>`;
      for (let t = 0; t < T; t++) {
        const c = flClass(F.monthly.peak[r][t], g);
        s += `<rect x="${lw + t * cw + 1}" y="${yy}" width="${cw - 2}" height="${ch}" rx="2" fill="${c === null ? 'var(--nodata)' : FL_CLS[c].c}" data-r="${r}" data-t="${t}"/>`;
      }
    });
    const sel = top + fl.gi * (ch + 2);
    s += `<rect x="${lw - 1}" y="${sel - 1}" width="${cw * T + 2}" height="${ch + 2}" fill="none" stroke="var(--ink)" stroke-width="1.5" rx="3"/>`;
    s += `<rect x="${lw + state.t * cw}" y="${top - 2}" width="${cw}" height="${rows * (ch + 2) + 2}" fill="none" stroke="var(--ink-2)" stroke-dasharray="2 2"/>`;
    s += '</svg>';
    const el = $('fstrip');
    el.innerHTML = s;
    const tipEl = $('fstripTip');
    el.querySelector('svg').addEventListener('mousemove', (ev) => {
      const r = ev.target.dataset.r, t = ev.target.dataset.t;
      if (r === undefined || t === undefined) { tipEl.hidden = true; return; }
      const g = fl.st[+r], v = F.monthly.peak[+r][+t];
      tipEl.innerHTML = `<b>${esc(g.label)}</b> · ${monthName(months[+t])}${D.enso.elnino[+t] ? ' · <b>El Niño</b>' : ''}` +
        `<br>Peak ${fmtQ(v)}${v === null ? '' : ` · ${(v / g.rp[2]).toFixed(2)} × RP2`}` +
        `<br>Days ≥ RP2: ${F.monthly.d_rp2[+r][+t] ?? '—'} · mean vs normal: ${F.monthly.anom[+r][+t] === null ? '—' : (F.monthly.anom[+r][+t] > 0 ? '+' : '') + F.monthly.anom[+r][+t] + '%'}`;
      tipEl.hidden = false;
      const wrap = el.parentElement.getBoundingClientRect();
      tipEl.style.left = Math.min(ev.clientX - wrap.left + 12, wrap.width - tipEl.offsetWidth - 8) + 'px';
      tipEl.style.top = ev.clientY - wrap.top + 14 + 'px';
    });
    el.querySelector('svg').addEventListener('mouseleave', () => { tipEl.hidden = true; });
    el.querySelector('svg').addEventListener('click', (ev) => {
      const r = ev.target.dataset.r, t = ev.target.dataset.t;
      if (r !== undefined) setGauge(+r);
      if (t !== undefined) setMonth(+t);
    });
  }

  if (fl) {
    const gs = $('gaugeSel');
    gs.innerHTML = F.rivers.map((rv) => `<optgroup label="${esc(rv)}">` +
      fl.st.map((s, k) => (s.river === rv ? `<option value="${k}">${esc(s.label)}</option>` : '')).join('') + '</optgroup>').join('');
    gs.addEventListener('change', () => setGauge(+gs.value, true));
    for (const b of document.querySelectorAll('#floodRange button')) {
      b.addEventListener('click', () => {
        fl.range = b.dataset.range;
        for (const o of document.querySelectorAll('#floodRange button')) o.setAttribute('aria-pressed', String(o === b));
        renderFlood();
      });
    }
    $('showNormal').addEventListener('change', (e) => { fl.normal = e.target.checked; renderFlood(); });
    $('showGauges').addEventListener('change', (e) => {
      for (const id of ['g-sel', 'g-pt', 'catch-line']) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', e.target.checked ? 'visible' : 'none');
    });
    $('selZone').addEventListener('click', () => setSelection(fl.st[fl.gi].zone_idx));
    $('zoomGauge').addEventListener('click', () => setGauge(fl.gi, true));
    map.on('mouseenter', 'g-pt', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mousemove', 'g-pt', (e) => {
      const k = e.features[0].id, s = fl.st[k], p = flPeriod(), v = flValue(k, p), c = flClass(v, s);
      tip.innerHTML = `<b>${esc(s.label)}</b> <span class="m">${esc(s.river)} gauge</span><br>` +
        `${esc(p.label)}: <b>${fmtQ(v)}</b>${v === null ? '' : ` <span class="m">· ${(v / s.rp[2]).toFixed(2)} × RP2</span>`}` +
        (c === null ? '' : `<br><i class="sw" style="background:${FL_CLS[c].c};border-radius:50%"></i>${FL_CLS[c].label}`) +
        '<br><span class="m">Click for its discharge series</span>';
      tip.hidden = false;
      const r = map.getContainer().getBoundingClientRect();
      tip.style.left = Math.min(e.point.x + 14, r.width - tip.offsetWidth - 8) + 'px';
      tip.style.top = Math.min(e.point.y + 14, r.height - tip.offsetHeight - 8) + 'px';
    });
    map.on('mouseleave', 'g-pt', () => { tip.hidden = true; map.getCanvas().style.cursor = ''; });
    map.on('click', 'g-pt', (e) => {
      setGauge(e.features[0].id);
      $('floodWrap').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
    $('floodSrc').textContent = `GloFAS v4 via Open-Meteo, fetched ${F.fetched.slice(0, 10)} · gauges and OND trigger levels from OCHA (dashboard issued ${F.ocha_issued})`;
  } else {
    $('floodWrap').hidden = true; $('gaugeCtl').hidden = true;
  }

  // ---------- river network linking the gauges (HydroRIVERS) ----------
  const RV = window.RIVERS && fl ? window.RIVERS : null;
  const rvInfo = RV ? RV.gauges.reduce((o, g) => ((o[g.k] = g), o), {}) : {};
  function addRiverLayers() {
    if (!RV || map.getSource('rv')) return;
    const vis = $('showRivers').checked ? 'visible' : 'none';
    const dark = isDark();
    const before = map.getLayer('m-pt') ? 'm-pt' : map.getLayer('g-sel') ? 'g-sel' : undefined;
    map.addSource('rv', { type: 'geojson', data: RV.geojson });
    map.addSource('rvc', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: RV.confluences.map((c, j) => ({ type: 'Feature', properties: { j }, geometry: { type: 'Point', coordinates: c.xy } })) },
    });
    const w = (lo, hi) => ['interpolate', ['linear'], ['ln', ['max', 1, ['get', 'q']]], 0, lo, 7.5, hi];
    const main = ['==', ['get', 'role'], 'main'];
    // casing first so the blue line reads over every viridis step
    map.addLayer({ id: 'rv-case', type: 'line', source: 'rv', layout: { visibility: vis, 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': dark ? '#0b0b0b' : '#ffffff', 'line-width': ['case', main, w(2.6, 7), w(1.6, 3.6)], 'line-opacity': 0.75 } }, before);
    map.addLayer({ id: 'rv-line', type: 'line', source: 'rv', layout: { visibility: vis, 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': ['case', main, dark ? '#5aa9f0' : '#1f5fa8', dark ? '#7fa9d6' : '#5b8cc4'], 'line-width': ['case', main, w(1.2, 4.6), w(0.5, 2)] } }, before);
    // the selected gauge's catchment (lighter) and its path downstream (bold)
    map.addLayer({ id: 'rv-up', type: 'line', source: 'rv', layout: { visibility: vis, 'line-cap': 'round' }, filter: ['in', fl.gi, ['get', 'd']],
      paint: { 'line-color': '#ff9d5c', 'line-width': w(1, 2.6) } }, before);
    map.addLayer({ id: 'rv-dn', type: 'line', source: 'rv', layout: { visibility: vis, 'line-cap': 'round' }, filter: ['in', fl.gi, ['get', 'g']],
      paint: { 'line-color': '#ff4f1f', 'line-width': w(2, 5.5) } }, before);
    if (!map.hasImage('flow-arrow')) {
      // a chevron pointing along the line (east = direction of drawing = downstream in HydroRIVERS)
      const sz = 24, cv = document.createElement('canvas'); cv.width = cv.height = sz;
      const x = cv.getContext('2d'); x.strokeStyle = '#000'; x.lineWidth = 4; x.lineCap = 'round'; x.lineJoin = 'round';
      x.beginPath(); x.moveTo(8, 5); x.lineTo(16, 12); x.lineTo(8, 19); x.stroke();
      map.addImage('flow-arrow', { width: sz, height: sz, data: new Uint8Array(x.getImageData(0, 0, sz, sz).data.buffer) }, { sdf: true });
    }
    map.addLayer({ id: 'rv-arrow', type: 'symbol', source: 'rv', filter: main,
      layout: { visibility: vis, 'symbol-placement': 'line', 'symbol-spacing': 110, 'icon-image': 'flow-arrow', 'icon-size': 0.55,
        'icon-allow-overlap': true, 'icon-ignore-placement': true, 'icon-rotation-alignment': 'map', 'icon-keep-upright': false },
      paint: { 'icon-color': dark ? '#d6e8fb' : '#ffffff' } }, before);
    map.addLayer({ id: 'rv-conf', type: 'circle', source: 'rvc', layout: { visibility: vis },
      paint: { 'circle-radius': 4.5, 'circle-color': '#ffffff', 'circle-stroke-color': '#1f5fa8', 'circle-stroke-width': 2 } }, before);
  }
  function paintRivers() {
    if (!RV || !map.getLayer('rv-dn')) return;
    map.setFilter('rv-up', ['in', fl.gi, ['get', 'd']]);
    map.setFilter('rv-dn', ['in', fl.gi, ['get', 'g']]);
  }
  // plain-language connections for the selected gauge
  function riverLinks(k) {
    if (!RV) return '';
    const nm = (j) => fl.st[j].label;
    const dn = RV.links.filter((l) => l.from === k), upl = RV.links.filter((l) => l.to === k);
    const parts = [];
    if (upl.length) parts.push('Upstream gauges: ' + upl.map((l) => `${nm(l.from)} (${l.km} km)`).join(', '));
    if (dn.length) parts.push('Next gauge downstream: ' + dn.map((l) => `${nm(l.to)} (${l.km} km)`).join(', '));
    const named = new Set([k, ...dn.map((l) => l.to), ...upl.map((l) => l.from)]);
    for (const c of RV.confluences) {
      const me = c.gauges.find((x) => x.k === k);
      if (!me || c.xy[1] < 2.5) continue;          // skip the far Shabelle-Juba junction in Somalia
      const others = c.gauges.filter((x) => !named.has(x.k));
      others.forEach((x) => named.add(x.k));
      if (others.length) parts.push(`Joined by ${others.map((x) => nm(x.k)).join(' and ')}'s river ${me.km} km downstream`);
    }
    const g = rvInfo[k];
    if (g) parts.push(`Catchment ${g.upland_km2.toLocaleString('en')} km² · ${g.path_km.toLocaleString('en')} km to ${g.end}`);
    return parts.join(' · ');
  }

  // gauges linked along the channel can be overlaid on the discharge chart, with the travel time
  function connected(k) {
    if (!RV) return [];
    const out = new Map();
    for (const l of RV.links) {
      if (l.from === k) out.set(l.to, { k: l.to, rel: 'downstream', km: l.km });
      if (l.to === k) out.set(l.from, { k: l.from, rel: 'upstream', km: l.km });
    }
    for (const c of RV.confluences) {
      if (c.xy[1] < 2.5 || !c.gauges.some((x) => x.k === k)) continue;
      for (const x of c.gauges) if (x.k !== k && !out.has(x.k)) out.set(x.k, { k: x.k, rel: 'joins downstream', km: null });
    }
    return [...out.values()];
  }
  // lag (days) maximising the correlation of day-to-day changes in log flow: rises and falls
  // travelling down the channel, rather than the slow seasonal swing both gauges share
  function travelLag(a, b) {
    const an = (k, j) => { const v = F.q[k][j], u = F.q[k][j - 1]; return j > 0 && v > 0 && u > 0 ? Math.log(v / u) : null; };
    let best = null;
    for (let lag = 0; lag <= 20; lag++) {
      let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, n = 0;
      for (let j = lag; j < fl.fc0; j++) {
        const x = an(a, j - lag), y = an(b, j);
        if (x === null || y === null) continue;
        sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; n++;
      }
      if (n < 60) continue;
      const r = (n * sxy - sx * sy) / Math.sqrt((n * sxx - sx * sx) * (n * syy - sy * sy));
      if (best === null || r > best.r) best = { lag, r, n };
    }
    return best;
  }
  function fillCompare() {
    const sel = $('gaugeCmp');
    const opts = connected(fl.gi);
    sel.innerHTML = '<option value="">Compare with a connected gauge…</option>' +
      opts.map((o) => `<option value="${o.k}">${esc(fl.st[o.k].label)} · ${o.rel}${o.km !== null ? ` ${o.km} km` : ''}</option>`).join('');
    sel.disabled = !opts.length;
    if (!opts.some((o) => String(o.k) === sel.dataset.v)) sel.dataset.v = '';
    sel.value = sel.dataset.v || '';
  }

  if (RV) {
    $('showRivers').addEventListener('change', (e) => {
      for (const id of ['rv-case', 'rv-line', 'rv-up', 'rv-dn', 'rv-arrow', 'rv-conf']) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', e.target.checked ? 'visible' : 'none');
    });
    $('gaugeCmp').addEventListener('change', (e) => { e.target.dataset.v = e.target.value; renderFlood(); });
    map.on('mousemove', 'rv-line', (e) => {
      if (map.queryRenderedFeatures(e.point, { layers: ['g-pt', 'm-pt', 'rv-conf'].filter((id) => map.getLayer(id)) }).length) return;
      const p = e.features[0].properties, g = JSON.parse(p.g || '[]'), d = JSON.parse(p.d || '[]');
      const via = g.length ? `downstream of ${g.map((k) => esc(fl.st[k].label)).join(', ')}` : d.length ? `drains to ${esc(fl.st[d[0]].label)}` : '';
      tip.innerHTML = `<b>${esc(p.river)}</b> <span class="m">river system</span><br>Mean flow ≈ <b>${Math.round(p.q).toLocaleString('en')} m³/s</b> <span class="m">· catchment ${(+p.up).toLocaleString('en')} km²</span>` +
        (via ? `<br><span class="m">${via}</span>` : '');
      tip.hidden = false;
      const r = map.getContainer().getBoundingClientRect();
      tip.style.left = Math.min(e.point.x + 14, r.width - tip.offsetWidth - 8) + 'px';
      tip.style.top = Math.min(e.point.y + 14, r.height - tip.offsetHeight - 8) + 'px';
    });
    map.on('mousemove', 'rv-conf', (e) => {
      const c = RV.confluences[e.features[0].properties.j];
      tip.innerHTML = '<b>Confluence</b><br>' + c.gauges.map((x) => `${esc(fl.st[x.k].label)}: <b>${x.km} km</b> downstream`).join('<br>');
      tip.hidden = false;
      const r = map.getContainer().getBoundingClientRect();
      tip.style.left = Math.min(e.point.x + 14, r.width - tip.offsetWidth - 8) + 'px';
      tip.style.top = Math.min(e.point.y + 14, r.height - tip.offsetHeight - 8) + 'px';
    });
    for (const id of ['rv-line', 'rv-conf']) map.on('mouseleave', id, () => { tip.hidden = true; });
    fillCompare();
  } else {
    $('riverRow').hidden = true; $('gaugeCmp').hidden = true;
  }

  // ---------- food prices (World Bank RTFP) synchronised with heat and river flooding ----------
  const FP = window.FOOD;
  const fp = FP ? {
    mk: FP.markets, mi: 0, com: 'food_price_index', meas: 'drel', heat: M.tmax_anom ? 'tmax_anom' : state.lastTemporal,
    flood: 'anom', maxLag: 6, obsOnly: false,
    fm: new Map(FP.months.map((m, k) => [m, k])),
  } : null;
  const HEAT_T = keys.filter((k) => M[k].group === 'Heat' && M[k].temporal);
  const FP_MEAS = {
    rel: { label: 'Price vs national average', unit: '%', breaks: [-20, -10, -3, 3, 10, 20] },
    drel: { label: 'Monthly change vs national', unit: 'pp', breaks: [-6, -3, -1, 1, 3, 6] },
    mom: { label: 'Monthly price change', unit: '%', breaks: [-6, -3, -1, 1, 3, 6] },
    yoy: { label: 'Year-on-year inflation', unit: '%', breaks: [0, 10, 20, 35, 50, 70] },
  };
  const FL_MEAS = {
    anom: { label: 'River flow vs normal (monthly mean)', unit: '%' },
    ratio: { label: 'Monthly peak flow ÷ RP2', unit: '× RP2' },
  };
  // price measure for market i at food-month index k
  function fpVal(i, k, meas = fp.meas, com = fp.com) {
    if (k === undefined || k < 0) return null;
    if (meas === 'yoy') return com === 'food_price_index' ? FP.yoy[i][k] : null;
    const p = FP.price[com][i], nat = FP.national[com];
    const rel = (j) => (p[j] === null || !nat[j] ? null : 100 * (p[j] / nat[j] - 1));
    if (meas === 'rel') return rel(k);
    if (k === 0) return null;
    if (meas === 'drel') { const a = rel(k), b = rel(k - 1); return a === null || b === null ? null : a - b; }
    return p[k] === null || !p[k - 1] ? null : 100 * (p[k] / p[k - 1] - 1);   // mom
  }
  const fpAt = (i, t, meas, com) => fpVal(i, fp.fm.get(months[t]), meas, com);   // t = map month index
  const natAt = (t, meas = fp.meas, com = fp.com) => {
    const k = fp.fm.get(months[t]); if (k === undefined) return null;
    const nat = FP.national[com];
    if (meas === 'rel' || meas === 'drel') return 0;
    if (meas === 'yoy') return com === 'food_price_index' ? FP.yoy_national[k] : null;
    return k && nat[k] !== null && nat[k - 1] ? 100 * (nat[k] / nat[k - 1] - 1) : null;
  };
  const heatAt = (i, t) => valueAt(fp.heat, fp.mk[i].woreda, t);
  // survey flags: bit j = FP.commodities[j] surveyed; the index counts as surveyed if any input was
  const comBit = (com) => FP.commodities.findIndex((c) => c.key === com);
  const surveyed = (i, k, com = fp.com) => { const b = FP.obs[i][k] || 0; const j = comBit(com); return j === 0 ? b > 0 : !!(b & (1 << j)); };
  const nSurveyed = (i, k) => { let b = FP.obs[i][k] || 0, c = 0; while (b) { c += b & 1; b >>= 1; } return c; };
  const floodAt = (i, t) => {
    const g = fp.mk[i].gauge;
    if (g === null || !F) return null;
    return fp.flood === 'anom' ? F.monthly.anom[g][t] : F.monthly.ratio[g][t];
  };
  const fpFmt = (v, unit) => (v === null || v === undefined ? '—' : `${v > 0 && unit !== '× RP2' ? '+' : ''}${unit === '× RP2' ? v.toFixed(2) : v.toFixed(1)} ${unit}`);
  const fpBin = (v) => { if (v === null || v === undefined) return -1; const b = FP_MEAS[fp.meas].breaks; let c = 0; while (c < b.length && v >= b[c]) c++; return c; };

  // ---- map layer: one diamond per market, coloured by the price measure for the month ----
  function diamondImage() {
    const s = 32, c = document.createElement('canvas'); c.width = c.height = s;
    const x = c.getContext('2d'); x.fillStyle = '#000';
    x.beginPath(); x.moveTo(s / 2, 1); x.lineTo(s - 1, s / 2); x.lineTo(s / 2, s - 1); x.lineTo(1, s / 2); x.closePath(); x.fill();
    return { width: s, height: s, data: new Uint8Array(x.getImageData(0, 0, s, s).data.buffer) };
  }
  function addMarketLayer() {
    if (!fp || map.getSource('m')) return;
    if (!map.hasImage('diamond')) map.addImage('diamond', diamondImage(), { sdf: true });
    map.addSource('m', {
      type: 'geojson', promoteId: 'k',
      data: { type: 'FeatureCollection', features: fp.mk.map((m, k) => ({ type: 'Feature', properties: { k }, geometry: { type: 'Point', coordinates: [m.lon, m.lat] } })) },
    });
    const cls = ['coalesce', ['feature-state', 'c'], -1], on = ['boolean', ['feature-state', 'on'], false];
    const vis = $('showMarkets').checked ? 'visible' : 'none';
    map.addLayer({
      id: 'm-pt', type: 'symbol', source: 'm',
      layout: { visibility: vis, 'icon-image': 'diamond', 'icon-size': 0.42, 'icon-allow-overlap': true, 'icon-ignore-placement': true },
      paint: {
        'icon-color': ['match', cls, ...DIVERGING.flatMap((c, i) => [i, c]), cssVar('--nodata')],
        'icon-halo-color': ['case', on, '#ffffff', '#0b0b0b'], 'icon-halo-width': ['case', on, 3, 1.2],
      },
    }, map.getLayer('g-sel') ? 'g-sel' : undefined);
    paintMarkets();
  }
  function paintMarkets() {
    if (!fp) return;
    if (map.getSource('m')) fp.mk.forEach((m, k) => map.setFeatureState({ source: 'm', id: k }, { c: fpBin(fpAt(k, state.t)), on: k === fp.mi }));
    const ms = FP_MEAS[fp.meas], b = ms.breaks;
    const com = FP.commodities.find((c) => c.key === fp.com).label;
    $('marketLegend').innerHTML = `<div class="gPeriod">${esc(com)} · ${esc(ms.label.toLowerCase())} · ${monthName(months[state.t])}</div>` +
      `<div class="legBar">${DIVERGING.map((c) => `<span style="background:${c}"></span>`).join('')}</div>` +
      `<div class="legTicks"><span></span>${b.map((x) => `<span>${x > 0 && fp.meas !== 'yoy' ? '+' : ''}${x}</span>`).join('')}<span></span></div>` +
      `<div class="legNo"><i></i>No price · units: ${ms.unit}</div>`;
  }
  function setMarket(k, fly = false) {
    fp.mi = k;
    $('marketSel').value = String(k);
    paintMarkets(); renderFood();
    if (fly) map.flyTo({ center: [fp.mk[k].lon, fp.mk[k].lat], zoom: Math.max(map.getZoom(), 7), duration: 600 });
  }

  // ---- stacked panels on one month axis: price, heat at the market's woreda, flow at its gauge ----
  const fpEl = $('fpchart'), fpTip = $('fpTip');
  function renderFood() {
    if (!fp) return;
    const i = fp.mi, m = fp.mk[i], w = D.woredas[m.woreda], g = m.gauge !== null && F ? F.stations[m.gauge] : null;
    const com = FP.commodities.find((c) => c.key === fp.com);
    $('foodTitle').textContent = `${m.name} market · ${com.label}`;
    $('foodWhere').textContent = `${m.adm1} · in ${w.name} woreda (${w.zone})` +
      (g ? ` · river gauge: ${g.label}, ${m.gauge_km} km away` : ' · no flood gauge covers this market');
    const T = months.length, W = fpEl.clientWidth;
    const panels = [
      { id: 'price', title: `${FP_MEAS[fp.meas].label} (${FP_MEAS[fp.meas].unit})`, f: (t) => fpAt(i, t), nat: (t) => natAt(t), unit: FP_MEAS[fp.meas].unit, kind: 'line' },
      { id: 'heat', title: `${M[fp.heat].label}${M[fp.heat].unit ? ` (${M[fp.heat].unit})` : ''} · ${w.name}`, f: (t) => heatAt(i, t), unit: M[fp.heat].unit, kind: 'bar', div: !!M[fp.heat].diverging },
    ];
    if (g) panels.push({ id: 'flood', title: `${FL_MEAS[fp.flood].label} · ${g.label}`, f: (t) => floodAt(i, t), unit: FL_MEAS[fp.flood].unit, kind: 'bar', div: fp.flood === 'anom', ref: fp.flood === 'ratio' ? 1 : null });
    const ph = 92, gap = 26, pad = { l: 56, r: 12, t: 36, b: 22 };
    const H = pad.t + panels.length * ph + (panels.length - 1) * gap + pad.b;
    fpEl.style.height = H + 'px';
    if (W < 160) { renderLags(); return; }
    const x = (t) => pad.l + ((W - pad.l - pad.r) * (t + 0.5)) / T, bw = (W - pad.l - pad.r) / T;
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Food price, heat and river flow by month at ${esc(m.name)}">`;
    // El Niño months across every panel
    let t0 = null;
    for (let t = 0; t <= T; t++) {
      const on = t < T && D.enso.elnino[t];
      if (on && t0 === null) t0 = t;
      if (!on && t0 !== null) {
        s += `<rect x="${x(t0) - bw / 2}" y="${pad.t}" width="${bw * (t - t0)}" height="${H - pad.t - pad.b}" fill="var(--enso)"/>` +
          `<text class="ensoLbl" x="${x(t0) - bw / 2 + 4}" y="12">El Niño</text>`;
        t0 = null;
      }
    }
    s += `<rect x="${x(state.t) - bw / 2}" y="${pad.t}" width="${bw}" height="${H - pad.t - pad.b}" fill="none" stroke="var(--muted)" stroke-dasharray="3 3"/>`;
    const ys = [];
    panels.forEach((p, n) => {
      const top = pad.t + n * (ph + gap), bot = top + ph;
      const vals = []; for (let t = 0; t < T; t++) { const v = p.f(t); if (v !== null && v !== undefined) vals.push(v); if (p.nat) { const u = p.nat(t); if (u !== null) vals.push(u); } }
      let lo = vals.length ? Math.min(...vals) : 0, hi = vals.length ? Math.max(...vals) : 1;
      if (p.kind === 'bar' || p.div) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
      if (p.div || p.id === 'price' && fp.meas !== 'yoy') { const a = Math.max(Math.abs(lo), Math.abs(hi)) || 1; lo = -a; hi = a; }
      if (p.ref) hi = Math.max(hi, p.ref * 1.1);
      if (hi - lo < 1e-6) hi = lo + 1;
      const tk = niceTicks(lo, hi, 3); lo = Math.min(lo, tk[0]); hi = Math.max(hi, tk[tk.length - 1]);
      const y = (v) => top + ph * (1 - (v - lo) / (hi - lo));
      ys.push(y);
      s += `<text x="${pad.l}" y="${top - 6}" class="pTitle">${esc(p.title)}</text>`;
      for (const v of tk) s += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}" stroke="var(--grid)"/><text x="${pad.l - 6}" y="${y(v) + 4}" text-anchor="end">${+v.toFixed(2)}</text>`;
      if (lo < 0 && hi > 0) s += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(0)}" y2="${y(0)}" stroke="var(--axis)"/>`;
      if (p.ref) s += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(p.ref)}" y2="${y(p.ref)}" stroke="var(--ink-2)" stroke-dasharray="6 4"/><text x="${W - pad.r - 2}" y="${y(p.ref) - 4}" text-anchor="end">RP2</text>`;
      if (p.kind === 'bar') {
        const base = y(Math.max(lo, Math.min(0, hi)));
        for (let t = 0; t < T; t++) {
          const v = p.f(t); if (v === null || v === undefined) continue;
          const yy = y(v), fill = p.id === 'flood' ? (p.div ? (v >= 0 ? 'var(--wet)' : 'var(--dry)') : v >= 1 ? 'var(--wet)' : '#9ecae1')
            : p.div ? (v >= 0 ? 'var(--warm)' : 'var(--cool)') : 'var(--warm)';
          s += `<rect x="${x(t) - bw / 2 + 1}" y="${Math.min(yy, base)}" width="${Math.max(1, bw - 2)}" height="${Math.max(1, Math.abs(base - yy))}" fill="${fill}" rx="1"/>`;
        }
      } else {
        let d = '', dn = '', pen = false, pn = false;
        for (let t = 0; t < T; t++) {
          const v = p.f(t);
          if (v === null || v === undefined) pen = false; else { d += `${pen ? 'L' : 'M'}${x(t).toFixed(1)},${y(v).toFixed(1)}`; pen = true; }
          const u = p.nat ? p.nat(t) : null;
          if (u === null) pn = false; else { dn += `${pn ? 'L' : 'M'}${x(t).toFixed(1)},${y(u).toFixed(1)}`; pn = true; }
        }
        if (dn && !(fp.meas === 'rel' || fp.meas === 'drel')) s += `<path d="${dn}" fill="none" stroke="var(--national)" stroke-width="1.5"/>`;
        s += `<path d="${d}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round"/>`;
        // months with a survey price (not modelled) get a filled dot
        for (let t = 0; t < T; t++) {
          const k = fp.fm.get(months[t]), v = p.f(t);
          if (k !== undefined && v !== null && surveyed(i, k)) s += `<circle cx="${x(t)}" cy="${y(v)}" r="2.6" fill="var(--accent)" stroke="var(--surface)" stroke-width="1"/>`;
        }
      }
    });
    for (let t = 0; t < T; t++) {
      if (!(months[t].endsWith('-01') || months[t].endsWith('-07') || t === 0)) continue;
      s += `<text x="${x(t)}" y="${H - 6}" text-anchor="middle">${monthName(months[t])}</text>`;
    }
    s += `<g id="fphov"></g><rect x="${pad.l}" y="0" width="${W - pad.l - pad.r}" height="${H}" fill="transparent" id="fphit" style="cursor:pointer"/></svg>`;
    fpEl.innerHTML = s;
    const hit = fpEl.querySelector('#fphit'), hov = fpEl.querySelector('#fphov');
    const tAt = (ev) => Math.max(0, Math.min(T - 1, Math.floor((ev.clientX - fpEl.getBoundingClientRect().left - pad.l) / bw)));
    hit.addEventListener('mousemove', (ev) => {
      const t = tAt(ev), k = fp.fm.get(months[t]);
      hov.innerHTML = `<line x1="${x(t)}" x2="${x(t)}" y1="${pad.t}" y2="${H - pad.b}" stroke="var(--axis)"/>`;
      const p0 = FP.price[fp.com][i][k ?? -1], n0 = FP.national[fp.com][k ?? -1];
      fpTip.innerHTML = `<b>${monthName(months[t])}</b>${D.enso.elnino[t] ? ' · <b>El Niño</b>' : ''}` +
        `<br>${esc(com.label)}: <b>${p0 === undefined || p0 === null ? '—' : p0.toLocaleString('en', { maximumFractionDigits: 2 })}</b> <span class="m">${com.unit} · national ${n0 === undefined || n0 === null ? '—' : n0.toLocaleString('en', { maximumFractionDigits: 2 })}</span>` +
        `<br>${FP_MEAS[fp.meas].label}: <b>${fpFmt(fpAt(i, t), FP_MEAS[fp.meas].unit)}</b> <span class="m">· ${k !== undefined && surveyed(i, k) ? (fp.com === 'food_price_index' ? `${nSurveyed(i, k)} of its commodities surveyed` : 'survey price') : 'modelled (no survey)'}</span>` +
        `<br>${M[fp.heat].label}: <b>${withUnit(heatAt(i, t), fp.heat)}</b>` +
        (g ? `<br>${FL_MEAS[fp.flood].label}: <b>${fpFmt(floodAt(i, t), FL_MEAS[fp.flood].unit)}</b>` : '');
      fpTip.hidden = false;
      const wrap = fpEl.parentElement.getBoundingClientRect();
      fpTip.style.left = Math.min(ev.clientX - wrap.left + 12, wrap.width - fpTip.offsetWidth - 8) + 'px';
      fpTip.style.top = fpEl.offsetTop + 8 + 'px';
    });
    hit.addEventListener('mouseleave', () => { hov.innerHTML = ''; fpTip.hidden = true; });
    hit.addEventListener('click', (ev) => setMonth(tAt(ev)));
    renderLags();
  }

  // ---- lagged association: heat (or flow) in month t − lag vs the price measure in month t ----
  function lagStats(series, idxList, lag) {
    // pooled across markets after removing each market's own mean, so levels don't drive it
    const xs = [], ys = [];
    for (const i of idxList) {
      const px = [], py = [];
      for (let t = lag; t < months.length; t++) {
        const a = series(i, t - lag), b = fpAt(i, t);
        if (a === null || a === undefined || b === null || b === undefined) continue;
        if (fp.obsOnly) {   // only months with a survey price (both months, for a change measure)
          const k = fp.fm.get(months[t]);
          if (!surveyed(i, k) || (fp.meas !== 'rel' && fp.meas !== 'yoy' && !surveyed(i, k - 1))) continue;
        }
        px.push(a); py.push(b);
      }
      if (px.length < 6) continue;
      const mx = px.reduce((u, v) => u + v, 0) / px.length, my = py.reduce((u, v) => u + v, 0) / py.length;
      for (let j = 0; j < px.length; j++) { xs.push(px[j] - mx); ys.push(py[j] - my); }
    }
    return { rho: xs.length >= 8 ? spearman(xs, ys) : null, n: xs.length };
  }
  function lagChart(el, rows, title) {
    // rows: [{label, cls, stats: [{rho, n}] by lag}]
    const L = fp.maxLag + 1, W = Math.max(260, el.clientWidth || 320), H = 168, pad = { l: 34, r: 8, t: 22, b: 30 };
    const gw = (W - pad.l - pad.r) / L, bwid = Math.min(14, (gw - 6) / rows.length);
    let A = 0.2;
    for (const r of rows) for (const st of r.stats) if (st && st.rho !== null) A = Math.max(A, Math.abs(st.rho));
    A = Math.ceil(A * 10) / 10;
    const y = (v) => pad.t + (H - pad.t - pad.b) * (1 - (v + A) / (2 * A));
    let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="${esc(title)}"><text x="${pad.l}" y="12" class="pTitle">${esc(title)} · Spearman ρ</text>`;
    for (const v of [-A, -A / 2, 0, A / 2, A].map((u) => +u.toFixed(2))) s += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}" stroke="${v === 0 ? 'var(--axis)' : 'var(--grid)'}"/><text x="${pad.l - 4}" y="${y(v) + 4}" text-anchor="end">${v}</text>`;
    for (let lag = 0; lag < L; lag++) {
      const cx = pad.l + gw * lag + gw / 2;
      s += `<text x="${cx}" y="${H - 14}" text-anchor="middle">${lag}</text>`;
      rows.forEach((r, j) => {
        const st = r.stats[lag]; if (!st || st.rho === null) return;
        const bx = cx - (rows.length * bwid) / 2 + j * bwid, sig = Math.abs(st.rho) > 1.96 / Math.sqrt(Math.max(1, st.n - 1));
        s += `<rect x="${bx + 1}" y="${Math.min(y(st.rho), y(0))}" width="${bwid - 2}" height="${Math.max(1, Math.abs(y(st.rho) - y(0)))}" rx="2" class="${r.cls}" fill-opacity="${sig ? 1 : 0.35}"><title>${esc(r.label)} · lag ${lag} mo · ρ ${st.rho.toFixed(2)} · n ${st.n}${sig ? '' : ' · not significant'}</title></rect>`;
      });
    }
    s += `<text x="${pad.l + (W - pad.l - pad.r) / 2}" y="${H - 1}" text-anchor="middle">months the ${title.startsWith('Flow') ? 'flow' : 'heat'} leads the price</text></svg>`;
    el.innerHTML = s;
  }
  const lagCache = {};
  function renderLags() {
    const i = fp.mi, all = fp.mk.map((_, k) => k), linked = all.filter((k) => fp.mk[k].gauge !== null);
    const L = [...Array(fp.maxLag + 1).keys()];
    const ck = (what) => `${what}|${fp.com}|${fp.meas}|${fp.heat}|${fp.flood}|${fp.obsOnly}`;
    const pooled = (what, ser, idx) => (lagCache[ck(what)] ||= L.map((l) => lagStats(ser, idx, l)));
    const hAll = pooled('h', heatAt, all), hOne = L.map((l) => lagStats(heatAt, [i], l));
    lagChart($('lagHeat'), [{ label: `All ${all.length} markets`, cls: 'bAll', stats: hAll }, { label: fp.mk[i].name, cls: 'bOne', stats: hOne }],
      `Heat → price · ${M[fp.heat].label}`);
    if (F && linked.length) {
      const fAll = pooled('f', floodAt, linked), fOne = fp.mk[i].gauge !== null ? L.map((l) => lagStats(floodAt, [i], l)) : [];
      lagChart($('lagFlood'), [{ label: `${linked.length} gauge-linked markets`, cls: 'bAll', stats: fAll }, ...(fOne.length ? [{ label: fp.mk[i].name, cls: 'bOne', stats: fOne }] : [])],
        `Flow → price · ${FL_MEAS[fp.flood].label}`);
    }
    // plain-language read of the strongest pooled lag
    const best = (arr) => arr.reduce((b, st, l) => (st.rho !== null && (!b || Math.abs(st.rho) > Math.abs(b.rho)) ? { ...st, lag: l } : b), null);
    const say = (b, what, up) => {
      if (!b) return `Not enough overlapping data for ${what}.`;
      const sig = Math.abs(b.rho) > 1.96 / Math.sqrt(b.n - 1);
      return `${what}: strongest at a ${b.lag}-month lag, ρ = ${b.rho.toFixed(2)} (${b.n.toLocaleString('en')} market-months)` +
        (sig ? `: ${up} ${b.rho > 0 ? 'go with relatively higher prices' : 'go with relatively lower prices'}${b.lag ? ` ${b.lag} month${b.lag > 1 ? 's' : ''} later` : ' in the same month'}.` : ', which is within chance.');
    };
    $('lagNote').innerHTML = say(best(hAll), 'Heat across all markets', 'higher values of this heat measure') + '<br>' +
      (F && linked.length ? say(best(pooled('f', floodAt, linked)), 'River flow at the gauge-linked markets', 'months with higher river flow') : '');
  }

  if (fp) {
    const ms = $('marketSel');
    const regions = [...new Set(fp.mk.map((m) => m.adm1))];
    ms.innerHTML = regions.map((r) => `<optgroup label="${esc(r)}">` +
      fp.mk.map((m, k) => (m.adm1 === r ? `<option value="${k}">${esc(m.name)}${m.gauge !== null ? ' · gauge' : ''}</option>` : '')).join('') + '</optgroup>').join('');
    ms.addEventListener('change', () => setMarket(+ms.value, true));
    $('fpCom').innerHTML = FP.commodities.map((c) => `<option value="${c.key}">${esc(c.label)}</option>`).join('');
    $('fpCom').addEventListener('change', (e) => {
      fp.com = e.target.value;
      if (fp.meas === 'yoy' && fp.com !== 'food_price_index') { fp.meas = 'drel'; $('fpMeas').value = 'drel'; }
      paintMarkets(); renderFood();
    });
    $('fpMeas').innerHTML = Object.entries(FP_MEAS).map(([k, v]) => `<option value="${k}">${v.label}${k === 'yoy' ? ' (index only)' : ''}</option>`).join('');
    $('fpMeas').value = fp.meas;
    $('fpMeas').addEventListener('change', (e) => {
      fp.meas = e.target.value;
      if (fp.meas === 'yoy') { fp.com = 'food_price_index'; $('fpCom').value = fp.com; }
      paintMarkets(); renderFood();
    });
    $('fpHeat').innerHTML = HEAT_T.map((k) => `<option value="${k}">${esc(M[k].label)}</option>`).join('');
    $('fpHeat').value = fp.heat;
    $('fpHeat').addEventListener('change', (e) => { fp.heat = e.target.value; renderFood(); });
    $('fpFlood').innerHTML = Object.entries(FL_MEAS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');
    $('fpFlood').addEventListener('change', (e) => { fp.flood = e.target.value; renderFood(); });
    $('fpFlood').closest('label').hidden = !F;
    $('fpObs').addEventListener('change', (e) => { fp.obsOnly = e.target.checked; renderLags(); });
    $('showMarkets').addEventListener('change', (e) => map.getLayer('m-pt') && map.setLayoutProperty('m-pt', 'visibility', e.target.checked ? 'visible' : 'none'));
    $('fpWoreda').addEventListener('click', () => pick(fp.mk[fp.mi].woreda, false, true));
    $('fpGauge').addEventListener('click', () => {
      const g = fp.mk[fp.mi].gauge;
      if (g !== null && fl) { setGauge(g, true); $('floodWrap').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    });
    map.on('mouseenter', 'm-pt', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mousemove', 'm-pt', (e) => {
      const k = e.features[0].id, m = fp.mk[k], com = FP.commodities.find((c) => c.key === fp.com);
      tip.innerHTML = `<b>${esc(m.name)}</b> <span class="m">market · ${esc(m.adm1)}</span><br>` +
        `${esc(com.label)}, ${esc(FP_MEAS[fp.meas].label.toLowerCase())}: <b>${fpFmt(fpAt(k, state.t), FP_MEAS[fp.meas].unit)}</b> <span class="m">· ${monthName(months[state.t])}</span>` +
        `<br>${M[fp.heat].label}: <b>${withUnit(heatAt(k, state.t), fp.heat)}</b>` +
        (m.gauge !== null && F ? `<br>Gauge: ${esc(F.stations[m.gauge].label)} (${m.gauge_km} km)` : '') +
        '<br><span class="m">Click for its price, heat and flood series</span>';
      tip.hidden = false;
      const r = map.getContainer().getBoundingClientRect();
      tip.style.left = Math.min(e.point.x + 14, r.width - tip.offsetWidth - 8) + 'px';
      tip.style.top = Math.min(e.point.y + 14, r.height - tip.offsetHeight - 8) + 'px';
    });
    map.on('mouseleave', 'm-pt', () => { tip.hidden = true; map.getCanvas().style.cursor = ''; });
    map.on('click', 'm-pt', (e) => { setMarket(e.features[0].id); $('foodWrap').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); });
    $('foodSrc').textContent = `${FP.source}, release ${FP.release || '—'}. Months without a survey price are modelled by the World Bank (no dot on the line).`;
    const addis = fp.mk.findIndex((m) => m.name === 'Gode');
    fp.mi = addis >= 0 ? addis : 0;
    ms.value = String(fp.mi);
  } else {
    $('foodWrap').hidden = true; $('marketCtl').hidden = true;
  }

  // ---------- PNG export: every chart and the map, with title, legend and sources ----------
  const SITE = 'aschroedercr.github.io/eth-woredas-heat-flood-food';
  const SRC = {
    heat: 'Heat: CrisisReady HeatReady API (ERA5-Land, Open-Meteo)',
    enso: 'El Niño: NOAA CPC ONI',
    pop: 'Population: LandScan 2024; age: WorldPop R2025A',
    flood: 'River flow: GloFAS v4 (Copernicus EMS) via Open-Meteo; gauges and OND trigger: OCHA',
    rivers: 'Rivers: HydroRIVERS v1.0',
    food: 'Food prices: World Bank RTFP',
    rain: 'Rainfall: CHIRPS v3.0 (UCSB Climate Hazards Center)',
    basins: 'Catchments: HydroBASINS v1c',
    base: 'Boundaries: OCHA COD-AB; basemap © Mapbox © OpenStreetMap',
  };
  const PNG_FONT = getComputedStyle(document.body).fontFamily || 'system-ui, sans-serif';
  const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

  // SVG -> image: copy computed styles inline (the page CSS and its var() colours don't travel)
  const SVG_PROPS = ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-opacity', 'stroke-linecap',
    'stroke-linejoin', 'opacity', 'font-size', 'font-family', 'font-weight', 'text-anchor', 'dominant-baseline', 'font-variant-numeric'];
  function svgImage(svg) {
    const r = svg.getBoundingClientRect();
    const w = Math.round(r.width) || +svg.getAttribute('width') || 600, h = Math.round(r.height) || +svg.getAttribute('height') || 300;
    const clone = svg.cloneNode(true);
    const src = [svg, ...svg.querySelectorAll('*')], dst = [clone, ...clone.querySelectorAll('*')];
    src.forEach((el, i) => {
      const cs = getComputedStyle(el);
      dst[i].setAttribute('style', SVG_PROPS.map((p) => `${p}:${cs.getPropertyValue(p)}`).join(';') + (cs.display === 'none' ? ';display:none' : ''));
    });
    clone.querySelectorAll('title, #hov, #fhov, #fphov, #hit, #fhit, #fphit').forEach((el) => el.remove());
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('width', w); clone.setAttribute('height', h);
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' }));
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); res({ img, w, h }); };
      img.onerror = (e) => { URL.revokeObjectURL(url); rej(e); };
      img.src = url;
    });
  }

  // legend items read from an on-page legend row (swatch colour + label)
  function legendFromRow(row) {
    if (!row) return [];
    return [...row.children].filter((s) => s.tagName !== 'BUTTON' && !s.hidden && getComputedStyle(s).display !== 'none').map((s) => {
      const i = s.querySelector('i');
      const label = s.textContent.trim();
      if (!i) return { kind: 'text', label };
      const cs = getComputedStyle(i);
      if (cs.borderTopStyle === 'dashed') return { kind: 'dash', color: cs.borderTopColor, label };
      if (i.classList.contains('box') || i.classList.contains('bAllKey') || i.classList.contains('bOneKey')) return { kind: 'box', color: cs.backgroundColor, stroke: cs.borderTopColor, label };
      return { kind: 'line', color: cs.backgroundColor, label };
    }).filter((it) => it.label);
  }

  // wrap text to a width; returns lines
  function wrap(ctx, text, width) {
    const words = String(text).split(/\s+/), lines = [];
    let line = '';
    for (const w of words) {
      const t = line ? line + ' ' + w : w;
      if (ctx.measureText(t).width > width && line) { lines.push(line); line = w; } else line = t;
    }
    if (line) lines.push(line);
    return lines;
  }

  // draw legend items flowing left to right; returns the height used (dry run when draw = false)
  function drawLegend(ctx, items, x0, y0, width, draw) {
    ctx.font = `12px ${PNG_FONT}`;
    let x = x0, y = y0, lineH = 0;
    const rowH = 20, gap = 18;
    for (const it of items) {
      let w;
      if (it.kind === 'ramp') w = it.colors.length * 26 + ctx.measureText(it.label || '').width + 12;
      else if (it.kind === 'biv') w = 3 * 16 + 12 + Math.max(ctx.measureText(it.xLabel).width, ctx.measureText(it.yLabel).width) + 8;
      else w = (it.kind === 'text' ? 0 : 22) + ctx.measureText(it.label).width;
      const h = it.kind === 'ramp' ? 30 : it.kind === 'biv' ? 52 : rowH;
      // a text label starts a new row (it introduces the items after it)
      if (x > x0 && (x + w > x0 + width || it.kind === 'text')) { y += lineH + 4; x = x0; lineH = 0; }
      if (draw) drawItem(ctx, it, x, y);
      x += w + gap; lineH = Math.max(lineH, h);
    }
    return y - y0 + lineH;
  }
  function drawItem(ctx, it, x, y) {
    const cy = y + 10;
    ctx.textBaseline = 'middle';
    ctx.fillStyle = cssVar('--ink-2');
    if (it.kind === 'text') { ctx.fillText(it.label, x, cy); return; }
    if (it.kind === 'line' || it.kind === 'dash') {
      ctx.strokeStyle = it.color; ctx.lineWidth = 2.5; ctx.setLineDash(it.kind === 'dash' ? [5, 4] : []);
      ctx.beginPath(); ctx.moveTo(x, cy); ctx.lineTo(x + 16, cy); ctx.stroke(); ctx.setLineDash([]);
    } else if (it.kind === 'box') {
      ctx.fillStyle = it.color; ctx.fillRect(x, cy - 6, 14, 12);
      if (it.stroke) { ctx.strokeStyle = it.stroke; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, cy - 5.5, 13, 11); }
    } else if (it.kind === 'circle') {
      ctx.fillStyle = it.color; ctx.strokeStyle = it.stroke || '#0b0b0b'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(x + 7, cy, Math.min(it.r || 5, 8), 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
    } else if (it.kind === 'diamond') {
      ctx.fillStyle = it.color; ctx.strokeStyle = '#0b0b0b'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(x + 7, cy - 7); ctx.lineTo(x + 14, cy); ctx.lineTo(x + 7, cy + 7); ctx.lineTo(x, cy); ctx.closePath(); ctx.fill(); ctx.stroke();
    } else if (it.kind === 'ramp') {
      it.colors.forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(x + i * 26, y + 2, 24, 10); });
      ctx.fillStyle = cssVar('--ink-2'); ctx.font = `10px ${PNG_FONT}`; ctx.textAlign = 'center';
      it.ticks.forEach((t, i) => ctx.fillText(t, x + (i + 1) * 26 - 1, y + 22));
      ctx.textAlign = 'left'; ctx.font = `12px ${PNG_FONT}`;
      ctx.fillText(it.label || '', x + it.colors.length * 26 + 8, y + 7);
      return;
    } else if (it.kind === 'biv') {
      for (let p = 2; p >= 0; p--) for (let h = 0; h < 3; h++) { ctx.fillStyle = BIV[p][h]; ctx.fillRect(x + h * 16, y + (2 - p) * 16, 15, 15); }
      ctx.fillStyle = cssVar('--ink-2');
      ctx.fillText(`↑ ${it.yLabel}`, x + 3 * 16 + 10, y + 8);
      ctx.fillText(`${it.xLabel} →`, x + 3 * 16 + 10, y + 40);
      return;
    }
    ctx.fillStyle = cssVar('--ink-2');
    ctx.fillText(it.label, x + 22, cy);
  }

  // lay out title, subtitle, legend, the graphic(s) and a source line on one canvas, then download
  async function exportPNG({ name, title, sub, legend = [], graphics, sources }) {
    const S = 2, pad = 20, gap = 16;
    const gw = graphics.reduce((s, g) => s + g.w, 0) + gap * (graphics.length - 1);
    const W = Math.max(640, gw + 2 * pad), inner = W - 2 * pad;
    const m = document.createElement('canvas').getContext('2d');
    m.font = `600 18px ${PNG_FONT}`; const tLines = wrap(m, title, inner);
    m.font = `13px ${PNG_FONT}`; const sLines = sub ? wrap(m, sub, inner) : [];
    const legH = legend.length ? drawLegend(m, legend, pad, 0, inner, false) + 6 : 0;
    m.font = `11px ${PNG_FONT}`;
    const foot = `Source: ${sources.join(' · ')}. Ethiopia Woredas: Heat, Flooding, and Food Prices — ${SITE} · exported ${new Date().toISOString().slice(0, 10)}`;
    const fLines = wrap(m, foot, inner);
    const gh = Math.max(...graphics.map((g) => g.h));
    const H = pad + tLines.length * 24 + sLines.length * 18 + (sLines.length ? 4 : 0) + 8 + legH + gh + 12 + fLines.length * 15 + pad;
    const cv = document.createElement('canvas'); cv.width = W * S; cv.height = H * S;
    const ctx = cv.getContext('2d'); ctx.scale(S, S);
    ctx.fillStyle = cssVar('--surface') || '#ffffff'; ctx.fillRect(0, 0, W, H);
    let y = pad;
    ctx.textBaseline = 'top'; ctx.fillStyle = cssVar('--ink'); ctx.font = `600 18px ${PNG_FONT}`;
    for (const l of tLines) { ctx.fillText(l, pad, y); y += 24; }
    ctx.fillStyle = cssVar('--ink-2'); ctx.font = `13px ${PNG_FONT}`;
    for (const l of sLines) { ctx.fillText(l, pad, y); y += 18; }
    y += (sLines.length ? 4 : 0) + 8;
    if (legend.length) { drawLegend(ctx, legend, pad, y, inner, true); y += legH; }
    let x = pad;
    for (const g of graphics) { ctx.drawImage(g.img, x, y, g.w, g.h); x += g.w + gap; }
    y += gh + 12;
    ctx.textBaseline = 'top'; ctx.fillStyle = cssVar('--muted'); ctx.font = `11px ${PNG_FONT}`;
    for (const l of fLines) { ctx.fillText(l, pad, y); y += 15; }
    const blob = await new Promise((res) => cv.toBlob(res, 'image/png'));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `eth-woredas_${slug(name)}_${new Date().toISOString().slice(0, 10)}.png`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    return { width: cv.width, height: cv.height, bytes: blob.size, file: a.download };
  }

  const txt = (id) => ($(id) ? $(id).innerText.replace(/\s*\n\s*/g, ' ').trim() : '');
  const svgsIn = (...ids) => ids.map((id) => $(id) && $(id).querySelector('svg')).filter(Boolean);
  const FL_LEGEND = () => FL_CLS.map((c) => ({ kind: 'circle', color: c.c, r: c.r, label: c.label }));
  const EXPORTS = {
    chart: () => ({ name: txt('chartTitle'), title: txt('chartTitle'), sub: state.sel.length ? selLabel() : 'Ethiopia',
      legend: legendFromRow($('chartLegend')), svgs: svgsIn('chart'), sources: [M[chartKey()].group === 'Rainfall' ? SRC.rain : SRC.heat, SRC.enso, SRC.pop] }),
    scatter: () => ({ name: txt('scatterTitle'), title: txt('scatterTitle'), sub: `${M[state.y].label} vs ${M[state.x].label}${state.xLog ? ' (log x)' : ''} · ${txt('rho')}`,
      legend: [], svgs: svgsIn('scatter'), sources: [SRC.heat, SRC.pop] }),
    flood: () => ({ name: txt('floodTitle'), title: txt('floodTitle'), sub: [txt('floodWhere'), txt('floodLinks')].filter(Boolean).join(' · '),
      legend: legendFromRow($('floodWrap').querySelector('.fleg')), svgs: svgsIn('fchart'), sources: [SRC.flood, ...(RN ? [SRC.rain, SRC.basins] : []), SRC.enso, SRC.rivers] }),
    strip: () => ({ name: 'all-gauges-monthly-peak', title: 'All flood gauges · monthly peak discharge relative to the 2-year flood (RP2)',
      sub: 'Bar above the months marks El Niño; dashed column is the month selected on the map', legend: FL_LEGEND(), svgs: svgsIn('fstrip'), sources: [SRC.flood, SRC.enso] }),
    food: () => ({ name: txt('foodTitle'), title: txt('foodTitle'), sub: txt('foodWhere'),
      legend: legendFromRow($('foodWrap').querySelector('.fleg')), svgs: svgsIn('fpchart'), sources: [SRC.food, SRC.heat, SRC.flood, SRC.enso] }),
    lags: () => ({ name: `lags-${txt('foodTitle')}`, title: `Lagged association with prices · ${txt('foodTitle')}`, sub: txt('lagNote'),
      legend: legendFromRow($('foodWrap').querySelectorAll('.fleg')[1]), svgs: svgsIn('lagHeat', 'lagFlood'), sources: [SRC.food, SRC.heat, SRC.flood] }),
  };
  async function exportChart(key) {
    const spec = EXPORTS[key]();
    if (!spec.svgs.length) throw new Error('nothing drawn to export');
    const graphics = await Promise.all(spec.svgs.map(svgImage));
    return exportPNG({ ...spec, graphics });
  }

  // the map: the WebGL canvas plus a legend for whatever is switched on
  function mapLegend() {
    const items = [];
    if (state.mode === 'bi') {
      items.push({ kind: 'biv', xLabel: `${M[state.y].label} (thirds)`, yLabel: `${M[state.x].label} (thirds)` });
    } else {
      const key = state.metric, b = breaks(key), ramp = rampFor(key).slice(-(b.length + 1));
      items.push({ kind: 'ramp', colors: ramp, ticks: b.map((v) => fmt(v, key)), label: `${M[key].label}${M[key].unit ? ` (${M[key].unit})` : ''}` });
    }
    items.push({ kind: 'box', color: cssVar('--nodata'), label: 'No data' });
    const on = (id) => map.getLayer(id) && map.getLayoutProperty(id, 'visibility') !== 'none';
    if (fl && on('g-pt')) items.push({ kind: 'text', label: `Gauges (${flPeriod().label}):` }, ...FL_LEGEND());
    if (RV && on('rv-line')) items.push({ kind: 'line', color: isDark() ? '#5aa9f0' : '#1f5fa8', label: 'Rivers linking the gauges' },
      { kind: 'line', color: '#ff4f1f', label: `Downstream of ${fl.st[fl.gi].label}` });
    if (on('catch-line') && RN.catchments[fl.gi]) items.push({ kind: 'dash', color: isDark() ? '#f0efec' : '#0b0b0b', label: `Catchment of ${fl.st[fl.gi].label}` });
    if (fp && on('m-pt')) {
      const ms = FP_MEAS[fp.meas];
      items.push({ kind: 'diamond', color: '#f0efec', label: 'Food markets:' },
        { kind: 'ramp', colors: DIVERGING, ticks: ms.breaks.map(String), label: `${FP.commodities.find((c) => c.key === fp.com).label}, ${ms.label.toLowerCase()} (${ms.unit})` });
    }
    return items;
  }
  async function exportMap() {
    // wait (briefly) for tiles to finish; the drawing buffer keeps the last frame, so read it either way
    const settle = (ev, ms) => new Promise((r) => { const t = setTimeout(r, ms); map.once(ev, () => { clearTimeout(t); r(); }); });
    if (!map.loaded()) await settle('idle', 4000);
    map.triggerRepaint(); await settle('render', 500);
    const c = map.getCanvas(), r = c.getBoundingClientRect();
    const img = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = c.toDataURL('image/png'); });
    const key = mapKey();
    const title = state.mode === 'bi'
      ? `${M[state.y].label} × ${M[state.x].label}${periodOf(state.y) ? ` · ${periodOf(state.y)}` : ''}`
      : `${M[key].label}${periodOf(key) ? ` · ${periodOf(key)}` : ''}`;
    const sub = `Ethiopia woredas${state.sel.length ? ` · selected: ${selLabel()}` : ''}`;
    const srcs = [M[key].group === 'Rainfall' ? SRC.rain : SRC.heat, SRC.pop, SRC.enso];
    if (fl && map.getLayer('g-pt') && map.getLayoutProperty('g-pt', 'visibility') !== 'none') srcs.push(SRC.flood, SRC.rivers);
    if (fp && map.getLayer('m-pt') && map.getLayoutProperty('m-pt', 'visibility') !== 'none') srcs.push(SRC.food);
    srcs.push(SRC.base);
    return exportPNG({ name: `map-${title}`, title, sub, legend: mapLegend(), graphics: [{ img, w: Math.round(r.width), h: Math.round(r.height) }], sources: srcs });
  }

  // buttons: one per chart (data-png="key") plus a map control
  for (const b of document.querySelectorAll('button.png')) {
    b.addEventListener('click', async () => {
      const label = b.textContent; b.disabled = true; b.textContent = 'Saving…';
      try { await (b.dataset.png === 'map' ? exportMap() : exportChart(b.dataset.png)); } catch (e) { console.error('PNG export failed:', e); alert('Sorry, the PNG export failed.'); }
      b.disabled = false; b.textContent = label;
    });
  }
  class PngControl {
    onAdd() {
      this.el = document.createElement('div');
      this.el.className = 'mapboxgl-ctrl mapboxgl-ctrl-group';
      this.el.innerHTML = '<button type="button" class="png mapPng" data-png="map" title="Download the map as PNG" aria-label="Download the map as PNG">PNG</button>';
      const b = this.el.querySelector('button');
      b.addEventListener('click', async () => {
        b.disabled = true;
        try { await exportMap(); } catch (e) { console.error('PNG export failed:', e); alert('Sorry, the map export failed.'); }
        b.disabled = false;
      });
      return this.el;
    }
    onRemove() { this.el.remove(); }
  }
  map.addControl(new PngControl(), 'top-right');

  // ---------- theme ----------
  $('themeBtn').addEventListener('click', () => {
    document.documentElement.dataset.theme = isDark() ? 'light' : 'dark';
    try { localStorage.setItem('eth-heat-theme', document.documentElement.dataset.theme); } catch (e) { /* ignore */ }
    map.setStyle(styleUrl());
    renderLegend(); renderChart(); renderScatter();
    if (fl) { paintGauges(); renderFlood(); }
    if (fp) renderFood();
  });
  try {
    const saved = localStorage.getItem('eth-heat-theme');
    if (saved) { document.documentElement.dataset.theme = saved; map.setStyle(styleUrl()); }
  } catch (e) { /* ignore */ }

  window.addEventListener('resize', () => { renderChart(); renderScatter(); if (fl) renderFlood(); if (fp) renderFood(); });
  window.heatApp = { map, setGauge: fl ? setGauge : null, setMarket: fp ? setMarket : null, select, setSelection, setMetric, setMonth, setDay, setMode, setAxis, aggregate, state };
  for (const s of axisSels) s.value = state[s.dataset.axis];
  sLog.checked = state.xLog = isCount(state.x);
  setMetric(state.metric);
  setDay(state.d);
  setDekad(state.k);
  setMonth(state.t);
  renderDetail();
})();
