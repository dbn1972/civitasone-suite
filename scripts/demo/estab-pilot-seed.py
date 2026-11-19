#!/usr/bin/env python3
"""Seed Establishment pilot data via REST only (no DB writes).

Tenant 11111111-0000-0000-0000-000000000001, persona uxtester. Idempotent: reads before each write.
Seeds: file operators (which also yield the divisions list for /estab/files/new) and
minutes for the pinned estab meeting (clears the minutes-404 console error on /estab/meetings/[id]),
and a small library catalogue + one live loan.

NOT seedable via REST: guesthouse rooms (estab_rooms has no create route) -- see PR description.

Usage: SEED_PASSWORD=... python3 -I estab-pilot-seed.py [--dry]
"""
import json, os, sys, time, urllib.error, urllib.parse, urllib.request

KC = os.environ.get("KC_TOKEN_URL", "http://localhost:8180/auth/realms/civitasone/protocol/openid-connect/token")
GW = os.environ.get("GW_URL", "http://localhost:8080/api/v1")
USER = os.environ.get("SEED_USER", "uxtester")
PW = os.environ["SEED_PASSWORD"]  # required; never commit credentials
DRY = "--dry" in sys.argv


def token():
    d = urllib.parse.urlencode({"client_id": "civitasone-web", "username": USER, "password": PW,
                                "grant_type": "password"}).encode()
    return json.load(urllib.request.urlopen(KC, d, timeout=20))["access_token"]


T = token()


def call(method, path, body=None):
    time.sleep(0.35)  # pace
    for attempt in range(4):
        req = urllib.request.Request(
            f"{GW}/{path}", method=method, data=None if body is None else json.dumps(body).encode(),
            headers={"authorization": "Bearer " + T, "accept": "application/json", "content-type": "application/json"})
        try:
            r = urllib.request.urlopen(req, timeout=30)
            b = r.read()
            return r.status, (json.loads(b) if b else None)
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < 3:
                time.sleep(4 + attempt * 5)
                continue
            b = e.read()
            try:
                return e.code, json.loads(b)
            except Exception:
                return e.code, b.decode(errors="replace")
    return 429, None


def rows(x):
    return x["data"] if isinstance(x, dict) and "data" in x else (x or [])


# (employee name, division, section, deskRole, canInitiate, clearanceLevel)
PLAN = [
    ("Abdul Rahman Chauhan", "Revenue", "Property Tax", "section_officer", True, 2),
    ("Amit Pillai", "Revenue", "Mutation", "dealing_hand", True, 1),
    ("Anjali Saxena", "Public Works", "Roads & Bridges", "deputy_secretary", True, 3),
    ("Arun Qureshi", "Public Works", "Drainage", "dealing_hand", True, 1),
    ("Bharat Reddy", "Health & Sanitation", "Solid Waste", "under_secretary", True, 2),
    ("Dinesh Kapoor", "Health & Sanitation", "Public Health", "dealing_hand", True, 1),
    ("Gurpreet Kaur Qureshi", "Town Planning", "Building Permissions", "director", True, 3),
    ("Dilip Das", "Town Planning", "Zoning", "section_officer", True, 2),
    ("Nitin Kulkarni", "Water Works", "Distribution", "section_officer", True, 2),
    ("Param Bajwa", "Water Works", "Billing", "dealing_hand", True, 1),
    ("Sanjay Thakur", "Accounts", "Budget", "hod", True, 4),
    ("Pradeep Bhatt", "Accounts", "Payments", "dealing_hand", True, 1),
]


def seed_operators():
    st, emp = call("GET", "hrms/employees?limit=500")
    by = {}
    for e in rows(emp):
        if e["status"] in ("probation", "confirmed", "active"):
            by.setdefault(e["name"], e["id"])
    st, ops = call("GET", "estab/operators?activeOnly=false&limit=500")
    have = {o["employeeId"] for o in rows(ops)}
    made = skipped = 0
    for name, div, sec, role, init, clr in PLAN:
        eid = by.get(name)
        if not eid:
            print("  ! employee not found:", name)
            continue
        if eid in have:
            skipped += 1
            continue
        if DRY:
            print("  would enrol", name, div)
            continue
        st, r = call("POST", "estab/operators", {"employeeId": eid, "division": div, "section": sec,
                                                  "deskRole": role, "canInitiate": init, "clearanceLevel": clr})
        print("  enrol", name, div, st, "" if st == 202 else str(r)[:160])
        made += st == 202
    print(f"operators: created={made} already_present={skipped}")


def seed_minutes(estab_meeting_id):
    """Ensure the estab meeting links to a REAL governance meeting that has minutes."""
    st, m = call("GET", f"estab/meetings/{estab_meeting_id}")
    gov = m.get("governanceMeetingId") if isinstance(m, dict) else None
    if gov:
        st, _ = call("GET", f"meeting/{gov}")
        if st == 404:  # dangling link (governance meeting gone) -> relink to a live one
            gov = None
    if not gov:
        st, lst = call("GET", "estab/meetings?limit=100")
        taken = {x.get("governanceMeetingId") for x in lst} if isinstance(lst, list) else set()
        st, g = call("GET", "meeting?limit=100")
        cand = [x["id"] for x in rows(g) if x["id"] not in taken]
        if not cand:
            print("no free governance meeting to link"); return
        gov = cand[0]
        if DRY: print("  would relink", estab_meeting_id, "->", gov); return
        st, r = call("PATCH", f"estab/meetings/{estab_meeting_id}/governance-link", {"governanceMeetingId": gov})
        print("relink:", st); time.sleep(3)
    st, _ = call("GET", f"meeting/{gov}/minutes")
    if st == 200:
        print("minutes: already present"); return
    if DRY:
        print("  would create minutes for", gov); return
    st, r = call("POST", f"meeting/{gov}/minutes", {})
    print("minutes create:", st, str(r)[:200])


# Library: realistic catalogue + one live loan to a real employee. A loan to a real employee also keeps
# GET hrms/employees?ids=... from returning an empty page (hrms bug: empty ids result -> 400, see PR).
BOOKS = [
    ("MUN-ACC-0101", "The Constitution of India (Bare Act)", "Government of India", "9788131413647", "Law", 3),
    ("MUN-ACC-0102", "Manual on Municipal Accounting", "Comptroller & Auditor General", "9788120339880", "Finance", 2),
    ("MUN-ACC-0103", "Right to Information Act, 2005: A Handbook", "Ministry of Personnel", "9788177084405", "Governance", 2),
]
LOAN_BOOK = "32ed3e94-0b20-4119-90d5-2948dc8cb41d"  # pinned L1 library book
LOAN_TO = "Anjali Saxena"


def seed_library():
    st, bk = call("GET", "estab/library/books?limit=500"); have = {b["accessionNo"] for b in (bk if isinstance(bk, list) else [])}
    for acc, title, author, isbn, cat, n in BOOKS:
        if acc in have: continue
        if DRY: print("  would add book", acc); continue
        st, r = call("POST", "estab/library/books", {"accessionNo": acc, "title": title, "author": author, "isbn": isbn, "category": cat, "copiesTotal": n})
        print("  book", acc, st)
    st, emp = call("GET", "hrms/employees?limit=500")
    eid = next((e["id"] for e in rows(emp) if e["name"] == LOAN_TO and e["status"] in ("probation", "confirmed", "active")), None)
    st, iss = call("GET", f"estab/library/issues?bookId={LOAN_BOOK}&limit=500")
    if eid and not any(i["borrowerRef"] == eid for i in (iss if isinstance(iss, list) else [])):
        if DRY: print("  would issue pinned book to", LOAN_TO); return
        due = time.strftime("%Y-%m-%dT10:00:00.000Z", time.gmtime(time.time() + 21 * 86400))
        st, r = call("POST", "estab/library/issues", {"bookId": LOAN_BOOK, "employeeRef": eid, "dueAt": due})
        print("  issue", LOAN_TO, st, "" if st == 202 else str(r)[:160])


if __name__ == "__main__":
    seed_operators()
    seed_library()
    seed_minutes(os.environ.get("ESTAB_MEETING_ID", "deea720d-add9-4063-827c-414641fc845d"))
