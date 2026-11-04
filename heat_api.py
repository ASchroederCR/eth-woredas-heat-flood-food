"""Create, backfill and download the Ethiopia woreda HeatReady projects.

Usage:
    python heat_api.py create      # create every project in build/projects/manifest.json
    python heat_api.py backfill    # extend every project back to TARGET_START, 30 days per call
    python heat_api.py backfill 1,3  # only projects 1 and 3, in that order (one worker of several)
    python heat_api.py download    # page daily rows into build/raw/<project>/<month>.jsonl
    python heat_api.py download final  # same, re-pulling the two latest months
    python heat_api.py vuln        # pull vulnerability layers (age structure) per project
    python heat_api.py forecast    # pull the Open-Meteo forecast days into build/forecast/<project>.jsonl
    python heat_api.py status

Every step is resumable: re-running picks up from what is already on disk or on the server.
Credentials come from ../heat_api_key.txt ({"username": ..., "key": ...}).
"""
import datetime as dt
import json
import sys
import time
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent
BUILD = ROOT / "build"
PROJ = BUILD / "projects"
RAW = BUILD / "raw"
FCST = BUILD / "forecast"  # kept out of RAW: build_map_data reads every RAW/*/*.jsonl as history
BASE = "https://5trhrgas69.execute-api.us-east-1.amazonaws.com/v1/evaluate"
TARGET_START = dt.date(2023, 6, 1)
CREDS = json.loads((ROOT.parent / "heat_api_key.txt").read_text())

# Columns kept from each daily row; the rest (ref_* summaries, coverage blocks) is dropped.
KEEP = ["name", "date", "population", "data_source"] + [
    f"{p}_{v}_{s}" for p in ("day", "daytime", "nighttime")
    for v in ("t2m", "hi", "utci", "wbgt") for s in ("max", "min", "mean")
] + ["ref_day_t2m_p95", "ref_day_hi_p95", "ref_day_t2m_median"]


def log(*a):
    print(dt.datetime.now().strftime("%H:%M:%S"), *a, flush=True)


def call(action, payload=None, timeout=120):
    body = {"username": CREDS["username"], "key": CREDS["key"], "action": action, "payload": payload or {}}
    for attempt in range(8):
        try:
            r = requests.post(BASE, json=body, timeout=timeout)
        except requests.RequestException as e:
            log("network error", e)
            time.sleep(15 * (attempt + 1))
            continue
        try:
            data = r.json()
        except ValueError:
            data = {"error": r.text[:200]}
        if r.status_code == 429 and data.get("code") == "rate_limit_exceeded":
            now = dt.datetime.now(dt.timezone.utc)
            wait = 3600 - (now.minute * 60 + now.second) + 20
            log(f"rate limited, sleeping {wait}s until the next hour")
            time.sleep(wait)
            continue
        if r.status_code == 503:
            time.sleep(10 * (attempt + 1))
            continue
        data["_status"] = r.status_code
        return data
    raise RuntimeError(f"{action} kept failing")


def manifest():
    return json.loads((PROJ / "manifest.json").read_text())


def status(pid):
    return call("get-project-status", {"project_id": pid})


def cmd_create():
    for m in manifest():
        s = status(m["project_id"])
        if s["_status"] == 200:
            log(m["project_id"], "exists, start =", s.get("start"))
            continue
        geo = json.loads((PROJ / m["file"]).read_text())
        r = call("evaluate-heat-risk", {"project_id": m["project_id"], "json_obj": geo}, timeout=180)
        log(m["project_id"], r)
    for m in manifest():
        while not (s := status(m["project_id"])).get("start"):
            log(m["project_id"], "initializing...")
            time.sleep(60)
        log(m["project_id"], "ready, start =", s["start"], "polygons =", s.get("polygon_count"))


def start_date(pid):
    s = status(pid).get("start")
    return dt.date.fromisoformat(s[:10]) if s else None


def cmd_backfill(only=None):
    """One backfill at a time per worker, each up to 30 days.

    `only` is a list of 1-based project numbers, so several workers can split the projects.
    """
    todo = [m["project_id"] for k, m in enumerate(manifest(), 1) if not only or k in only]
    todo.sort(key=lambda pid: only.index(int(pid.split("-")[3])) if only else 0)
    while todo:
        for pid in list(todo):
            cur = start_date(pid)
            remaining = (cur - TARGET_START).days
            if remaining <= 0:
                log(pid, "reached", cur)
                todo.remove(pid)
                continue
            days = min(30, remaining)
            log(pid, f"start {cur}, backfilling {days} days ({remaining} to go)")
            r = call("backfill-project", {"project_id": pid, "days": days}, timeout=60)
            if r["_status"] not in (200, 504) and "timed out" not in str(r.get("message", "")):
                log(pid, "backfill response", r)
            # The call outlives the gateway; wait for start to move or the lambda budget to lapse.
            t0 = time.time()
            while time.time() - t0 < 900:
                time.sleep(30)
                new = start_date(pid)
                if new and new <= cur - dt.timedelta(days=days):
                    break
            log(pid, "start now", start_date(pid), f"after {int(time.time() - t0)}s")


def month_windows():
    m, today = TARGET_START, dt.date.today()
    while m <= today:
        nxt = (m.replace(day=28) + dt.timedelta(days=4)).replace(day=1)
        yield m, nxt - dt.timedelta(days=1)
        m = nxt


def pull_window(pid, d0, d1, page=1000, forecast=False):
    payload = {"project_id": pid, "limit": page, "offset": 0,
               "date_from": d0.isoformat(), "date_to": d1.isoformat()}
    keep = KEEP + ["forecast_issued_at"] if forecast else KEEP
    if forecast:
        payload["include_forecast"] = True
    rows = []
    while True:
        r = call("evaluate-heat-risk", payload, timeout=120)
        if "metrics" not in r:
            if r["_status"] in (502, 504) and payload["limit"] > 250:
                payload["limit"] //= 2
                log(pid, "shrinking page to", payload["limit"])
                continue
            raise RuntimeError(r)
        rows.extend({k: row.get(k) for k in keep} for row in r["metrics"])
        payload["offset"] += len(r["metrics"])
        if len(r["metrics"]) < payload["limit"] or payload["offset"] >= r["total_rows"]:
            return rows


def cmd_download(final=False):
    """Download month by month, as soon as backfill has covered each month.

    Runs alongside `backfill`. Months already on disk are skipped, except that `download final`
    re-pulls the latest two months, whose Open-Meteo days are replaced by ERA5 as it catches up.
    """
    windows = list(month_windows())
    recent = {w[0] for w in windows[-2:]}
    refreshed = set()
    while True:
        waiting = 0
        for m in manifest():
            pid = m["project_id"]
            st = start_date(pid)
            (RAW / pid).mkdir(parents=True, exist_ok=True)
            for d0, d1 in windows:
                out = RAW / pid / f"{d0:%Y-%m}.jsonl"
                stale = final and d0 in recent and (pid, d0) not in refreshed
                if out.exists() and not stale:
                    continue
                if d0 < st:
                    waiting += 1
                    continue
                rows = pull_window(pid, d0, d1)
                tmp = out.with_suffix(".tmp")
                tmp.write_text("".join(json.dumps(r) + "\n" for r in rows))
                tmp.replace(out)
                refreshed.add((pid, d0))
                log(pid, f"{d0:%Y-%m}", len(rows), "rows")
        if not waiting:
            log("download complete")
            return
        log(waiting, "project-months still waiting on backfill; checking again in 10 min")
        time.sleep(600)


def cmd_vuln():
    RAW.mkdir(parents=True, exist_ok=True)
    for m in manifest():
        rows, offset = [], 0
        while True:
            r = call("get-vulnerability-data", {"project_id": m["project_id"], "limit": 500, "offset": offset})
            rows.extend(r["vulnerability"])
            if len(r["vulnerability"]) < 500:
                break
            offset += 500
        (RAW / f"{m['project_id']}.vuln.json").write_text(json.dumps(rows))
        log(m["project_id"], len(rows), "vulnerability rows of", m["n"])


def cmd_forecast():
    """Replace build/forecast/ with the forecast days (data_source='forecast') now on the server.

    The API refreshes them once a day (about 06:00 UTC) and drops each day once real data arrives.
    """
    FCST.mkdir(parents=True, exist_ok=True)
    today = dt.date.today()
    for m in manifest():
        pid = m["project_id"]
        rows = [r for r in pull_window(pid, today - dt.timedelta(days=1), today + dt.timedelta(days=16), forecast=True)
                if r["data_source"] == "forecast"]
        out = FCST / f"{pid}.jsonl"
        tmp = out.with_suffix(".tmp")
        tmp.write_text("".join(json.dumps(r) + "\n" for r in rows))
        tmp.replace(out)
        days = sorted({r["date"][:10] for r in rows})
        log(pid, len(rows), "forecast rows", f"{days[0]}..{days[-1]}" if days else "",
            "issued", max((r["forecast_issued_at"] or "" for r in rows), default=None))


def cmd_status():
    for m in manifest():
        s = status(m["project_id"])
        log(m["project_id"], {k: s.get(k) for k in ("start", "last_updated", "polygon_count", "error")})


if __name__ == "__main__":
    if sys.argv[1:] == ["download", "final"]:
        cmd_download(final=True)
    elif sys.argv[1] == "backfill" and len(sys.argv) > 2:
        cmd_backfill([int(k) for k in sys.argv[2].split(",")])
    else:
        {"create": cmd_create, "backfill": cmd_backfill, "download": cmd_download,
         "vuln": cmd_vuln, "forecast": cmd_forecast, "status": cmd_status}[sys.argv[1]]()
