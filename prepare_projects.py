"""Split Ethiopia woredas (OCHA admin3) into HeatReady projects that fit the API limits.

Each project may hold at most 1,500 polygons and a bounding box of at most 50 square degrees,
measured around the full extent of every polygon. Ethiopia's box is ~170 square degrees, so the
woredas are split by recursive bisection on centroids until every group's box fits.
"""
import json
from pathlib import Path

import geopandas as gpd

ROOT = Path(__file__).resolve().parent
SRC = ROOT.parent / "Boundaries" / "OCHA_COD_AB" / "eth_admin3.shp"
OUT = ROOT / "build" / "projects"
MAX_BBOX_SQDEG = 45  # headroom under the API's 50
SIMPLIFY_DEG = 0.004  # ~400 m, keeps each upload well under 5 MB


def bbox_area(gdf):
    x0, y0, x1, y1 = gdf.total_bounds
    return (x1 - x0) * (y1 - y0)


def split(gdf):
    if bbox_area(gdf) <= MAX_BBOX_SQDEG and len(gdf) <= 1500:
        return [gdf]
    x0, y0, x1, y1 = gdf.total_bounds
    c = gdf.geometry.representative_point()
    axis = c.x if (x1 - x0) >= (y1 - y0) else c.y
    cut = axis.median()
    return split(gdf[axis <= cut]) + split(gdf[axis > cut])


def main():
    g = gpd.read_file(SRC)[["adm3_pcode", "adm3_name", "adm2_name", "adm1_name", "geometry"]]
    g["geometry"] = g.geometry.simplify(SIMPLIFY_DEG, preserve_topology=True).make_valid()
    groups = split(g)
    OUT.mkdir(parents=True, exist_ok=True)
    manifest = []
    for i, grp in enumerate(groups, 1):
        pid = f"eth-woreda-heat-{i}-as2026"
        fc = grp.rename(columns={"adm3_pcode": "name"})[["name", "geometry"]]
        path = OUT / f"{pid}.geojson"
        path.write_text(fc.to_json(drop_id=True))
        manifest.append({"project_id": pid, "file": path.name, "n": len(grp),
                         "bbox_sqdeg": round(bbox_area(grp), 1),
                         "mb": round(path.stat().st_size / 1e6, 2)})
        print(manifest[-1])
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2))
    g.drop(columns="geometry").to_csv(ROOT / "build" / "woreda_names.csv", index=False)


if __name__ == "__main__":
    main()
