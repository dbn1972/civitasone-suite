#!/usr/bin/env python3
"""Compute the consolidated defect table from v4-registry.json (no hand-typed numbers).
Columns: Found | Fixed | Verified | Awaiting Approval | Unresolved | Other.
  Found    = rows whose closureStatus is not DUPLICATE and not NOT_REPRODUCED (those are listed separately)
  Fixed    = FIXED_MERGED + VERIFIED + VERIFICATION_BLOCKED (fix merged to main; Verified is a subset of Fixed)
  Verified = VERIFIED (merged AND its regression test passed in the regression lane, no contradicting lane)
  Awaiting = BLOCKED_FOR_APPROVAL
  Unresolved = UNRESOLVED
  Other    = ACCEPTED_DEFERRAL (owner-accepted)
Invariant asserted: Found = Fixed + Awaiting + Unresolved + Other.
Usage: consolidate-defects.py <v4-registry.json> <defect-summary.json>
"""
import json, sys, collections
reg = json.load(open(sys.argv[1])); rows = reg["rows"]
SEV = ["CRITICAL", "HIGH", "MEDIUM", "LOW"]
EXCL = {"DUPLICATE", "NOT_REPRODUCED"}
FIXED = {"FIXED_MERGED", "VERIFIED", "VERIFICATION_BLOCKED"}
known = FIXED | EXCL | {"BLOCKED_FOR_APPROVAL", "UNRESOLVED", "ACCEPTED_DEFERRAL"}
for r in rows:
    assert r["closureStatus"] in known, (r["id"], r["closureStatus"])
    assert r["severity"] in SEV, (r["id"], r["severity"])

def table(sel):
    out = {}
    for s in SEV + ["TOTAL"]:
        rs = [r for r in sel if (s == "TOTAL" or r["severity"] == s) and r["closureStatus"] not in EXCL]
        c = collections.Counter(r["closureStatus"] for r in rs)
        t = {"found": len(rs), "fixed": sum(c[k] for k in FIXED), "verified": c["VERIFIED"],
             "awaiting": c["BLOCKED_FOR_APPROVAL"], "unresolved": c["UNRESOLVED"], "other": c["ACCEPTED_DEFERRAL"]}
        assert t["found"] == t["fixed"] + t["awaiting"] + t["unresolved"] + t["other"], (s, t)
        out[s] = t
    return out

scopes = {
  "V4 cycle (discovery V4-*, plus certification-found V4-INTEG/V4-CERT)": [r for r in rows if r["run"] in ("V4", "V4-CERT")],
  "V4 discovered defects only (V4-A..G)": [r for r in rows if r["run"] == "V4"],
  "All runs (Run 1, Run 2, Run 3, V4, certification-found)": rows,
}
by_run = {}
for run in ["RUN1", "RUN2", "RUN3", "V4", "V4-CERT"]:
    sel = [r for r in rows if r["run"] == run]
    by_run[run] = {"rows": len(sel), "status": dict(collections.Counter(r["closureStatus"] for r in sel))}
summary = {
  "frozenSha": reg["frozenSha"], "tables": {k: table(v) for k, v in scopes.items()}, "byRun": by_run,
  "excluded": {r["id"]: {"status": r["closureStatus"], "duplicateOf": r.get("duplicateOf")} for r in rows if r["closureStatus"] in EXCL},
  "statusCountsV4Cycle": dict(collections.Counter(r["closureStatus"] for r in rows if r["run"] in ("V4", "V4-CERT"))),
  "openHighCritical": [{"id": r["id"], "severity": r["severity"], "status": r["closureStatus"], "run": r["run"], "title": r["title"]}
                       for r in rows if r["severity"] in ("CRITICAL", "HIGH") and r["closureStatus"] in ("UNRESOLVED", "BLOCKED_FOR_APPROVAL", "VERIFICATION_BLOCKED")],
  "approvalPending": [{"id": r["id"], "severity": r["severity"], "run": r["run"]} for r in rows if r["closureStatus"] == "BLOCKED_FOR_APPROVAL"],
  "unresolved": [{"id": r["id"], "severity": r["severity"], "run": r["run"]} for r in rows if r["closureStatus"] == "UNRESOLVED"],
  "verificationBlocked": [r["id"] for r in rows if r["closureStatus"] == "VERIFICATION_BLOCKED"],
}
json.dump(summary, open(sys.argv[2], "w"), indent=1)
for k, t in summary["tables"].items():
    print(k)
    print("| Severity | Found | Fixed | Verified | Awaiting Approval | Unresolved | Other |")
    for s in SEV + ["TOTAL"]:
        v = t[s]; print(f"| {s} | {v['found']} | {v['fixed']} | {v['verified']} | {v['awaiting']} | {v['unresolved']} | {v['other']} |")
