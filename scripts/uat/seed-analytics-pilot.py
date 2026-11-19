#!/usr/bin/env python3
"""Idempotent REST-only seed: analytics dashboard widgets for the UAT pilot tenant.

Adds real, query-spec-valid widgets (metrics from /v1/analytics/catalog) to any
ACTIVE dashboard of the pilot tenant that has none. Existing widgets are never
duplicated (matched by title). Does NOT touch ai-insights / ml-insights: those are
pipeline-generated (see PR description) and are intentionally not fabricated.
Env: KC_URL, GW_URL, UAT_USER, UAT_PASS (defaults = local UAT stack).
"""
import json, os, time, urllib.request, urllib.parse, urllib.error
KC = os.environ.get("KC_URL", "http://localhost:8180/auth/realms/civitasone/protocol/openid-connect/token")
GW = os.environ.get("GW_URL", "http://localhost:8080/api/v1")
USER = os.environ.get("UAT_USER", "uxtester"); PW = os.environ["UAT_PASS"]
TENANT = "11111111-0000-0000-0000-000000000001"
WIDGETS = [
    ("Events by source", "bar", {"metric": "event_count", "dimensions": ["source"], "filters": [], "limit": 20}, 0),
    ("Total transaction value by category (paise)", "table", {"metric": "amount_sum", "dimensions": ["category"], "filters": [], "limit": 20}, 1),
    ("Events by status", "bar", {"metric": "event_count", "dimensions": ["status"], "filters": [], "limit": 10}, 2),
    ("Total events", "stat", {"metric": "event_count", "dimensions": [], "filters": [], "limit": 1}, 3),
]
tok = json.load(urllib.request.urlopen(KC, urllib.parse.urlencode({"client_id": "civitasone-web", "username": USER, "password": PW, "grant_type": "password"}).encode()))["access_token"]
def call(m, p, b=None):
    for a in range(4):
        time.sleep(0.35)
        r = urllib.request.Request(GW + p, method=m, data=None if b is None else json.dumps(b).encode(),
                                   headers={"authorization": "Bearer " + tok, "content-type": "application/json"})
        try:
            x = urllib.request.urlopen(r, timeout=30); return x.status, json.loads(x.read() or b"{}")
        except urllib.error.HTTPError as e:
            if e.code == 429: time.sleep(3 + 4 * a); continue
            return e.code, e.read().decode()[:300]
st, lst = call("GET", "/analytics/dashboards"); assert st == 200, lst
for d in lst["data"]:
    if d["tenantId"] != TENANT or d["status"] != "active": continue
    st, det = call("GET", "/analytics/dashboards/" + d["id"]); assert st == 200, det
    have = {w["title"] for w in det.get("widgets", [])}
    if det.get("widgets"): print("skip (has widgets):", d["name"]); continue
    for t, v, s, pos in WIDGETS:
        if t in have: continue
        st, r = call("POST", "/analytics/dashboards/%s/widgets" % d["id"], {"title": t, "vizType": v, "spec": s, "position": pos})
        print(d["name"], "|", t, "->", st)
