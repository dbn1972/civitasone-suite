#!/usr/bin/env python3
"""Idempotent REST-only pilot seed for the legal module (hearings) - UAT L1 GREEN.

Creates three realistic municipal court cases and four upcoming hearings for the pilot tenant via the
gateway (POST /api/v1/legal/cases, POST /api/v1/legal/cases/:id/hearings). No direct DB writes.
Hearings are dated after the UI default "Upcoming" filter window so /legal/hearings is not empty.
Re-runs skip cases (by caseNo) and hearings (by caseNo+date) that already exist.

Env: KC_URL (default http://localhost:8180), GW_URL (default http://localhost:8080), UAT_USER (default uxtester),
     UAT_PASSWORD (required). Token tid must be the pilot tenant 11111111-0000-0000-0000-000000000001.

Grants side (no seed needed): /grants/[id] was pinned to a withdrawn grant with no installments/UCs; re-pinned in
~/orch/uat-l1-pin-overrides.json to e969a11c-1664-4408-9597-a9a47c0f3a8c (active, 2 installments).
"""
import json, os, sys, time, uuid, urllib.request, urllib.parse, urllib.error

KC = os.environ.get("KC_URL", "http://localhost:8180") + "/auth/realms/civitasone/protocol/openid-connect/token"
GW = os.environ.get("GW_URL", "http://localhost:8080") + "/api/v1"
USER = os.environ.get("UAT_USER", "uxtester")
PW = os.environ.get("UAT_PASSWORD") or sys.exit("UAT_PASSWORD required")
d = urllib.parse.urlencode({"client_id": "civitasone-web", "username": USER, "password": PW, "grant_type": "password"}).encode()
TOK = json.load(urllib.request.urlopen(KC, d, timeout=20))["access_token"]

def call(method, path, body=None):
    for attempt in range(5):
        time.sleep(0.35)
        h = {"authorization": "Bearer " + TOK, "accept": "application/json"}
        data = None
        if body is not None:
            data = json.dumps(body).encode(); h["content-type"] = "application/json"; h["idempotency-key"] = str(uuid.uuid4())
        try:
            r = urllib.request.urlopen(urllib.request.Request(GW + path, method=method, headers=h, data=data), timeout=30)
            b = r.read(); return r.status, (json.loads(b) if b else None)
        except urllib.error.HTTPError as e:
            if e.code == 429: time.sleep(3 + attempt * 4); continue
            return e.code, e.read().decode()[:400]
    return 429, None

DEPT = os.environ.get("LEGAL_DEPT_ID", "fdeb9984-e3bb-4a62-8866-5a9ae8e87da0")
CT = {"writ": "e384a5f1-f003-4f9a-aa54-c2415f217f42", "civil": "089c09e6-b976-4692-b938-18507f4f23c0", "service": "4436143a-10db-4586-9669-86fe8f1a8eaf"}
CASES = [
 ("WP(C) 4821/2026", "Municipal Corporation v. Shree Ganesh Builders - unauthorised construction demolition order", "hc_allahabad", "writ", "2026-07-14", "Writ against demolition notice under UP Urban Planning Act", "Shree Ganesh Builders Pvt Ltd",
  [("2026-12-04", "Final hearing on demolition order", "2027-01-20"), ("2027-01-20", "Arguments on interim stay", None)]),
 ("CS 612/2026", "Ramesh Chandra Verma v. Municipal Corporation - property tax assessment dispute", "hc_delhi", "civil", "2026-06-02", "Challenge to revised property tax assessment for ward 14", "Ramesh Chandra Verma",
  [("2026-12-17", "Framing of issues", "2027-02-10")]),
 ("WP 9034/2026", "Suresh Patil & Ors. v. Municipal Corporation - seniority and promotion of sanitary inspectors", "hc_bombay", "service", "2026-08-21", "Service matter on seniority list of sanitary inspectors", "Suresh Patil",
  [("2027-01-12", "Hearing on counter affidavit", "2027-03-03")]),
]

def cases(): return {x["caseNo"]: x for x in call("GET", "/legal/cases?limit=100")[1]["items"]}
have = cases()
for no, title, court, ty, fd, subj, pet, _ in CASES:
    if no not in have:
        print("create case", no, call("POST", "/legal/cases", {"caseNo": no, "title": title, "courtCode": court, "filingDate": fd, "departmentId": DEPT, "subject": subj, "caseTypeId": CT[ty], "petitioner": pet}))
for _ in range(10):  # create is async (202): wait for the cases to land
    have = cases()
    if all(c[0] in have for c in CASES): break
    time.sleep(3)
existing = {(h["caseNo"], h["date"]) for h in call("GET", "/legal/hearings?limit=500")[1]}
for no, *_, hs in CASES:
    for dt, purpose, nxt in hs:
        if no not in have or (no, dt) in existing: continue
        b = {"hearingDate": dt, "court": have[no]["court"], "purpose": purpose}
        if nxt: b["nextDate"] = nxt
        print("create hearing", no, dt, call("POST", "/legal/cases/%s/hearings" % have[no]["id"], b))
