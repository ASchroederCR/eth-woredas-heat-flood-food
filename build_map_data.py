"""Turn the downloaded HeatReady rows into the map's data files.

Reads  build/raw/*.jsonl, build/raw/*.vuln.json, build/forecast/*.jsonl, build/oni.ascii.txt,
       the OCHA admin3 shapefile
Writes app/data/geo.js   (window.GEO: simplified woreda polygons, property i = index)
       app/data/data.js  (window.DATA: months, ENSO flags, monthly + static metrics per woreda,
                          plus daily values for the last few weeks and the forecast days ahead)
       app/config.js     (Mapbox public token, from ../Mapbox_Public_Token.txt)
"""
import json
import os
import re
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent
RAW = Path(os.environ.get("HEAT_RAW", ROOT / "build" / "raw"))
FCST = ROOT / "build" / "forecast"
RECENT_DAYS = 21  # observed days shown before the forecast in the daily chart
APP = ROOT / "app"
SHP = ROOT.parent / "Boundaries" / "OCHA_COD_AB" / "eth_admin3.shp"
MIN_DAYS_IN_MONTH = int(os.environ.get("HEAT_MIN_DAYS", 20))  # a trailing partial month with fewer days is left off the map


def f_to_c(f):
    return (f - 32) * 5 / 9


def load_rows():
    frames = [pd.read_json(p, lines=True) for p in sorted(RAW.glob("*/*.jsonl")) if p.stat().st_size]
    df = pd.concat(frames, ignore_index=True)
    df["date"] = pd.to_datetime(df["date"])
    df = df[df["date"] >= "2023-06-01"].drop_duplicates(["name", "date"])
    df["month"] = df["date"].dt.strftime("%Y-%m")
    return df


def monthly(df):
    df = df.assign(
        hi_max_c=f_to_c(df["day_hi_max"]),
        wbgt28=(df["day_wbgt_max"] >= 28).astype(float).where(df["day_wbgt_max"].notna()),
        utci38=(df["day_utci_max"] >= 38).astype(float).where(df["day_utci_max"].notna()),
        hotnight=(df["day_t2m_min"] >= 25).astype(float),
        tmax_anom=df["day_t2m_max"] - df["ref_day_t2m_median"],
        above_p95=(df["day_t2m_max"] > df["ref_day_t2m_p95"]).astype(float).where(df["ref_day_t2m_p95"].notna()),
        provisional=(df["data_source"] != "era5").astype(float),
    )
    g = df.groupby(["name", "month"])
    out = pd.DataFrame({
        "tmax": g["day_t2m_max"].mean(),
        "tmin": g["day_t2m_min"].mean(),
        "wbgt": g["day_wbgt_max"].mean(),
        "utci": g["daytime_utci_max"].mean(),
        "hi": g["hi_max_c"].max(),
        "d_wbgt28": g["wbgt28"].sum(min_count=1),
        "d_utci38": g["utci38"].sum(min_count=1),
        "d_hotnight": g["hotnight"].sum(),
        "tmax_anom": g["tmax_anom"].mean(),
        "d_p95": g["above_p95"].sum(min_count=1),
        "n_days": g.size(),
        "provisional": g["provisional"].mean(),
    })
    return out


def daily_cols(df):
    """Per-row daily values for the daily view, in the same units as the monthly layers."""
    return pd.DataFrame({
        "name": df["name"], "date": df["date"],
        "tmax": df["day_t2m_max"], "tmin": df["day_t2m_min"], "wbgt": df["day_wbgt_max"],
        "utci": df["daytime_utci_max"], "hi": f_to_c(df["day_hi_max"]),
        "tmax_anom": df["day_t2m_max"] - df["ref_day_t2m_median"],
    })


DAILY_SPEC = [
    ("tmax", "Daily max temperature", "°C", 1),
    ("tmin", "Daily min temperature", "°C", 1),
    ("wbgt", "WBGT (daily max)", "°C", 1),
    ("utci", "UTCI (daytime max)", "°C", 1),
    ("hi", "Heat index (daily max)", "°C", 1),
    ("tmax_anom", "Max temp vs 2016–25 normal", "°C", 1),
]


def build_daily(df, fc, idx, n, w):
    """Daily values for the last RECENT_DAYS observed days followed by the forecast days."""
    obs = daily_cols(df[df["date"] > df["date"].max() - pd.Timedelta(days=RECENT_DAYS)])
    fcd = daily_cols(fc) if fc is not None else obs.iloc[0:0]
    both = pd.concat([obs, fcd], ignore_index=True)
    both = both[both["name"].isin(idx)].copy()
    both["day"] = both["date"].dt.strftime("%Y-%m-%d")
    both["i"] = both["name"].map(idx)
    days = sorted(both["day"].unique())
    out = {}
    for key, label, unit, dp in DAILY_SPEC:
        piv = both.pivot_table(index="day", columns="i", values=key, aggfunc="first").reindex(index=days, columns=range(n))
        arr = piv.to_numpy(dtype=float)
        vals = [[None if np.isnan(v) else round(float(v), dp) for v in row] for row in arr]
        nat = []
        for row in arr:
            ok = ~np.isnan(row) & (w > 0)
            nat.append(round(float(np.average(row[ok], weights=w[ok])), 2) if ok.any() else None)
        out[key] = {"label": label, "unit": unit, "diverging": key == "tmax_anom", "values": vals, "national": nat}
    fc_days = sorted(fcd["date"].dt.strftime("%Y-%m-%d").unique()) if len(fcd) else []
    issued = str(fc["forecast_issued_at"].dropna().max()) if fc is not None and fc["forecast_issued_at"].notna().any() else None
    return {"days": days, "fc_start": days.index(fc_days[0]) if fc_days else len(days),
            "issued": issued, "metrics": out}


def enso_months(path, months):
    """El Niño months from NOAA CPC's ONI: runs of >= 5 overlapping seasons with ONI >= +0.5.

    Each 3-month season is assigned to its centre month. A run still open at the end of the record
    with >= 3 seasons is flagged provisional and carried to the last mapped month, since NOAA
    declares conditions before the five-season test can be met.
    """
    seasons = "DJF JFM FMA MAM AMJ MJJ JJA JAS ASO SON OND NDJ".split()
    rows = []
    for line in path.read_text().splitlines()[1:]:
        p = line.split()
        if len(p) == 4:
            centre = seasons.index(p[0]) + 1  # DJF -> Jan
            rows.append((f"{int(p[1]):04d}-{centre:02d}", float(p[3])))
    oni = pd.Series(dict(rows))
    warm = oni >= 0.5
    flags, provisional = {}, {}
    run = []
    for m, w in list(warm.items()) + [("end", False)]:
        if w:
            run.append(m)
            continue
        if len(run) >= 5 or (m == "end" and len(run) >= 3):
            for r in run:
                flags[r] = True
                provisional[r] = len(run) < 5
            if m == "end":
                for mm in months:
                    if mm > run[-1]:
                        flags[mm] = True
                        provisional[mm] = True
        run = []
    return {
        "elnino": [bool(flags.get(m)) for m in months],
        "provisional": [bool(provisional.get(m)) for m in months],
        "oni": [None if m not in oni else round(float(oni[m]), 2) for m in months],
        "oni_last": oni.index[-1],
    }


def main():
    g = gpd.read_file(SHP)[["adm3_pcode", "adm3_name", "adm2_name", "adm1_name", "area_sqkm", "geometry"]]
    g = g.sort_values("adm3_pcode").reset_index(drop=True)
    idx = {p: i for i, p in enumerate(g["adm3_pcode"])}

    df = load_rows()
    m = monthly(df)
    counts = m.groupby("month")["n_days"].median()
    months = sorted(mo for mo, n in counts.items() if n >= MIN_DAYS_IN_MONTH)
    pop = df.groupby("name")["population"].first()

    vuln = {}
    for p in RAW.glob("*.vuln.json"):
        for v in json.loads(p.read_text()):
            vuln[v["name"]] = v

    temporal_spec = [
        ("tmax", "Daily max temperature", "°C", "Monthly mean of daily maximum 2 m air temperature", 1),
        ("tmin", "Night-time low temperature", "°C", "Monthly mean of daily minimum temperature", 1),
        ("wbgt", "WBGT (daily max)", "°C", "Monthly mean of daily maximum wet-bulb globe temperature", 1),
        ("utci", "UTCI (daytime max)", "°C", "Monthly mean of daytime maximum Universal Thermal Climate Index", 1),
        ("hi", "Peak heat index", "°C", "Highest daily heat index in the month (converted from °F)", 1),
        ("d_wbgt28", "Days WBGT ≥ 28 °C", "days", "Days with max WBGT at or above 28 °C (high risk for physical work)", 0),
        ("d_utci38", "Days UTCI ≥ 38 °C", "days", "Days with max UTCI at or above 38 °C (very strong heat stress)", 0),
        ("d_hotnight", "Hot nights (min ≥ 25 °C)", "days", "Days whose minimum temperature stayed at or above 25 °C", 0),
        ("tmax_anom", "Max temp vs 2016–25 normal", "°C", "Mean difference between daily max and the 2016–2025 median for that time of year", 1),
        ("d_p95", "Days above 2016–25 95th pct", "days", "Days whose max temperature exceeded the 2016–2025 95th percentile for that time of year", 0),
    ]
    metrics, n = {}, len(g)
    for key, label, unit, desc, dp in temporal_spec:
        col = m[key].dropna()
        if col.groupby(level="month").size().reindex(months).fillna(0).median() < 0.8 * n:
            print("skipping", key, "(not enough coverage yet)")
            continue
        arr = []
        for mo in months:
            vals = [None] * n
            for name, v in m[key].xs(mo, level="month").items():
                if name in idx and pd.notna(v):
                    vals[idx[name]] = round(float(v), dp)
            arr.append(vals)
        metrics[key] = {"label": label, "unit": unit, "desc": desc, "group": "Heat", "temporal": True,
                        "diverging": key == "tmax_anom", "values": arr}

    def static(key, label, unit, desc, group, series, dp, scale=1):
        vals = [None] * n
        for name, v in series.items():
            if name in idx and v is not None and pd.notna(v):
                vals[idx[name]] = round(float(v) * scale, dp)
        if sum(v is not None for v in vals) < 0.8 * n:
            print("skipping", key, "(not enough coverage yet)")
            return
        metrics[key] = {"label": label, "unit": unit, "desc": desc, "group": group, "temporal": False,
                        "values": vals}

    area = g.set_index("adm3_pcode")["area_sqkm"]
    static("pop", "Population", "people", "LandScan Global 2024", "Population", pop, 0)
    static("density", "Population density", "per km²", "LandScan 2024 population / woreda area", "Population",
           pop / area.reindex(pop.index), 1)
    vs = pd.DataFrame.from_dict(vuln, orient="index")
    for key, col, label, unit, desc, dp, scale in [
        ("frac_u5", "frac_under5", "Children under 5", "%", "Share of population under 5 (WorldPop R2025A)", 1, 100),
        ("frac_65", "frac_elderly_65plus", "Adults 65+", "%", "Share of population aged 65 and over (WorldPop R2025A)", 1, 100),
        ("pop_u5", "pop_under5", "Children under 5 (count)", "people", "WorldPop R2025A", 0, 1),
        ("pop_65", "pop_elderly_65plus", "Adults 65+ (count)", "people", "WorldPop R2025A", 0, 1),
        ("oadr", "old_age_dependency_ratio", "Old-age dependency ratio", "", "People 65+ per person aged 15–64 (WorldPop R2025A)", 3, 1),
    ]:
        if col in vs:
            static(key, label, unit, desc, "Age", vs[col], dp, scale)

    # Exposure: vulnerable people times dangerous days, per month.
    if "pop_u5" in metrics and "d_wbgt28" in metrics:
        for key, base, label in [("exp_u5", "pop_u5", "Under-5 child-days at WBGT ≥ 28 °C"),
                                 ("exp_65", "pop_65", "65+ person-days at WBGT ≥ 28 °C")]:
            if base not in metrics:
                continue
            p = metrics[base]["values"]
            metrics[key] = {"label": label, "unit": "person-days", "group": "Exposure", "temporal": True,
                            "desc": "WorldPop count × days with max WBGT ≥ 28 °C in the month",
                            "values": [[None if d is None or p[i] is None else round(d * p[i])
                                        for i, d in enumerate(row)] for row in metrics["d_wbgt28"]["values"]]}

    w = np.array([metrics["pop"]["values"][i] or 0 for i in range(n)], dtype=float)

    # Forecast: the Open-Meteo forecast days ahead of the last observed day, summarised per woreda.
    fc = None
    files = [p for p in sorted(FCST.glob("*.jsonl")) if p.stat().st_size]
    if files:
        fc = pd.concat([pd.read_json(p, lines=True) for p in files], ignore_index=True)
        fc["date"] = pd.to_datetime(fc["date"])
        fc = fc[fc["date"] > df["date"].max()].drop_duplicates(["name", "date"])
        if not len(fc):
            fc = None
    if fc is not None:
        d = daily_cols(fc).assign(
            wbgt28=(fc["day_wbgt_max"] >= 28).astype(float).where(fc["day_wbgt_max"].notna()),
            utci38=(fc["day_utci_max"] >= 38).astype(float).where(fc["day_utci_max"].notna()),
            above_p95=(fc["day_t2m_max"] > fc["ref_day_t2m_p95"]).astype(float).where(fc["ref_day_t2m_p95"].notna()),
        )
        gf = d.groupby("name")
        nd = d["date"].nunique()
        span = f"{d['date'].min():%d %b} – {d['date'].max():%d %b %Y}"
        for key, label, unit, desc, series, dp in [
            ("fc_tmax", "Mean daily max temperature", "°C", "Mean of the forecast daily maxima", gf["tmax"].mean(), 1),
            ("fc_wbgt", "Peak WBGT", "°C", "Highest forecast daily max WBGT", gf["wbgt"].max(), 1),
            ("fc_hi", "Peak heat index", "°C", "Highest forecast daily heat index (converted from °F)", gf["hi"].max(), 1),
            ("fc_anom", "Max temp vs 2016–25 normal", "°C",
             "Mean forecast daily max minus the 2016–2025 median for that time of year", gf["tmax_anom"].mean(), 1),
            ("fc_d_wbgt28", "Days WBGT ≥ 28 °C", "days", "Forecast days with max WBGT at or above 28 °C", gf["wbgt28"].sum(min_count=1), 0),
            ("fc_d_utci38", "Days UTCI ≥ 38 °C", "days", "Forecast days with max UTCI at or above 38 °C", gf["utci38"].sum(min_count=1), 0),
            ("fc_d_p95", "Days above 2016–25 95th pct", "days",
             "Forecast days whose max temperature exceeds the 2016–2025 95th percentile", gf["above_p95"].sum(min_count=1), 0),
        ]:
            static(key, label, unit, f"{desc}, {span} ({nd} days, Open-Meteo forecast)", "Forecast", series, dp)
            if key in metrics:
                metrics[key]["diverging"] = key == "fc_anom"
        for key, base, label in [("fc_exp_u5", "pop_u5", "Under-5 child-days at WBGT ≥ 28 °C"),
                                 ("fc_exp_65", "pop_65", "65+ person-days at WBGT ≥ 28 °C")]:
            if base in metrics and "fc_d_wbgt28" in metrics:
                p, dd = metrics[base]["values"], metrics["fc_d_wbgt28"]["values"]
                metrics[key] = {"label": label, "unit": "person-days", "group": "Forecast", "temporal": False,
                                "desc": f"WorldPop count × forecast days with max WBGT ≥ 28 °C, {span}",
                                "values": [None if dd[i] is None or p[i] is None else round(dd[i] * p[i]) for i in range(n)]}
    daily = build_daily(df, fc, idx, n, w)

    # Population-weighted national series for each monthly metric.
    for key, spec in metrics.items():
        if not spec["temporal"]:
            continue
        nat = []
        for row in spec["values"]:
            v = np.array([np.nan if x is None else x for x in row], dtype=float)
            ok = ~np.isnan(v)
            if spec["group"] == "Exposure":
                nat.append(round(float(np.nansum(v)), 0))
            else:
                nat.append(round(float(np.average(v[ok], weights=w[ok])), 2) if ok.any() and w[ok].sum() else None)
        spec["national"] = nat

    prov = m["provisional"].groupby(level="month").mean().reindex(months).round(3).tolist()
    data = {
        "months": months,
        "enso": enso_months(ROOT / "build" / "oni.ascii.txt", months),
        "provisional_share": prov,
        "woredas": [{"pcode": r.adm3_pcode, "name": r.adm3_name, "zone": r.adm2_name, "region": r.adm1_name}
                    for r in g.itertuples()],
        "metrics": metrics,
        "daily": daily,
        "first_date": str(df["date"].min().date()),
        "last_date": str(df["date"].max().date()),
    }
    (APP / "data").mkdir(parents=True, exist_ok=True)
    (APP / "data" / "data.js").write_text("window.DATA=" + json.dumps(data, separators=(",", ":"), allow_nan=False) + ";",
                                          encoding="utf-8")

    web = g[["geometry"]].copy()
    web["geometry"] = web.geometry.simplify(0.003, preserve_topology=True)
    web["i"] = range(n)
    geo = json.loads(web.to_json(drop_id=True))
    text = json.dumps(geo, separators=(",", ":"))
    text = re.sub(r"(-?\d+\.\d{4})\d+", r"\1", text)
    (APP / "data" / "geo.js").write_text("window.GEO=" + text + ";", encoding="utf-8")

    token = (ROOT.parent / "Mapbox_Public_Token.txt").read_text().strip()
    token = re.search(r"pk\.[A-Za-z0-9._-]+", token).group()
    (APP / "config.js").write_text(f'window.MAPBOX_TOKEN = "{token}";\n', encoding="utf-8")

    # Stamp the data file URL so browsers fetch the new build instead of a cached copy.
    page = APP / "index.html"
    stamp = pd.Timestamp.now().strftime("%Y%m%d%H%M")
    page.write_text(re.sub(r'data/data\.js\?v=[0-9]+', f"data/data.js?v={stamp}", page.read_text(encoding="utf-8")),
                    encoding="utf-8")
    print(len(months), "months", data["first_date"], "to", data["last_date"], "|", ", ".join(metrics))
    fs = daily["fc_start"]
    print("daily", daily["days"][0], "to", daily["days"][-1], "| forecast from",
          daily["days"][fs] if fs < len(daily["days"]) else "none", "| issued", daily["issued"])


if __name__ == "__main__":
    main()
