"""CHIRPS v3.0 rainfall per dekad (10-day period) for every woreda and every flood gauge's catchment.

CHIRPS v3 (Climate Hazards Center, UC Santa Barbara) blends satellite infrared with station data at
0.05° (~5.5 km). Dekads are days 1-10, 11-20 and 21-end of each month. We use the final product from
June 2023 and the preliminary product for the latest dekads not yet final, plus 1991-2020 for the
normal (median and mean per dekad of the year) so each dekad can be shown as % of normal.

Each Africa GeoTIFF (~5 MB) is clipped to the study box and kept as int16 tenths of mm in
build/chirps/clip/, then deleted, so re-runs only fetch what is new.

    python chirps.py download   # fetch missing dekads (baseline 1991-2020 + June 2023 onward)
    python chirps.py build      # woreda + catchment zonal means -> app/data/rain.js
    python chirps.py all        # both (used by the daily refresh)
"""
import json
import re
import sys
import time
import urllib.request
import zipfile
from datetime import date
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "build" / "chirps"
CLIP = OUT / "clip"
APP = ROOT / "app"
BASE = "https://data.chc.ucsb.edu/products/CHIRPS/v3.0/"
FINAL = BASE + "dekads/africa/tifs/"
PRELIM = BASE + "prelim/dekads/global/tifs/"   # ~20 MB each; the Africa prelim dekads stopped in 2025
UA = {"User-Agent": "eth-woreda-heat-map/1.0"}
# study box (same as rivers.py): Ethiopia plus downstream reaches; whole pixels of the 0.05° grid
BOX = (31.0, -1.5, 48.5, 15.5)
RES = 0.05
CLIM = (1991, 2020)
START = (2023, 6)
PACE = 4          # seconds between downloads (bursts get HTTP 429)
MIN_YEARS = 25    # baseline years needed per dekad for % of normal
HYBAS_URL = "https://data.hydrosheds.org/file/HydroBASINS/standard/hybas_af_lev12_v1c.zip"
HYBAS_DIR = ROOT / "build" / "rivers" / "src" / "hybas12"


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


def get(url, tries=12):
    for k in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code == 404:
                raise
            wait = 60 * (k + 1) if e.code == 429 else 5 * (k + 1)   # the CHC server rate-limits bursts
            log(f"  HTTP {e.code}, retry in {wait}s")
            time.sleep(wait)
        except Exception as e:  # network hiccup
            log(f"  {e}, retry")
            time.sleep(5 * (k + 1))
    raise RuntimeError("giving up on " + url)


def listing(url):
    html = get(url).decode("utf-8", "replace")
    return sorted(set(re.findall(r'chirps-v3\.0\.(\d{4}\.\d{2}\.\d)\.tif"', html)))


def dekads(y0, m0, y1, m1):
    y, m = y0, m0
    while (y, m) <= (y1, m1):
        for d in (1, 2, 3):
            yield f"{y}.{m:02d}.{d}"
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)


REF_SHAPE = (340, 350)   # rows, cols of the study box on the 0.05 degree grid


def clip_tif(data):
    import rasterio
    from rasterio.io import MemoryFile
    from rasterio.windows import from_bounds
    with MemoryFile(data) as mf, mf.open() as s:
        w = from_bounds(*BOX, transform=s.transform).round_offsets().round_lengths()
        a = s.read(1, window=w).astype(np.float32)
    a[(a < 0) | ~np.isfinite(a)] = np.nan
    assert a.shape == REF_SHAPE, f"clip shape {a.shape}"
    return np.where(np.isnan(a), -1, np.round(a * 10)).astype(np.int16)


def cmd_download():
    CLIP.mkdir(parents=True, exist_ok=True)
    final = listing(FINAL)
    prelim = [k for k in listing(PRELIM) if k > final[-1]]
    today = date.today()
    # recent dekads one GeoTIFF each; the 1991-2020 baseline comes from yearly NetCDFs (cmd_baseline)
    want = list(dekads(*START, today.year, today.month))
    have = {p.stem for p in CLIP.glob("*.npy")}
    # a prelim dekad is replaced once its final version appears
    pre_have = {p.stem for p in CLIP.glob("*.prelim")}
    todo = []
    for k in want:
        if k in final and (k not in have or k in pre_have):
            todo.append((k, FINAL, False))
        elif k in prelim and k not in have:
            todo.append((k, PRELIM, True))
    log(f"final to {final[-1]}, prelim to {prelim[-1] if prelim else '-'}; {len(todo)} dekads to fetch")
    for j, (k, url, pre) in enumerate(todo):
        a = clip_tif(get(f"{url}chirps-v3.0.{k}.tif"))
        np.save(CLIP / f"{k}.npy", a)
        flag = CLIP / f"{k}.prelim"
        if pre:
            flag.touch()
        elif flag.exists():
            flag.unlink()
        if j % 10 == 0 or j == len(todo) - 1:
            log(f"  {j + 1}/{len(todo)} {k}{' (prelim)' if pre else ''}")
        time.sleep(PACE)


def cmd_baseline():
    """1991-2020 from the global yearly dekad NetCDFs (~500 MB each, one request per year: the server
    allows only a few requests a minute, so 1,080 single GeoTIFFs would take hours). Each file is
    streamed to the system temp folder, clipped to the box, and deleted."""
    import os
    import tempfile
    import rasterio
    from rasterio.windows import from_bounds
    CLIP.mkdir(parents=True, exist_ok=True)
    tmp = Path(tempfile.gettempdir()) / "chirps_nc"
    tmp.mkdir(exist_ok=True)
    ref = np.load(CLIP / "2023.08.3.npy").shape if (CLIP / "2023.08.3.npy").exists() else None
    for y in range(CLIM[0], CLIM[1] + 1):
        ks = [f"{y}.{m:02d}.{d}" for m in range(1, 13) for d in (1, 2, 3)]
        if all((CLIP / f"{k}.npy").exists() for k in ks):
            continue
        nc = tmp / f"chirps-v3.0.{y}.dekads.nc"
        url = f"{BASE}dekads/global/netcdf/chirps-v3.0.{y}.dekads.nc"
        for k in range(8):
            try:
                req = urllib.request.Request(url, headers=UA)
                with urllib.request.urlopen(req, timeout=300) as r, open(nc, "wb") as f:
                    while chunk := r.read(1 << 22):
                        f.write(chunk)
                break
            except urllib.error.HTTPError as e:
                wait = 60 * (k + 1) if e.code == 429 else 10 * (k + 1)
                log(f"  {y}: HTTP {e.code}, retry in {wait}s"); time.sleep(wait)
            except Exception as e:
                log(f"  {y}: {e}, retry"); time.sleep(10 * (k + 1))
        else:
            sys.exit(f"giving up on {url}")
        with rasterio.open(f'NETCDF:"{nc}":precip') as s:
            w = from_bounds(*BOX, transform=s.transform).round_offsets().round_lengths()
            if s.count != 36:
                sys.exit(f"{y}: expected 36 dekads, got {s.count}")
            for b, k in enumerate(ks, start=1):
                a = s.read(b, window=w).astype(np.float32)
                if s.transform.e > 0:   # bottom-up file
                    a = a[::-1]
                a[(a < 0) | ~np.isfinite(a)] = np.nan
                a = np.where(np.isnan(a), -1, np.round(a * 10)).astype(np.int16)
                if ref and a.shape != ref:
                    sys.exit(f"{y}: clip shape {a.shape} differs from the GeoTIFF clips {ref}")
                np.save(CLIP / f"{k}.npy", a)
        os.remove(nc)
        log(f"  baseline {y} done")
        time.sleep(PACE)


# ---------------------------------------------------------------- zonal statistics
def grid_shape():
    a = np.load(next(CLIP.glob("*.npy")))
    return a.shape


def transform():
    from rasterio.transform import from_origin
    return from_origin(BOX[0], BOX[3], RES, RES)


def zone_weights(geoms, shape):
    """For each geometry, the flat pixel indices it covers and their area weights (cos lat).
    Rasterised at 5x the CHIRPS resolution so small woredas get fractional coverage."""
    from rasterio.features import rasterize
    from rasterio.transform import from_origin
    f = 5
    hi_t = from_origin(BOX[0], BOX[3], RES / f, RES / f)
    H, W = shape
    lat = BOX[3] - (np.arange(H) + 0.5) * RES
    coslat = np.cos(np.radians(lat))[:, None] * np.ones((1, W))
    out = []
    for g in geoms:
        if g is None or g.is_empty:
            out.append((np.array([], int), np.array([])))
            continue
        minx, miny, maxx, maxy = g.bounds
        c0 = max(0, int((minx - BOX[0]) / RES) - 1); c1 = min(W, int((maxx - BOX[0]) / RES) + 2)
        r0 = max(0, int((BOX[3] - maxy) / RES) - 1); r1 = min(H, int((BOX[3] - miny) / RES) + 2)
        if c1 <= c0 or r1 <= r0:
            out.append((np.array([], int), np.array([])))
            continue
        sub_t = from_origin(BOX[0] + c0 * RES, BOX[3] - r0 * RES, RES / f, RES / f)
        m = rasterize([(g, 1)], out_shape=((r1 - r0) * f, (c1 - c0) * f), transform=sub_t,
                      all_touched=False, dtype="uint8")
        frac = m.reshape(r1 - r0, f, c1 - c0, f).mean(axis=(1, 3))
        if frac.sum() == 0:  # sliver smaller than a sub-pixel: use the pixel holding its centroid
            p = g.representative_point()
            rr = min(H - 1, int((BOX[3] - p.y) / RES)); cc = min(W - 1, int((p.x - BOX[0]) / RES))
            out.append((np.array([rr * W + cc]), np.array([1.0])))
            continue
        rr, cc = np.nonzero(frac)
        w = frac[rr, cc] * coslat[rr + r0, cc + c0]
        out.append((((rr + r0) * W + (cc + c0)).astype(int), w))
    return out


def catchments():
    """Upstream catchment of each gauge: HydroBASINS level-12 units draining to the gauge's
    HydroRIVERS reach (the reach snapped in rivers.py), dissolved."""
    import geopandas as gpd
    from shapely.ops import unary_union
    rv = json.loads((APP / "data" / "rivers.js").read_text(encoding="utf-8")[len("window.RIVERS="):-1])
    shp = next(HYBAS_DIR.glob("*.shp"), None)
    if shp is None:
        HYBAS_DIR.mkdir(parents=True, exist_ok=True)
        z = HYBAS_DIR / "hybas12.zip"
        log("downloading HydroBASINS level 12 (Africa)")
        z.write_bytes(get(HYBAS_URL))
        zipfile.ZipFile(z).extractall(HYBAS_DIR)
        z.unlink()
        shp = next(HYBAS_DIR.glob("*.shp"))
    b = gpd.read_file(shp, bbox=BOX, columns=["HYBAS_ID", "NEXT_DOWN"])
    up = {}
    for h, nd in zip(b["HYBAS_ID"], b["NEXT_DOWN"]):
        up.setdefault(int(nd), []).append(int(h))
    geom = dict(zip(b["HYBAS_ID"].astype(int), b.geometry))
    # the level-12 basin of each gauge's snapped HydroRIVERS reach
    rsh = ROOT / "build" / "rivers" / "src" / "HydroRIVERS_v10_af_shp" / "HydroRIVERS_v10_af.shp"
    reaches = {g["reach"] for g in rv["gauges"]}
    r = gpd.read_file(rsh, bbox=BOX, columns=["HYRIV_ID", "HYBAS_L12"], ignore_geometry=True)
    basin_of = {int(a): int(h) for a, h in zip(r["HYRIV_ID"], r["HYBAS_L12"]) if int(a) in reaches}
    out = {}
    for g in rv["gauges"]:
        start = basin_of.get(g["reach"])
        if start is None:
            continue
        stack, seen = [start], set()
        while stack:
            h = stack.pop()
            if h in seen:
                continue
            seen.add(h)
            stack.extend(up.get(h, []))
        out[g["k"]] = unary_union([geom[h] for h in seen if h in geom])
    return out


def cmd_build():
    import geopandas as gpd
    from scipy import sparse
    files = sorted(CLIP.glob("*.npy"))
    keys = [p.stem for p in files]
    shape_ = grid_shape()
    H, W = shape_

    # zones: woredas (same order as data.js) and gauge catchments
    data = json.loads((APP / "data" / "data.js").read_text(encoding="utf-8")[len("window.DATA="):-1])
    pcodes = [w["pcode"] for w in data["woredas"]]
    nW = len(pcodes)
    geo = json.loads((APP / "data" / "geo.js").read_text(encoding="utf-8")[len("window.GEO="):-1])
    gdf = gpd.GeoDataFrame.from_features(geo["features"])  # property i = index into data.js woredas
    gdf = gdf.set_index("i").reindex(range(nW))
    log("woreda weights")
    wz = zone_weights(list(gdf.geometry), shape_)
    log("catchments")
    cat = catchments()
    cz = zone_weights(list(cat.values()), shape_)
    zones = wz + cz
    # zones x pixels weight matrix: a zone's mean is (weights . values) / (weights . has-data)
    rows = np.concatenate([np.full(len(i), r) for r, (i, _) in enumerate(zones)])
    Wm = sparse.csr_matrix((np.concatenate([w for _, w in zones]), (rows, np.concatenate([i for i, _ in zones]))),
                           shape=(len(zones), H * W))

    def zonal(A):
        """A: (t, pixels) with NaN for no data -> (t, zones)."""
        ok = np.isfinite(A)
        num = Wm @ np.where(ok, A, 0).T
        den = Wm @ ok.T.astype(np.float32)
        with np.errstate(invalid="ignore", divide="ignore"):
            return np.where(den > 0, num / den, np.nan).T

    def load(k):
        a = np.load(CLIP / f"{k}.npy").astype(np.float32).ravel()
        a[a < 0] = np.nan
        return a / 10

    # each zone's own 1991-2020 series per dekad of the year: base[j] is (years, zones)
    log("baseline")
    base = []
    for j in range(36):
        m, d = j // 3 + 1, j % 3 + 1
        ks = [f"{y}.{m:02d}.{d}" for y in range(CLIM[0], CLIM[1] + 1) if (CLIP / f"{y}.{m:02d}.{d}.npy").exists()]
        if len(ks) < MIN_YEARS:
            sys.exit(f"baseline incomplete for {m:02d}.{d}: {len(ks)} years; run baseline")
        base.append(zonal(np.stack([load(k) for k in ks])))
    nyears = min(b.shape[0] for b in base)
    normal = np.stack([np.nanmean(b, 0) for b in base])   # (36, zones)

    recent = [k for k in keys if (int(k[:4]), int(k[5:7])) >= START]
    prelim = {p.stem for p in CLIP.glob("*.prelim")}
    log(f"{len(recent)} recent dekads")
    Z = zonal(np.stack([load(k) for k in recent]))          # (dekads, zones)
    doy = np.array([(int(k[5:7]) - 1) * 3 + int(k[8]) - 1 for k in recent])

    def r1(v):
        return None if not np.isfinite(v) else round(float(v), 1)

    def pct(v, n, floor):
        # % of the 1991-2020 average; blank where the period is normally (almost) dry
        return None if not (np.isfinite(v) and np.isfinite(n)) or n < floor else round(float(v / n * 100))

    def rank(v, b, n, floor):
        # percentile of this value among the same period's 1991-2020 values (ties count half)
        b = b[np.isfinite(b)]
        if not np.isfinite(v) or not len(b) or not np.isfinite(n) or n < floor:
            return None
        return round(float(100 * ((b < v).sum() + 0.5 * (b == v).sum()) / len(b)))

    woreda = {"mm": [], "pct": [], "rank": []}
    for t, j in enumerate(doy):
        woreda["mm"].append([r1(v) for v in Z[t, :nW]])
        woreda["pct"].append([pct(Z[t, z], normal[j, z], 2) for z in range(nW)])
        woreda["rank"].append([rank(Z[t, z], base[j][:, z], normal[j, z], 2) for z in range(nW)])

    gauges = {}
    for c, (gk, poly) in enumerate(cat.items()):
        z = nW + c
        area = gpd.GeoSeries([poly], crs=4326).to_crs("ESRI:102022").area.iloc[0] / 1e6
        gauges[gk] = {"mm": [r1(Z[t, z]) for t in range(len(recent))],
                      "normal": [r1(normal[j, z]) for j in doy],
                      "pct": [pct(Z[t, z], normal[j, z], 2) for t, j in enumerate(doy)],
                      "rank": [rank(Z[t, z], base[j][:, z], normal[j, z], 2) for t, j in enumerate(doy)],
                      "area_km2": round(area)}
        log(f"  {gk}: catchment {area:,.0f} km2")

    # monthly totals (months with all three dekads); the baseline month is the sum of its dekads each year
    months = data["months"]
    mon = {"mm": [], "pct": [], "rank": []}
    for m in months:
        ix = [t for t, k in enumerate(recent) if k[:7] == m.replace("-", ".")]
        if len(ix) < 3:
            for k in mon:
                mon[k].append([None] * nW)
            continue
        js = [doy[t] for t in ix]
        tot = Z[ix, :nW].sum(0)
        bm = sum(base[j][:nyears, :nW] for j in js)
        nm = normal[js, :nW].sum(0)
        mon["mm"].append([r1(v) for v in tot])
        mon["pct"].append([pct(tot[z], nm[z], 5) for z in range(nW)])
        mon["rank"].append([rank(tot[z], bm[:, z], nm[z], 5) for z in range(nW)])

    out = {
        "dekads": recent,
        "prelim": [k in prelim for k in recent],
        "woreda": woreda,
        "monthly": mon,
        "gauges": gauges,
        "catchments": {gk: json.loads(gpd.GeoSeries([p.simplify(0.01)], crs=4326).to_json())["features"][0]["geometry"]
                       for gk, p in cat.items()},
        "clim": f"{CLIM[0]}-{CLIM[1]}", "clim_years": nyears,
        "built": time.strftime("%Y-%m-%d %H:%M"),
    }
    js = "window.RAIN=" + json.dumps(out, separators=(",", ":"), allow_nan=False) + ";"
    (APP / "data" / "rain.js").write_text(js, encoding="utf-8")
    # new cache-busting stamp so a plain reload picks up the new data
    page = APP / "index.html"
    stamp = time.strftime("%Y%m%d%H%M")
    page.write_text(re.sub(r"data/rain\.js\?v=[0-9]+", f"data/rain.js?v={stamp}", page.read_text(encoding="utf-8")),
                    encoding="utf-8")
    log(f"rain.js: {len(recent)} dekads ({recent[0]} to {recent[-1]}, {sum(out['prelim'])} prelim), "
        f"{len(pcodes)} woredas, {len(gauges)} catchments, {len(js) / 1e6:.1f} MB")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "all"
    if "--min-years" in sys.argv:   # testing with a partial baseline
        MIN_YEARS = int(sys.argv[sys.argv.index("--min-years") + 1])
    if cmd in ("download", "all"):
        cmd_download()
    if cmd in ("baseline", "all"):
        cmd_baseline()
    if cmd in ("build", "all"):
        cmd_build()
