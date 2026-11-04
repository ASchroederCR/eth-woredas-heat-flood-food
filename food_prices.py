"""Food prices at Ethiopia's markets for the woreda map, from the World Bank Real-Time Food Prices
(RTFP) market-level dataset (microdata.worldbank.org catalog 4483).

RTFP gives, per market and month, modelled open/high/low/close price estimates for each commodity
(gap-filled where no survey was taken), the raw survey price where one exists, year-on-year
inflation, and a combined food price index. We keep the monthly close (c_*) estimates, the raw
values as an "observed" flag, and the national "Market Average" series, so the app can show
each market's price relative to the national level: that strips out Ethiopia-wide moves
(the 2024 birr float, general inflation) and leaves the local signal to compare with local heat
and river flooding.

    python food_prices.py download   # fetch the RTFP zip (136 MB) into build/food/ and extract Ethiopia
    python food_prices.py build      # write app/data/food.js (needs data.js and flood.js built first)
    python food_prices.py all
"""
import json
import re
import sys
import urllib.request
import zipfile
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "build" / "food"
APP = ROOT / "app"
SHP = ROOT.parent / "Boundaries" / "OCHA_COD_AB" / "eth_admin3.shp"
URL = "https://microdata.worldbank.org/catalog/4483/download/360822"
ZIP = OUT / "WLD_RTFP_mkt.zip"
ETH = OUT / "eth_rtfp_mkt.csv"
COMMODITIES = [  # key in RTFP, label, unit
    ("food_price_index", "Food price index", "index"),
    ("maize", "Maize", "ETB / 100 kg"),
    ("sorghum", "Sorghum", "ETB / kg"),
    ("wheat", "Wheat", "ETB / 100 kg"),
    ("teff_fao", "Teff", "ETB / 100 kg"),
    ("pasta", "Pasta", "ETB / kg"),
    ("livestock_goat", "Goat", "ETB / head"),
    ("livestock_sheep", "Sheep", "ETB / head"),
]


def cmd_download():
    OUT.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(URL, headers={"User-Agent": "eth-woreda-heat-map/1.0"})
    with urllib.request.urlopen(req, timeout=600) as r:
        name = re.search(r'filename="?([^";]+)', r.headers.get("Content-Disposition", ""))
        tmp = ZIP.with_suffix(".tmp")
        with open(tmp, "wb") as f:
            while chunk := r.read(1 << 20):
                f.write(chunk)
    tmp.replace(ZIP)
    release = name.group(1) if name else "unknown"
    with zipfile.ZipFile(ZIP) as z:
        member = next(m for m in z.namelist() if m.endswith(".csv"))
        with z.open(member) as fh:
            parts = [c[c["ISO3"] == "ETH"] for c in pd.read_csv(fh, chunksize=100_000, low_memory=False)]
    df = pd.concat(parts).dropna(axis=1, how="all")
    df.to_csv(ETH, index=False)
    (OUT / "release.txt").write_text(release)
    print("release", release, "|", len(df), "Ethiopia rows,", df["mkt_name"].nunique(), "markets")


def rnd(v, dp=2):
    return None if v is None or not np.isfinite(v) else round(float(v), dp)


def haversine_km(lat1, lon1, lat2, lon2):
    p = np.pi / 180
    a = np.sin((lat2 - lat1) * p / 2) ** 2 + np.cos(lat1 * p) * np.cos(lat2 * p) * np.sin((lon2 - lon1) * p / 2) ** 2
    return 12742 * np.arcsin(np.sqrt(a))


def cmd_build():
    heat = json.loads((APP / "data" / "data.js").read_text(encoding="utf-8")[len("window.DATA="):-1])
    flood_path = APP / "data" / "flood.js"
    flood = json.loads(flood_path.read_text(encoding="utf-8")[len("window.FLOOD="):-1]) if flood_path.exists() else None
    df = pd.read_csv(ETH, low_memory=False)
    df["month"] = pd.to_datetime(df["price_date"]).dt.strftime("%Y-%m")
    # one month before the map's first month, so month-on-month change exists from the start
    first = (pd.Period(heat["months"][0]) - 1).strftime("%Y-%m")
    months = sorted(m for m in df["month"].unique() if m >= first)
    nat = df[df["mkt_name"] == "Market Average"].set_index("month")
    mk = df[(df["mkt_name"] != "Market Average") & df["lat"].notna()]

    g = gpd.read_file(SHP)[["adm3_pcode", "adm2_name", "adm1_name", "geometry"]].sort_values("adm3_pcode").reset_index(drop=True)
    meta = mk.groupby("mkt_name").agg(lat=("lat", "first"), lon=("lon", "first"), adm1=("adm1_name", "first"),
                                      adm2=("adm2_name", "first")).reset_index()
    pts = gpd.GeoDataFrame(meta, geometry=gpd.points_from_xy(meta["lon"], meta["lat"]), crs=g.crs)
    hit = gpd.sjoin(pts, g[["geometry"]], how="left", predicate="within")
    meta["woreda"] = hit.groupby(level=0)["index_right"].first().reindex(meta.index)
    # markets off a polygon edge (coordinates rounded to 0.01 deg): take the nearest woreda
    miss = meta["woreda"].isna()
    if miss.any():
        near = gpd.sjoin_nearest(pts[miss].to_crs(3857), g[["geometry"]].to_crs(3857), how="left")
        meta.loc[miss, "woreda"] = near.groupby(level=0)["index_right"].first()
    meta = meta.sort_values(["adm1", "mkt_name"]).reset_index(drop=True)

    markets = []
    for _, m in meta.iterrows():
        w = int(m["woreda"])
        rec = {"name": m["mkt_name"], "adm1": m["adm1"], "lat": round(m["lat"], 3), "lon": round(m["lon"], 3),
               "woreda": w, "gauge": None, "gauge_km": None}
        if flood:  # nearest gauge whose river's at-risk zones contain this market's woreda
            cands = [(haversine_km(m["lat"], m["lon"], s["lat"], s["lon"]), k) for k, s in enumerate(flood["stations"]) if w in s["zone_idx"]]
            if cands:
                d, k = min(cands)
                rec["gauge"], rec["gauge_km"] = k, round(float(d))
        markets.append(rec)

    by = {name: grp.set_index("month") for name, grp in mk.groupby("mkt_name")}
    price, nat_out, obs, yoy = {}, {}, [], []
    for key, _, _ in COMMODITIES:
        col = f"c_{key}"
        nat_out[key] = [rnd(nat[col].get(mo, np.nan), 3) for mo in months]
        price[key] = [[rnd(by[m["name"]][col].get(mo, np.nan), 3) for mo in months] for m in markets]
    # bit j set = commodity j (in COMMODITIES order, j >= 1) has a survey price that month
    raw = [(j, k) for j, (k, _, _) in enumerate(COMMODITIES) if k != "food_price_index" and k in df.columns]
    for m in markets:
        b = by[m["name"]].reindex(months)
        obs.append([int(sum(1 << j for j, k in raw if pd.notna(b[k].iloc[t]))) for t in range(len(months))])
        yoy.append([rnd(v, 1) for v in b["inflation_food_price_index"].values])
    n_obs = sum(sum(1 for v in o if v) for o in obs)
    out = {
        "source": "World Bank Real-Time Food Prices (RTFP), market level",
        "release": (OUT / "release.txt").read_text().strip() if (OUT / "release.txt").exists() else None,
        "months": months, "commodities": [{"key": k, "label": l, "unit": u} for k, l, u in COMMODITIES],
        "markets": markets, "price": price, "national": nat_out, "obs": obs,
        "yoy": yoy, "yoy_national": [rnd(nat["inflation_food_price_index"].get(mo, np.nan), 1) for mo in months],
    }
    (APP / "data" / "food.js").write_text("window.FOOD=" + json.dumps(out, separators=(",", ":"), allow_nan=False) + ";", encoding="utf-8")
    page = APP / "index.html"
    stamp = pd.Timestamp.now().strftime("%Y%m%d%H%M")
    page.write_text(re.sub(r"data/food\.js\?v=[0-9]+", f"data/food.js?v={stamp}", page.read_text(encoding="utf-8")), encoding="utf-8")
    linked = sum(m["gauge"] is not None for m in markets)
    print(len(markets), "markets |", months[0], "to", months[-1], "|", linked, "linked to a flood gauge |",
          f"{n_obs} market-months with a survey price ({100 * n_obs / (len(markets) * len(months)):.0f} %)")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "all"
    if cmd in ("download", "all") and not (cmd == "all" and ETH.exists()):
        cmd_download()
    if cmd in ("build", "all"):
        cmd_build()
