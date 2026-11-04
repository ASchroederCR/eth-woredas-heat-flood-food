"""Once a project's 2016-2025 reference is ready, drop downloaded months that lack ref_* values.

The downloader (heat_api.py download) re-pulls any month whose file is missing, so deleting a
stale file is enough. Loops every 10 minutes until every project's reference is done.
"""
import json
import time

import heat_api as h


def stale(path):
    with path.open() as f:
        first = f.readline()
    return bool(first) and json.loads(first).get("ref_day_t2m_p95") is None


pending = {m["project_id"] for m in h.manifest()}
while pending:
    for pid in sorted(pending):
        if not h.status(pid).get("wmo_ref"):
            continue
        for p in sorted((h.RAW / pid).glob("*.jsonl")):
            if stale(p):
                p.unlink()
                h.log(pid, "reference ready, re-pulling", p.stem)
        pending.discard(pid)
        h.log(pid, "reference done")
    if pending:
        time.sleep(600)
h.log("all references done")
