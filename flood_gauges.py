"""River flood gauges for the woreda map: the 14 GloFAS monitoring points of OCHA's
Ethiopia flood anticipatory-action project (github.com/OCHA-DAP/ds-aa-eth-flooding).

The station list, channel cells and OND trigger levels come from that project's published
dashboard (docs/index.html). Daily discharge (GloFAS v4 reanalysis 1984-present and the
operational ensemble forecast) comes from the Open-Meteo Flood API, which serves the same
GloFAS v4 grid without a key. Open-Meteo's nearest-cell lookup can land on a dry cell next to
the channel, so `cells` picks, among the cells within 0.1 deg, the one whose last 30 days match
the OCHA dashboard's values (usually to within 0.1-2 %).

    python flood_gauges.py cells     # match each gauge to its Open-Meteo cell (cached; once)
    python flood_gauges.py fetch     # daily history 1984-present + 30-day forecast per gauge
    python flood_gauges.py build     # write app/data/flood.js
    python flood_gauges.py all       # fetch + build (cells first if missing)
"""
import json
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import date, datetime, timezone
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
from shapely.geometry import Point

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "build" / "flood"
APP = ROOT / "app"
SHP = ROOT.parent / "Boundaries" / "OCHA_COD_AB" / "eth_admin3.shp"
DASH_URL = "https://raw.githubusercontent.com/OCHA-DAP/ds-aa-eth-flooding/main/docs/index.html"
API = "https://flood-api.open-meteo.com/v1/flood"
HIST_START = "1984-01-01"
SHOW_START = "2023-06-01"     # matches the heat layers
CLIM_YEARS = (1991, 2020)
FC_DAYS = 30
FC_VARS = ["river_discharge", "river_discharge_median", "river_discharge_p25", "river_discharge_p75",
           "river_discharge_min", "river_discharge_max"]
# OCHA zone names -> names in the COD-AB admin 3 file (zone = adm2, or region = adm1 for Sidama)
ZONE_ALIAS = {"Itang Special woreda": "Itang Special"}
# EDRMC riverine zones at risk from each river system (ZONE_RIVERS in OCHA's make_dashboard.py)
RIVER_ZONES = {
    "Wabi Shebelle": ["Shabelle"], "Genale Dawa": ["Afder", "Liban", "Daawa"], "Omo": ["South Omo"],
    "Bilate": ["Sidama", "West Guji"], "Gamo lakes": ["Gamo"],
    "Baro": ["Itang Special woreda", "Nuwer", "Agnewak"], "Akobo": ["Agnewak"],
}


def log(*a):
    print(datetime.now().strftime("%H:%M:%S"), *a, flush=True)


def get_json(url, tries=6):
    req = urllib.request.Request(url, headers={"User-Agent": "eth-woreda-heat-map/1.0"})
    for k in range(tries):
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code not in (429, 500, 502, 503, 504) or k == tries - 1:
                raise
            wait = 65 if e.code == 429 else 10 * (k + 1)
            log(f"HTTP {e.code}, retrying in {wait}s")
            time.sleep(wait)
        except urllib.error.URLError:
            if k == tries - 1:
                raise
            time.sleep(10 * (k + 1))


def ocha_dashboard():
    """Station list + trigger levels embedded in OCHA's published dashboard page."""
    req = urllib.request.Request(DASH_URL, headers={"User-Agent": "eth-woreda-heat-map/1.0"})
    html = urllib.request.urlopen(req, timeout=60).read().decode("utf-8")
    m = re.search(r"\bDATA\s*=\s*", html)
    data, _ = json.JSONDecoder().raw_decode(html[m.end():])
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "ocha_dashboard.json").write_text(json.dumps(data))
    return data


def cmd_cells():
    dash = ocha_dashboard()
    path = OUT / "cells.json"
    cells = json.loads(path.read_text()) if path.exists() else {}
    offs = [-0.1, -0.05, 0, 0.05, 0.1]
    for st in dash["stations"]:
        if st["id"] in cells:
            continue
        # candidate query points just inside each 0.05 deg cell centre around the OCHA cell
        pts = [(round(st["lat"] + a + 0.001, 3), round(st["lon"] + b + 0.001, 3)) for a in offs for b in offs]
        rec = st["recent"]
        url = (f"{API}?latitude={','.join(str(p[0]) for p in pts)}&longitude={','.join(str(p[1]) for p in pts)}"
               f"&daily=river_discharge&start_date={rec[0]['valid']}&end_date={rec[-1]['valid']}")
        res = get_json(url)
        oc = np.array([r["value"] for r in rec], dtype=float)
        best = None
        for p, r in zip(pts, res):
            om = np.array([np.nan if v is None else v for v in r["daily"]["river_discharge"]], dtype=float)
            if np.isnan(om).any():
                continue
            err = float(np.mean(np.abs(om - oc) / np.maximum(oc, 1)))
            if best is None or err < best["err"]:
                best = {"q": list(p), "cell": [r["latitude"], r["longitude"]], "err": round(err, 4)}
        cells[st["id"]] = best
        log(st["id"], "cell", best["cell"], f"match {best['err']:.2%}")
        path.write_text(json.dumps(cells, indent=1))
        time.sleep(8)
    return cells


def cmd_fetch():
    cells = json.loads((OUT / "cells.json").read_text())
    today = date.today().isoformat()
    for sid, c in cells.items():
        lat, lon = c["q"]
        h = get_json(f"{API}?latitude={lat}&longitude={lon}&daily=river_discharge"
                     f"&start_date={HIST_START}&end_date={today}")
        f = get_json(f"{API}?latitude={lat}&longitude={lon}&daily={','.join(FC_VARS)}"
                     f"&forecast_days={FC_DAYS}&past_days=0")
        hist = pd.DataFrame({"date": h["daily"]["time"], "q": h["daily"]["river_discharge"]})
        fc = pd.DataFrame(f["daily"]).rename(columns={"time": "date"})
        tmp = OUT / f"{sid}.tmp"
        tmp.write_text(json.dumps({"hist": hist.to_dict("list"), "fc": fc.to_dict("list"),
                                   "fetched": datetime.now(timezone.utc).isoformat(timespec="minutes")}))
        tmp.replace(OUT / f"{sid}.json")
        log(sid, len(hist), "days to", hist.dropna()["date"].iloc[-1], "| forecast", fc["date"].iloc[0], "..", fc["date"].iloc[-1])
        time.sleep(3)


def gumbel(annual_max, T):
    """Gumbel (method of moments) discharge for return period T years."""
    x = np.asarray(annual_max, dtype=float)
    beta = x.std(ddof=1) * np.sqrt(6) / np.pi
    mu = x.mean() - 0.5772 * beta
    return mu - beta * np.log(-np.log(1 - 1 / T))


def rnd(v, dp=1):
    return None if v is None or not np.isfinite(v) else round(float(v), dp)


def cmd_build():
    dash = json.loads((OUT / "ocha_dashboard.json").read_text())
    cells = json.loads((OUT / "cells.json").read_text())
    g = gpd.read_file(SHP)[["adm3_pcode", "adm3_name", "adm2_name", "adm1_name", "geometry"]]
    g = g.sort_values("adm3_pcode").reset_index(drop=True)   # same order/index as data.js
    heat = json.loads((APP / "data" / "data.js").read_text(encoding="utf-8")[len("window.DATA="):-1])
    months = heat["months"]

    stations, series = [], {}
    for st in dash["stations"]:
        raw = json.loads((OUT / f"{st['id']}.json").read_text())
        h = pd.Series(raw["hist"]["q"], index=pd.to_datetime(raw["hist"]["date"]), dtype=float).dropna()
        fc = pd.DataFrame(raw["fc"]).assign(date=lambda d: pd.to_datetime(d["date"])).set_index("date")
        fc = fc[fc.index > h.index.max()]

        yrs = h[(h.index.year >= 1984) & (h.index.year <= 2025)]
        amax = yrs.groupby(yrs.index.year).max()
        rp = {T: rnd(gumbel(amax, T), 0) for T in (2, 5, 10)}
        # day-of-year climatology (1991-2020, +/-7 day window)
        c = h[(h.index.year >= CLIM_YEARS[0]) & (h.index.year <= CLIM_YEARS[1])]
        doy = np.minimum(c.index.dayofyear, 365)
        clim = {}
        for d in range(1, 366):
            dist = np.abs(doy - d)
            win = c.values[np.minimum(dist, 365 - dist) <= 7]
            clim[d] = np.percentile(win, [10, 50, 90])

        pt = Point(st["lon"], st["lat"])
        hit = g[g.contains(pt)]
        zidx, zones = [], RIVER_ZONES.get(st["river"], [st["zone"]])
        for zn in zones:
            zn = ZONE_ALIAS.get(zn, zn)
            zidx += g.index[g["adm2_name"] == zn].tolist() or g.index[g["adm1_name"] == zn].tolist()
        zidx = sorted(set(int(i) for i in zidx))
        stations.append({
            "id": st["id"], "label": st["label"], "river": st["river"], "zone": st["zone"],
            "lat": st["lat"], "lon": st["lon"], "cell": cells[st["id"]]["cell"], "match": cells[st["id"]]["err"],
            "woreda": int(hit.index[0]) if len(hit) else None, "zone_idx": zidx, "zones": zones,
            "trigger": st.get("peak_level"), "rp": rp,
            "max_year": int(amax.idxmax()), "max_q": rnd(amax.max(), 0),
        })
        series[st["id"]] = (h, fc, clim, rp)

    # common daily axis: SHOW_START .. last forecast day
    last_obs = min(s[0].index.max() for s in series.values())
    last_fc = max(s[1].index.max() for s in series.values()) if any(len(s[1]) for s in series.values()) else last_obs
    days = pd.date_range(SHOW_START, last_fc, freq="D")
    fc_start = int((days <= last_obs).sum())
    q, band, clim_out, mon = [], [], [], {"peak": [], "ratio": [], "d_rp2": [], "anom": []}
    for st in stations:
        h, fc, clim, rp = series[st["id"]]
        obs = h.reindex(days[:fc_start])
        fmed = fc["river_discharge_median"].reindex(days[fc_start:]) if len(fc) else pd.Series(np.nan, days[fc_start:])
        q.append([rnd(v) for v in list(obs.values) + list(fmed.values)])
        band.append([[rnd(fc[k].get(d, np.nan)) if len(fc) else None for d in days[fc_start:]]
                     for k in ("river_discharge_p25", "river_discharge_p75", "river_discharge_min", "river_discharge_max")])
        doy = np.minimum(days.dayofyear, 365)
        clim_out.append([[rnd(clim[d][k]) for d in doy] for k in range(3)])
        # monthly, aligned to the heat map's months
        mo = h[h.index >= SHOW_START]
        gm = mo.groupby(mo.index.strftime("%Y-%m"))
        normal = {m: np.mean([clim[d][1] for d in np.minimum(pd.date_range(m + "-01", periods=pd.Period(m).days_in_month).dayofyear, 365)])
                  for m in months}
        pk = gm.max().reindex(months)
        mean = gm.mean().reindex(months)
        mon["peak"].append([rnd(v) for v in pk.values])
        mon["ratio"].append([rnd(v / rp[2], 2) if rp[2] else None for v in pk.values])
        mon["d_rp2"].append([None if not np.isfinite(v) else int(v) for v in (mo >= rp[2]).groupby(mo.index.strftime("%Y-%m")).sum().reindex(months).values.astype(float)])
        mon["anom"].append([rnd(100 * (mean[m] / normal[m] - 1), 0) if normal[m] > 0 else None for m in months])

    fetched = max(json.loads((OUT / f"{s['id']}.json").read_text())["fetched"] for s in stations)
    out = {
        "source": "GloFAS v4 (Copernicus EMS) via Open-Meteo Flood API; stations and OND trigger levels from OCHA-DAP ds-aa-eth-flooding",
        "ocha_issued": dash.get("issued"), "fetched": fetched,
        "rivers": sorted({s["river"] for s in stations}, key=[s["river"] for s in stations].index),
        "stations": stations, "days": [d.strftime("%Y-%m-%d") for d in days], "fc_start": fc_start,
        "q": q, "fc_band": band, "clim": clim_out, "monthly": mon, "months": months,
    }
    (APP / "data" / "flood.js").write_text("window.FLOOD=" + json.dumps(out, separators=(",", ":"), allow_nan=False) + ";",
                                          encoding="utf-8")
    page = APP / "index.html"
    stamp = pd.Timestamp.now().strftime("%Y%m%d%H%M")
    page.write_text(re.sub(r"data/flood\.js\?v=[0-9]+", f"data/flood.js?v={stamp}", page.read_text(encoding="utf-8")),
                    encoding="utf-8")
    log(len(stations), "gauges |", out["days"][0], "to", out["days"][-1], "| forecast from",
        out["days"][fc_start] if fc_start < len(days) else "none")
    for s in stations:
        log(f"  {s['id']:13} RP2 {s['rp'][2]:>6} RP5 {s['rp'][5]:>6} trigger {s['trigger']}  woreda {s['woreda']}  zone woredas {len(s['zone_idx'])}")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "all"
    if cmd == "cells":
        cmd_cells()
    elif cmd == "fetch":
        cmd_fetch()
    elif cmd == "build":
        cmd_build()
    elif cmd == "all":
        if not (OUT / "cells.json").exists():
            cmd_cells()
        else:
            ocha_dashboard()
        cmd_fetch()
        cmd_build()
