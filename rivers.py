"""River network for the flood gauges, from HydroRIVERS v1.0 (HydroSHEDS, Lehner & Grill 2013).

Each gauge is snapped to the HydroRIVERS reach within 12 km whose long-term mean discharge best
matches the gauge's GloFAS mean flow (so it lands on the main channel, not a side stream). From
there we follow NEXT_DOWN to the river's end (sea, lake or the edge of the study box) and collect the
upstream network above MIN_UPLAND km2, so the map shows how the gauges connect: which gauges sit on
the same river, which are upstream of which, and how far apart they are along the channel.

    python rivers.py download   # HydroRIVERS Africa shapefile (108 MB zip) into build/rivers/
    python rivers.py build      # write app/data/rivers.js (needs flood.js)
"""
import json
import re
import sys
import urllib.request
import zipfile
from collections import defaultdict
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
from shapely.geometry import Point

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "build" / "rivers"
APP = ROOT / "app"
URL = "https://data.hydrosheds.org/file/HydroRIVERS/HydroRIVERS_v10_af_shp.zip"
SHP = OUT / "src" / "HydroRIVERS_v10_af_shp" / "HydroRIVERS_v10_af.shp"
BBOX = (31.0, -1.5, 48.5, 15.5)   # Ethiopia plus the downstream reaches in Somalia, Kenya, South Sudan
MIN_UPLAND = 1500                 # km2: smallest tributary drawn upstream of a gauge
SNAP_KM = 25   # lake gauges (Abaya-Chamo) sit up to ~20 km from the nearest main reach


def cmd_download():
    OUT.mkdir(parents=True, exist_ok=True)
    z = OUT / "HydroRIVERS_v10_af_shp.zip"
    req = urllib.request.Request(URL, headers={"User-Agent": "eth-woreda-heat-map/1.0"})
    with urllib.request.urlopen(req, timeout=900) as r, open(z.with_suffix(".tmp"), "wb") as f:
        while chunk := r.read(1 << 20):
            f.write(chunk)
    z.with_suffix(".tmp").replace(z)
    zipfile.ZipFile(z).extractall(OUT / "src")
    print("downloaded", z)


def km(lat1, lon1, lat2, lon2):
    p = np.pi / 180
    a = np.sin((lat2 - lat1) * p / 2) ** 2 + np.cos(lat1 * p) * np.cos(lat2 * p) * np.sin((lon2 - lon1) * p / 2) ** 2
    return 12742 * np.arcsin(np.sqrt(a))


def cmd_build():
    flood = json.loads((APP / "data" / "flood.js").read_text(encoding="utf-8")[len("window.FLOOD="):-1])
    cols = ["HYRIV_ID", "NEXT_DOWN", "MAIN_RIV", "LENGTH_KM", "UPLAND_SKM", "DIS_AV_CMS", "ORD_STRA", "ENDORHEIC", "geometry"]
    r = gpd.read_file(SHP, bbox=BBOX, columns=cols[:-1])
    r = r[cols].set_index("HYRIV_ID")
    print(len(r), "reaches in the box")
    down = r["NEXT_DOWN"].to_dict()
    up = defaultdict(list)
    for rid, nd in down.items():
        if nd in down:
            up[nd].append(rid)

    # long-term GloFAS mean flow at each gauge (from the daily series shipped in flood.js)
    big = r[r["DIS_AV_CMS"] >= 1]
    gauges = []
    for k, s in enumerate(flood["stations"]):
        q = np.array([v for v in flood["q"][k][: flood["fc_start"]] if v is not None], dtype=float)
        qm = float(q.mean())
        cand = big.cx[s["lon"] - 0.25:s["lon"] + 0.25, s["lat"] - 0.25:s["lat"] + 0.25]
        pt = Point(s["lon"], s["lat"])
        best = None
        for rid, row in cand.iterrows():
            d = row.geometry.distance(pt) * 111
            if d > SNAP_KM:
                continue
            # flow match, penalised by distance (a factor-e flow mismatch = 6 km), so nearby channels win
            score = abs(np.log(max(row["DIS_AV_CMS"], 0.1) / max(qm, 0.1))) + d / 6
            if best is None or score < best[0]:
                best = (score, rid, d)
        gauges.append({"k": k, "reach": int(best[1]), "snap_km": round(best[2], 1), "glofas_mean": round(qm),
                       "hydro_mean": round(float(r.loc[best[1], "DIS_AV_CMS"]))})
        print(f"{s['id']:13} -> reach {best[1]} {best[2]:.1f} km | mean flow GloFAS {qm:.0f} vs HydroRIVERS {r.loc[best[1], 'DIS_AV_CMS']:.0f} m3/s")

    # downstream path of each gauge (reach ids in order), and distance along it
    paths = {}
    for g in gauges:
        p, cur = [], g["reach"]
        while cur in down and cur not in p:
            p.append(cur)
            cur = down[cur]
        paths[g["k"]] = p
    role, sys_of, gauges_up, drains_to = {}, {}, defaultdict(set), defaultdict(set)
    for g in gauges:
        for rid in paths[g["k"]]:
            role[rid] = "main"
            gauges_up[rid].add(g["k"])
            sys_of.setdefault(rid, flood["stations"][g["k"]]["river"])
    # upstream network above MIN_UPLAND, tagged with the gauges it drains to
    for g in gauges:
        stack = [g["reach"]]
        seen = set()
        while stack:
            cur = stack.pop()
            for u in up.get(cur, []):
                if u in seen or r.loc[u, "UPLAND_SKM"] < MIN_UPLAND:
                    continue
                seen.add(u)
                drains_to[u].add(g["k"])
                role.setdefault(u, "up")
                sys_of.setdefault(u, flood["stations"][g["k"]]["river"])
                stack.append(u)
        g["up_reaches"] = len(seen)
        g["upland_km2"] = round(float(r.loc[g["reach"], "UPLAND_SKM"]))

    # gauge-to-gauge links along the channel: the first gauge met going downstream
    reach_gauges = defaultdict(list)
    for g in gauges:
        reach_gauges[g["reach"]].append(g["k"])
    links = []
    for g in gauges:
        dist = 0.0
        for j, rid in enumerate(paths[g["k"]]):
            if j:
                hits = [h for h in reach_gauges.get(rid, []) if h != g["k"]]
                if hits:
                    links.append({"from": g["k"], "to": hits[0], "km": round(dist)})
                    break
            dist += float(r.loc[rid, "LENGTH_KM"])
        g["path_km"] = round(sum(float(r.loc[x, "LENGTH_KM"]) for x in paths[g["k"]]))
        end = paths[g["k"]][-1]
        g["end"] = "inland lake / basin" if r.loc[end, "ENDORHEIC"] else ("leaves the map area" if down.get(end, 0) else "sea or lake")
    # confluences: where two gauges' downstream paths first meet, when neither is on the other's path
    on_path = {(l["from"], l["to"]) for l in links}
    cum = {g["k"]: np.cumsum([0.0] + [float(r.loc[x, "LENGTH_KM"]) for x in paths[g["k"]]]) for g in gauges}
    idx = {g["k"]: {rid: j for j, rid in enumerate(paths[g["k"]])} for g in gauges}
    confl = {}
    for a in gauges:
        for b in gauges:
            ka, kb = a["k"], b["k"]
            if kb <= ka or a["reach"] in idx[kb] or b["reach"] in idx[ka]:
                continue
            j = next((j for j, rid in enumerate(paths[ka]) if rid in idx[kb]), None)
            if j is None:
                continue
            rid = paths[ka][j]
            c = confl.setdefault(rid, {"reach": int(rid), "gauges": {}, "xy": [round(v, 4) for v in r.loc[rid].geometry.coords[0]]})
            c["gauges"][ka] = round(float(cum[ka][j]))
            c["gauges"][kb] = round(float(cum[kb][idx[kb][rid]]))
    # keep only the most upstream meeting of each pair of gauges
    seen_pairs, confluences = set(), []
    for c in sorted(confl.values(), key=lambda c: min(c["gauges"].values())):
        ks = sorted(c["gauges"])
        pairs = {(x, y) for x in ks for y in ks if x < y} - seen_pairs
        if not pairs:
            continue
        seen_pairs |= pairs
        confluences.append({"xy": c["xy"], "gauges": [{"k": k, "km": c["gauges"][k]} for k in ks]})
    # gauges on the same reach (several OCHA points share a grid cell) are linked at 0 km
    for rid, ks in reach_gauges.items():
        for a, b in zip(ks, ks[1:]):
            links.append({"from": a, "to": b, "km": 0})

    keep = r.loc[list(role)]
    geo = keep.geometry.simplify(0.004, preserve_topology=False)
    feats = []
    for rid, gm in geo.items():
        row = keep.loc[rid]
        coords = [[round(x, 4), round(y, 4)] for x, y in gm.coords]
        if len(coords) < 2:
            continue
        feats.append({"type": "Feature", "properties": {
            "id": int(rid), "role": role[rid], "river": sys_of[rid], "q": round(float(row["DIS_AV_CMS"]), 1),
            "up": int(row["UPLAND_SKM"]), "g": sorted(gauges_up.get(rid, [])), "d": sorted(drains_to.get(rid, [])),
        }, "geometry": {"type": "LineString", "coordinates": coords}})
    out = {"source": "HydroRIVERS v1.0 (HydroSHEDS, WWF / McGill), CC-BY 4.0", "min_upland": MIN_UPLAND,
           "gauges": gauges, "links": links, "confluences": confluences,
           "geojson": {"type": "FeatureCollection", "features": feats}}
    for g in out["gauges"]:
        g.pop("up_reaches", None)
    (APP / "data" / "rivers.js").write_text("window.RIVERS=" + json.dumps(out, separators=(",", ":")) + ";", encoding="utf-8")
    page = APP / "index.html"
    stamp = pd.Timestamp.now().strftime("%Y%m%d%H%M")
    page.write_text(re.sub(r"data/rivers\.js\?v=[0-9]+", f"data/rivers.js?v={stamp}", page.read_text(encoding="utf-8")), encoding="utf-8")
    print(len(feats), "reaches drawn |", len(links), "gauge links:")
    for l in links:
        print(f"  {flood['stations'][l['from']]['label']} -> {flood['stations'][l['to']]['label']}: {l['km']} km")
    for c in confluences:
        print("  confluence", c["xy"], ", ".join(f"{flood['stations'][x['k']]['label']} +{x['km']} km" for x in c["gauges"]))
    for g in gauges:
        print(f"  {flood['stations'][g['k']]['label']}: upstream {g['upland_km2']:,} km2, {g['path_km']} km to {g['end']}")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "build"
    if cmd == "download":
        cmd_download()
    else:
        cmd_build()
