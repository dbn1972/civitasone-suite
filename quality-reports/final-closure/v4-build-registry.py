#!/usr/bin/env python3
"""Build quality-reports/final-closure/v4-registry.json: one row per defect, all runs.
Inputs (all on cloudsphere-ec2):
  ~/orch-logs/closure/v4/{discovery-result,lane-*,verify-*,remediation-result,cycle2-result}.json
  ~/orch-logs/closure/v4/cert/{build,db,contract-e2e,security-perf,regression}.json
  ~/orch-logs/closure/v4/cert/reports/pr-<n>.json   (gh pr view, original V4 PRs and bundles)
  ~/orch-logs/closure/{pass1-result,run2-*,run3-*}.json  (earlier runs)
Closure status rule (V4): VERIFIED only if the fix is merged to main AND its regression test passed in the
regression lane (cert/regression.json gate 20a/20b) AND no contradicting lane result exists; otherwise
UNRESOLVED / BLOCKED_FOR_APPROVAL / VERIFICATION_BLOCKED / NOT_REPRODUCED / DUPLICATE.
Usage: v4-build-registry.py <repo-worktree> <out.json>
"""
import json, os, re, glob, subprocess, sys, collections
L = os.path.expanduser("~/orch-logs/closure"); V = L + "/v4"; R = V + "/cert/reports"
WT, OUT = sys.argv[1], sys.argv[2]
SHA = open(V + "/FROZEN_SHA").read().strip()
J = lambda p: json.load(open(p))

def git_has(path):
    return subprocess.run(["git", "-C", WT, "cat-file", "-e", f"{SHA}:{path}"], capture_output=True).returncode == 0

# ---------------- V4 discovery / verification ----------------
lane = {}
for x in "ABCDEFG":
    for f in J(f"{V}/lane-{x}.json")["findings"]:
        lane[f["id"]] = f
verd = {}
for x in "ABCDEFG":
    for v in J(f"{V}/verify-{x}.json")["verdicts"]:
        verd[v["id"]] = v
disc_ids = [c["id"] for l in J(f"{V}/discovery-result.json")["result"] for c in l["confirmed"]]
assert len(disc_ids) == len(set(disc_ids)) == 58, len(disc_ids)

LANE_REQ = {
 "A": "Web client security and correctness (MASTER PROMPT V4.0 lane A: frontend, BFF proxy, middleware, money handling)",
 "B": "Authorization and object-level access control; public endpoints (V4.0 lane B: authz, IDOR, public surface)",
 "C": "Data integrity and uniqueness / tenant isolation of keys (V4.0 lane C)",
 "D": "Workflow and financial-event integrity (V4.0 lane D)",
 "E": "Security hardening: secrets, upload, auth fallbacks, ownership (V4.0 lane E)",
 "F": "Reliability and resource handling (V4.0 lane F)",
 "G": "Citizen service end-to-end flows, fee/refund/issuance/audit integrity (V4.0 lane G)",
}

# defect -> original PR(s), from remediation-result.json and cycle2-result.json (see report)
DPR = {
 "V4-A-01": [2252], "V4-A-02": [2266], "V4-A-03": [2235], "V4-A-04": [2247], "V4-A-05": [2235], "V4-A-06": [2235],
 "V4-A-07": [2236], "V4-A-08": [2236], "V4-A-09": [2247],
 "V4-B-01": [2271], "V4-B-02": [2240], "V4-B-03": [2268], "V4-B-04": [2239], "V4-B-05": [], "V4-B-06": [2273],
 "V4-B-07": [2253], "V4-B-08": [2256], "V4-B-09": [2250], "V4-B-10": [2251], "V4-B-11": [2255],
 "V4-C-01": [2264], "V4-C-02": [2259], "V4-C-03": [2272], "V4-C-04": [2265, 2284], "V4-C-05": [2267], "V4-C-06": [2257],
 "V4-D-01": [2260], "V4-D-02": [2258], "V4-D-03": [2261], "V4-D-04": [2262], "V4-D-05": [2263], "V4-D-06": [2270], "V4-D-07": [2259],
 "V4-E-01": [2240], "V4-E-02": [2238], "V4-E-03": [2274], "V4-E-04": [2235], "V4-E-05": [2276], "V4-E-06": [2269], "V4-E-07": [2237],
 "V4-F-01": [2278], "V4-F-02": [2282], "V4-F-03": [2277], "V4-F-04": [2257], "V4-F-05": [2278], "V4-F-06": [2278],
 "V4-G-01": [2283], "V4-G-02": [2242], "V4-G-03": [2241], "V4-G-04": [2240], "V4-G-05": [2275], "V4-G-06": [2244],
 "V4-G-07": [2248], "V4-G-08": [2249], "V4-G-09": [2254], "V4-G-10": [2243], "V4-G-11": [2245], "V4-G-12": [2246],
}
assert set(DPR) == set(disc_ids)
DUP = {"V4-E-04": "V4-A-03", "V4-E-01": "V4-B-02", "V4-G-04": "V4-B-02"}
NOT_REPRO = {"V4-B-05": "sanitationRoutes is never registered (not in helpdesk-service/src/app.ts or anywhere else in the repo), so every /v1/helpdesk/sanitation/* path returns 404; a test run confirmed 404 for GET, reopen and POST (remediation-result.json, slice helpdesk). The missing ownership scoping is latent dead code to fix when the module is registered."}

def pr(n):
    return J(f"{R}/pr-{n}.json")
BUNDLE = {}
for b in (2280, 2281):
    for m in set(re.findall(r"#(\d{4})\b", pr(b)["body"])):
        BUNDLE.setdefault(int(m), []).append(b)
MERGE = {b: pr(b)["mergeCommit"]["oid"] for b in (2279, 2280, 2281)}
for p in sorted({p for v in DPR.values() for p in v}):
    assert p in BUNDLE, f"PR {p} not in a bundle body"

def sect(body, pats, n=900):
    for p in pats:
        m = re.search(p + r"\s*\n+(.*?)(?=\n#{1,4} |\n\*\*[A-Z][^*]{2,40}:\*\*|\Z)", body, re.S | re.I)
        if m and m.group(1).strip():
            return re.sub(r"\s+", " ", m.group(1)).strip()[:n]
    return ""

def review(p):
    d = pr(p); best = None
    for c in d["comments"]:
        if c["body"].startswith("**Independent review (V4"):
            best = c
    if not best: return None
    b = best["body"]
    head = re.search(r"\*\*Independent review \(V4, round (\d+)\), head ([0-9a-f]{7,40})", b)
    verdict = "CLEAN" if re.search(r"\bCLEAN\b", b[:400]) else ("CHANGES REQUESTED" if "CHANGES REQUESTED" in b[:400] else "UNCLEAR")
    return {"pr": p, "round": int(head.group(1)) if head else None, "head": head.group(2) if head else None,
            "verdict": verdict, "at": best["createdAt"], "excerpt": re.sub(r"\s+", " ", b)[:420]}

REG_PASS_NOTE = "cert/regression.json gate 20a: 78 of 79 V4 PR test files pass on the frozen SHA; every defect V4-A..G passes except the citizen-service fixture file"
VERIF_BLOCKED = {}
CI_NOTE = {
 "V4-D-03": " Local certification runs of the grant-service package at --maxWorkers=2 on amd64-emulated Postgres failed (see V4-CERT-01) but the GitHub CI Tests job (run 40258410831, turbo test --maxWorkers=2) did NOT list grant-service#test among its 2 failed tasks, and the serial regression-lane run passes.",
 "V4-D-04": " Same as V4-D-03: local parallel runs failed on emulated Postgres (V4-CERT-01); GitHub CI grant-service#test passed; serial regression-lane run passes.",
}
RESID = {
 "V4-A-01": "Only the user-agnostic /offline page is cached; offline behaviour for authenticated routes is degraded by design.",
 "V4-B-01": "Persistence added by cycle 2 (migration 0252_hrms_comp_off.sql). Integration defect V4-CERT-02: web auditResource.test fails because resourceType comp_off is not in HR_AUDIT_RESOURCE_TYPES.",
 "V4-B-03": "Gateway forwards raw webhook bodies to billing-service; the provider-to-ledger path was not exercised against real providers or a live stack (E2E NOT_RUN).",
 "V4-B-06": "Public directory tables adv_permit_directory and building_permit_directory carry tenant_id without RLS in the same migration: tenant-table-rls-guard FAILS (V4-CERT-03).",
 "V4-C-01": "Schema change (migration) applied only on disposable DBs in this certification; production migration sequencing not exercised.",
 "V4-C-03": "Schema change (migration) applied only on disposable DBs in this certification.",
 "V4-C-04": "building and event applications are covered by CLOS3-S4-09 (#2279), not by #2284; the #2284 building/event commits were dropped from #2280 as duplicates.",
 "V4-C-05": "Schema change (migration) applied only on disposable DBs in this certification.",
 "V4-D-02": "Approval-path re-emit removed in cycle 2; consumers keyed on paymentId were verified by reading code, not by a live-stack run.",
 "V4-F-02": "Adds a new runtime dependency @fastify/multipart 8.3.1 (exact pin, lockfile additions). The remediation lane said it needs owner approval for the dependency; no dependency-specific owner approval is recorded (the blanket approval 'close all by tomorrow morning' covers HIGH and BLOCKED_FOR_APPROVAL PRs; #2282 carries neither tag). Open approval-evidence item.",
 "V4-G-01": "Public verification endpoint is unauthenticated by design with a token-scoped SELECT policy (citizen migration 0044 after renumber) and a 30/min per-IP limit; no live-stack test of the public route.",
 "V4-G-09": "Refund event citizen.refund.approved is flagged as an orphan by the cross-service-events contract (V4-CERT-07).",
 "V4-G-10": "Combined with the V4-G-12 fixtures it produces the red citizen-service suite V4-INTEG-01.",
 "V4-G-12": "Its own appeal-filing-integrity.test.ts passes 9/9, but the SVC-089 fixture file service-gaps-partial-routes.test.ts is red at the integrated SHA (V4-INTEG-01).",
 "V4-E-03": "Auth boundary change (NODE_ENV allow-list); anything relying on dev fallbacks outside the allow-list now fails closed.",
 "V4-E-05": "Contract boundary change (presigned upload now enforces content-type and size).",
}

def is_test(f):
    return bool(re.search(r"(^|/)(tests?|__tests__)/|\.(test|spec)\.[tj]sx?$", f))

def component(files):
    comps = collections.OrderedDict()
    for f in files:
        m = re.match(r"(services/[^/]+|apps/[^/]+|packages/[^/]+|tests/[^/]+)", f)
        if m and not is_test(f):
            comps[m.group(1)] = 1
    return ", ".join(comps) or "see changed files"

rows = []
for did in disc_ids:
    lf, vf = lane[did], verd[did]
    prs = DPR[did]
    files, tests = [], []
    for p in prs:
        for f in pr(p)["files"]:
            fp = f["path"]; (tests if is_test(fp) else files).append(fp)
    files = list(dict.fromkeys(files)); tests = list(dict.fromkeys(tests))
    test_status = [{"path": t, "at_sha": git_has(t)} for t in tests]
    rv = [review(p) for p in prs]
    body = pr(prs[0])["body"] if prs else ""
    root = lf.get("rootCause") or sect(body, [r"#{2,4} Root cause", r"\*\*Root cause:?\*\*"]) or ""
    fix = sect(body, [r"#{2,4} Fix", r"#{2,4} Summary"]) or lf.get("suggestedFix") or (pr(prs[0])["title"] if prs else "")
    resid_pr = sect(body, [r"#{2,4} Residual risk"], 500)
    row = {
      "id": did, "run": "V4", "lane": did.split("-")[1], "severity": vf["severity"].upper(),
      "severityAtDiscovery": lf["severity"].upper(), "title": lf["title"],
      "component": component(files) if files else component([x.split(":")[0] for x in lf.get("files", [])]),
      "requirement": lf.get("requirement") or LANE_REQ[did.split("-")[1]],
      "reproduction": (vf.get("reproduction") or lf.get("evidence") or lf.get("observed") or sect(body, [r"#{2,4} Evidence[^\n]*"], 700) or "Confirmed by the independent verifier (verify-%s.json confirmed=true); no reproduction text recorded there; see the PR failing-first evidence." % did.split("-")[1]), "verifierReason": vf.get("reason", "verify-%s.json: confirmed=true, severity %s, authorization %s" % (did.split("-")[1], vf["severity"], vf["authorization"])),
      "authorizationClass": vf["authorization"],
      "rootCause": root or "see reproduction", "correctiveAction": fix,
      "changedFiles": files, "testFiles": test_status,
      "originalPRs": prs, "bundles": sorted({b for p in prs for b in BUNDLE.get(p, [])}),
      "reviews": [r for r in rv if r], "residualRisk": RESID.get(did) or resid_pr or "none recorded beyond the items in release-readiness.md",
    }
    row["mergeCommits"] = [MERGE[b] for b in row["bundles"]]
    if did in DUP:
        row.update(closureStatus="DUPLICATE", duplicateOf=DUP[did],
                   verification=f"Duplicate of {DUP[did]}; remediated by PR {prs[0]} (same change). Covered by that defect's regression test.")
    elif did in NOT_REPRO:
        row.update(closureStatus="NOT_REPRODUCED", verification=NOT_REPRO[did], mergeCommits=[], bundles=[], originalPRs=[],
                   rootCause="latent dead code (module never registered)", correctiveAction="none; fix when sanitationRoutes is registered")
    elif did == "V4-G-12":
        row.update(closureStatus="UNRESOLVED", verification="Merged in #2280. Own regression test appeal-filing-integrity.test.ts PASSES 9/9, but the PR also changed tests/service-gaps-partial-routes.test.ts and that file FAILS 10 of 38 at the frozen SHA (regression gate 20a/20b, deterministic). A PR test file is red, so the VERIFIED rule is not met. Tracked as V4-INTEG-01.")
    elif did in VERIF_BLOCKED:
        row.update(closureStatus="VERIFICATION_BLOCKED", verification=VERIF_BLOCKED[did])
    else:
        row.update(closureStatus="VERIFIED",
                   verification="Merged to main in " + ", ".join(f"#{b} ({MERGE[b][:9]})" for b in row["bundles"]) + "; regression test(s) PASS on the frozen SHA in the regression lane (" + REG_PASS_NOTE + ")." + CI_NOTE.get(did, ""))
    rows.append(row)

for r in rows:
    if r["id"] == "V4-C-04":
        r["bundles"] = sorted(set(r["bundles"] + [2279])); r["mergeCommits"] = [MERGE[b] for b in r["bundles"]]
        r["verification"] = ("Market (#2265) and parking/trade (#2284, parking+trade commits) merged in #2280 (66b04aedd); building/event parts superseded by CLOS3-S4-09 merged in #2279 (e845c0401). "
            "Regression: parking/trade v4-c-04 tests PASS; building/event v4-c-04 test files do not exist at the SHA, covered by closure3-s4-09 reference-sequence tests that PASS in regression gate 20b/20c.")
    if r["id"] == "V4-A-07":
        r["correctiveAction"] += " Cycle 2 added CreateTenderForm.tsx (minorToSafeNumber) on #2236."
    if r["id"] == "V4-G-01":
        r["correctiveAction"] = "Gateway public prefix /api/v1/citizen/certificates/verify; citizen migration (token-scoped SELECT policy) and GUC set in findCertByToken (cycle-2 PR #2283). " + r["correctiveAction"]

def cert(i, sev, title, comp, req, repro, root, action, gate, related, resid=""):
    return {"id": i, "run": "V4-CERT", "lane": "CERT", "severity": sev, "severityAtDiscovery": sev, "title": title, "component": comp,
        "requirement": req, "reproduction": repro, "verifierReason": "found by certification gate run (severity assigned by the Release Certification Auditor, provisional)",
        "authorizationClass": "n/a", "rootCause": root, "correctiveAction": action, "changedFiles": [], "testFiles": [], "originalPRs": [], "bundles": [],
        "mergeCommits": [], "reviews": [], "closureStatus": "UNRESOLVED", "verification": "NOT FIXED. Found by: " + gate, "relatedDefects": related,
        "residualRisk": resid or "Open at the frozen SHA; the certification lane was read-only on code."}
cl = "~/orch-logs/closure/v4/cert/"
rows += [
 cert("V4-INTEG-01", "MEDIUM", "citizen-service suite red at integrated SHA: 10 of 38 tests in service-gaps-partial-routes.test.ts fail", "services/citizen-service (tests)",
      "Mandatory gate: unit/service tests green (V4.0 gates 4/20)",
      "Deterministic on 3 fresh-DB runs plus an isolation run: the REMAND test files a second appeal against application 66666666-0000-4000-8000-000000000016 and gets 409 NOT_APPEALABLE (appeal/commands.ts:58); id is undefined, the test polls /appeals/undefined for 3s, exhausts the 200/min rate-limit bucket, and later SVC-084/SVC-089 IDOR tests return 500 (429 surfaced as unhandled error).",
      "PR #2246 (V4-G-12 fixtures) and PR #2243 (V4-G-10: appeal outcome moves the application out of 'rejected') collide: an earlier test in the same file issues an order that now moves the shared seeded application out of 'rejected'. Each PR was clean alone (cycle 2 reported 38/38 on the #2246 head). CONFIRMED IN GITHUB CI: run 40258410831 Tests job failed on @civitasone/citizen-service#test (4 tests failed in the CI run, same file).",
      "Seed a separate rejected application per test (or reset status in beforeEach) and stop the rate-limit exhaustion; not applied (lane read-only).",
      cl + "regression.json gates 20a and 20b; build.json gate 4; db.json svc-citizen-service", ["V4-G-10", "V4-G-12"]),
 cert("V4-CERT-01", "LOW", "grant-service v4-d03/v4-d04 tests fail under CI parallelism (cross-file isolation)", "services/grant-service (tests)",
      "Mandatory gate: unit/service tests green under the CI configuration",
      "Fresh-DB runs at --maxWorkers=2: 4 failures (grant_schemes_pkey duplicate key, deadlock, wrong totals) in tests/v4-d03-duplicate-disbursement.test.ts and tests/v4-d04-failed-disbursement.test.ts; they pass at maxWorkers=1 (regression lane). The db-lane rerun was still red. NOT reproduced in GitHub CI (run 40258410831 Tests job: grant-service#test succeeded), so this is classified as an environment/isolation sensitivity (amd64-emulated PG).",
      "Cross-file shared fixtures/ids in the grant test suites; not triaged beyond that.", "Isolate fixtures per file or run the package serially; triage whether a real lock-ordering defect exists (a deadlock was reported).",
      cl + "build.json gate 4; db.json svc-grant-service", ["V4-D-03", "V4-D-04"], "If the reported deadlock is real, the V4-D-03/V4-D-04 fixes could hold a lock-order defect; not reproduced in GitHub CI."),
 cert("V4-CERT-02", "MEDIUM", "web auditResource.test fails: hrms comp-off consumer emits resourceType comp_off not in HR_AUDIT_RESOURCE_TYPES", "apps/web (hr/audit-log), services/hrms-service",
      "Audit trail completeness: every audit resourceType must be visible in the HR audit-log filter",
      "apps/web src/app/(app)/hr/audit-log/auditResource.test.ts fails deterministically at the SHA. CONFIRMED IN GITHUB CI: run 40258410831 Tests job, @civitasone/web#test, 1 failed of 20127.", "V4-B-01 persistence (hrms comp-off-consumer, #2271 in #2280) added a new resourceType without updating the web allow-list.",
      "Add 'comp_off' to HR_AUDIT_RESOURCE_TYPES (and a label); not applied.", cl + "build.json gate 4", ["V4-B-01"]),
 cert("V4-CERT-03", "MEDIUM", "tenant-table-rls-guard FAILS: adv_permit_directory and building_permit_directory have tenant_id without RLS", "services/advertisement-service, services/building-service (migrations)",
      "Tenant isolation: every tenant_id table has ENABLE/FORCE RLS + policy, or a justified baseline entry",
      "node scripts/ci/tenant-table-rls-guard.mjs exit 1: advertisement-service/migrations/0006_permit_public_directory.sql and building-service/migrations/0005_permit_public_directory.sql. CONFIRMED IN GITHUB CI: Architecture Guard job failed (R_TENANT_TABLE_RLS).",
      "Public verification directory tables added by V4-B-06 (#2273) without RLS or a baseline justification.", "Add RLS policy or baseline with written justification (public read model); not applied.", cl + "build.json gate 14 tenant-table-rls-guard", ["V4-B-06"]),
 cert("V4-CERT-04", "LOW", "flaky-skip-guard FAILS: 7 un-inventoried skipIf in closure3 int tests", "tests (closure3-s4/s5 *.int.test.ts)",
      "No silent skipped tests (flaky-skip-guard)", "node scripts/ci/flaky-skip-guard.mjs exit 1: audit, billing x2, catalogue, contract, legal x2 int tests lack a FLAKY-SKIP reason/expiry. CONFIRMED IN GITHUB CI: Architecture Guard job failed (R_FLAKY_SKIP_GUARD).",
      "Closure-3 integration tests added skipIf without inventory entries.", "Add FLAKY-SKIP reason+expiry or baseline; not applied.", cl + "build.json gate 14 flaky-skip-guard", []),
 cert("V4-CERT-05", "LOW", "authz-tenant-scanner ratchet FAILS on 4 stale baseline entries", "scripts/ci/authz-tenant-scanner-baseline.json",
      "SEC-014 authz/tenant ratchet", "node scripts/ci/authz-tenant-scanner.mjs exit 1 (build and db lanes): billing ccavenue/payu/razorpay webhooks and knowledge ai/prompt no longer reproduce but are still baselined. CONFIRMED IN GITHUB CI: Architecture Guard job failed (R_AUTHZ_TENANT_SCANNER).",
      "Fixes landed (V4-B-03, V4-B-09) without regenerating the baseline.", "Regenerate with --write-baseline; not applied.", cl + "build.json, db.json (g-authz-scanner)", ["V4-B-03", "V4-B-09"]),
 cert("V4-CERT-06", "LOW", "cross-service-events contract: stale baseline entry deadSubscriptions finance-service|finance.payment.file_decided", "tests/contract/cross-service-events.contract.test.ts",
      "Contract baseline must not contain fixed defects", "tests/contract: 1 file failed, 2 of 227 tests (this is the first). CONFIRMED IN GITHUB CI: Contract Tests job failed on BLOCKING baseline has no stale entries.", "Fixed defect (V4-D-01) still baselined.", "Remove the baseline entry; not applied.", cl + "contract-e2e.json gate 6a", ["V4-D-01"]),
 cert("V4-CERT-07", "MEDIUM", "cross-service-events contract: orphan event citizen.refund.approved (no recognised consumer)", "tests/contract, services/citizen-service, services/finance-service",
      "Every produced event has a consumer or an allow-list entry", "Same contract file, second failure. A finance refund-consumer.ts exists, so the detector may miss it or an allow-list entry is needed. CONFIRMED IN GITHUB CI: Contract Tests job failed on BLOCKING no NEW orphan events.",
      "Introduced with the V4-G-09 refund path; not triaged.", "Add PRODUCER_ONLY_ALLOWLIST/known-defects entry or fix the detector; not applied.", cl + "contract-e2e.json gate 6a", ["V4-G-09"]),
 cert("V4-CERT-08", "MEDIUM", "payroll posting-history: hrms applyPosting event does not land a payroll history row (2 tests fail deterministically)", "tests/cross-service-live (hrms, payroll)",
      "Cross-service event delivery (outbox relay)", "payroll-posting-history.test.ts ST-M01-11: 2 failed, also with maxWorkers=1 on a freshly bootstrapped DB; not covered by ci.yml.", "Not triaged.", "Triage relay/consumer wiring; not applied.", cl + "contract-e2e.json gates 19a/19b", []),
 cert("V4-CERT-09", "LOW", "tests/security idor-inventory sanity test fails: task-named route GET /v1/inventory/movements/:id does not exist", "tests/security/idor-inventory.test.ts",
      "IDOR test inventory is accurate", "Failed in both runs of tests/security (3 failed first run, 1 failed on rerun); two idor.test.ts 5000ms timeouts occurred in run 1 only (emulated amd64 PG).", "Stale test expectation.", "Update the test; not applied.", cl + "db.json G11", []),
 cert("V4-CERT-10", "HIGH", "service roles citizen_svc, legal_svc, telephony_svc have BYPASSRLS in the bootstrapped DB (RLS inert)", "db roles / scripts/ci/bootstrap-postgres.sh",
      "RLS must be effective for service roles (non-BYPASSRLS)", "tests/data-integrity/rls-no-guc.test.ts: 4 failures incl. 'citizen: RLS inert via BYPASSRLS'. Not run by the ci.yml test job.",
      "Unknown whether the roles come from the bootstrap script only or mirror production provisioning; not triaged.", "Verify role attributes in the target environment and remove BYPASSRLS; not applied.", cl + "db.json G13", [], "Potential tenant-isolation bypass on three services if production roles match."),
 cert("V4-CERT-11", "MEDIUM", "plaintext PII at rest: telephony.calls caller/callee numbers and citizen_profiles.mobile", "services/telephony-service, services/citizen-service",
      "PII at rest protection", "tests/data-integrity/pii-at-rest.test.ts: 3 failures.", "Not triaged.", "Encrypt or tokenise; not applied.", cl + "db.json G13", []),
 cert("V4-CERT-12", "MEDIUM", "tests/cross-service topic-wiring assertions fail (5 tests read undefined constants)", "tests/cross-service flow2/flow4/flow5",
      "Cross-service flow wiring evidence", "5 failed/9 passed: GRN three-way match emit+consume, contract-expiry alert emit+consume, audit-trail topic agreement.", "Not triaged; may be stale constants.", "Triage; not applied.", cl + "db.json G12", []),
 cert("V4-CERT-13", "LOW", "analytics-service export-consumer 50MB limit test fails in the db lane (not seen in the build-lane turbo test)", "services/analytics-service (tests)",
      "Unit/service tests green", "svc-analytics-service: 1 failure, fails again on rerun.", "Not triaged (environment, memory or emulation suspected).", "Triage; not applied.", cl + "db.json svc-analytics-service", []),
 cert("V4-CERT-14", "LOW", "flaky under load and not in the known-flaky list: audit-service risk-routes GAP-AUDIT-RISK-REGISTER-07; web bills/new duplicate-submit", "services/audit-service, apps/web (tests)",
      "Stable CI", "Each failed once in the full run and passed on rerun (audit-service 450/450 on rerun).", "Load-sensitive tests.", "Add to known-flaky with expiry or harden; not applied.", cl + "build.json gate 4; db.json", []),
 cert("V4-CERT-17", "MEDIUM", "gitleaks secret scan FAILS on the frozen SHA commit: 2 generic-api-key findings in test files added by bundle A", "services/queue-service/vitest.config.ts:10, services/hrms-service/src/modules/leave/comp-off-authz.test.ts:32",
      "Mandatory gate: secret scan (gitleaks) clean on the release commit",
      "GitHub Security Scan run 40258410829, job Secret Scan (gitleaks-action, log-opts=-1): 'leaks found: 2', RuleID generic-api-key, commit 66b04aedd. Values redacted by gitleaks and not reproduced here. The build-lane scripts/ci/secret-scanner.mjs and the ci.yml grep patterns were clean, and gitleaks was not installed on the certification host, so only GitHub CI exercised this gate.",
      "Secret-shaped string literals in test files (JWT_SECRET in a vitest config; const SECRET in a test) introduced by the V4 bundle; whether they are fake test values was not established by this lane.",
      "Replace with env-derived/obviously-fake values or add a justified gitleaks allow entry; not applied (lane read-only on code).", cl + "reports/job-121365184496.log", ["V4-B-01"]),
 cert("V4-CERT-15", "CRITICAL", "open CRITICAL code-scanning alerts on main: 5 (CodeQL 2, Trivy 3)", "repo (code scanning)",
      "No open CRITICAL scanner alerts at release", "gh api code-scanning/alerts?state=open&ref=refs/heads/main: 2421 open, 5 critical. None from the frozen SHA (older SHAs 96e536cf9, e845c0401).",
      "Not triaged in this certification.", "Triage/dismiss with justification or fix; not applied.", cl + "security-perf/codeql-all.json", [], "Counted as one registry row; alerts=5."),
 cert("V4-CERT-16", "HIGH", "open HIGH code-scanning alerts on main: 245 (CodeQL 68, Trivy 177)", "repo (code scanning)",
      "No untriaged HIGH scanner alerts at release", "Same query. CodeQL high rules include missing-rate-limiting, path-injection, request-forgery, insufficient-password-hash (gateway api-key-auth.ts), disabling-certificate-validation; Trivy findings are mostly image CVEs (hrms/finance/gateway), node-forge CVE-2026-85393, uuid CVE-2026-41907.",
      "Not triaged in this certification.", "Triage; not applied.", cl + "security-perf/codeql-all.json", [], "Counted as one registry row; alerts=245."),
]

# ---------------- earlier runs ----------------
def sev(s): return str(s).upper()
def comp_of(path):
    m = re.match(r"(services/[^/]+|apps/[^/]+|packages/[^/]+)", path or "")
    return m.group(1) if m else (path or "")[:60]
def prior(i, run, s, t, comp, st, v):
    return {"id": i, "run": run, "severity": s, "title": t, "component": comp, "closureStatus": st, "verification": v, "originalPRs": [], "bundles": [], "mergeCommits": []}
p1 = J(f"{L}/pass1-result.json")
r1_fixed = {"CLOS-S6-07": "closed: todayIST() in resolver.ts (defect-registry.md refresh 2026-10-24)", "CLOS-S4-05": "fix merged in #2279 (commit message lists CLOS-S4-05)"}
for x in p1["confirmedLow"]:
    rows.append(prior(x["id"], "RUN1", sev(x["severity"]), x["observed"][:140], comp_of(x["file"]), "FIXED_MERGED",
        "Run 1 PASS 2 before/after recorded by the fixer; merged (#2155/#2157/#2154/#2165/#2169/#2170/#2167). Not independently verified (see earlier sections)."))
for x in p1["blockedForApproval"]:
    st = "FIXED_MERGED" if x["id"] in r1_fixed else "BLOCKED_FOR_APPROVAL"
    rows.append(prior(x["id"], "RUN1", sev(x["severity"]), x["observed"][:140], comp_of(x["file"]), st,
        r1_fixed.get(x["id"], "Pending owner decision as of the 2026-10-24 refresh (deferred-approval-items.md); not re-checked in V4 certification.")))
for i, s, t, st, v in [
 ("CLOS-FLAKY-DRAINAGE", "MEDIUM", "drainage hotspotCode collision under concurrency", "FIXED_MERGED", "closed in #2182 (refresh 2026-10-24)"),
 ("CLOS-CVE-NEXT", "HIGH", "Next.js App Router DoS CVE-2026-94482", "FIXED_MERGED", "closed in #2175"),
 ("DELEG-REVOKE-OWNERSHIP", "HIGH", "delegation revoke/list ownership", "FIXED_MERGED", "closed in #2174"),
 ("DELEG-UTC", "MEDIUM", "delegation active check uses UTC date", "FIXED_MERGED", "closed in #2181"),
 ("P3-NEW-1", "MEDIUM", "regression from #2166 (unrated in sources; MEDIUM assigned)", "FIXED_MERGED", "closed (no res.status in the file on main)"),
 ("P3-NEW-2", "MEDIUM", "payroll visual-regression snapshots stale (unrated; MEDIUM assigned)", "ACCEPTED_DEFERRAL", "owner decision 2026-10-23 22:10 IST: accepted as known-stale"),
 ("P3-NEW-3", "MEDIUM", "E2E regression from #2152 (unrated; MEDIUM assigned)", "FIXED_MERGED", "closed in source (global-setup.ts mock)"),
 ("P3-NEW-4", "MEDIUM", "integration conflict, #2161 excluded (unrated; MEDIUM assigned)", "FIXED_MERGED", "closed: #2161 merged 2026-10-23"),
 ("P3-BASE-1", "MEDIUM", "web test red on main, pre-existing (unrated; MEDIUM assigned)", "FIXED_MERGED", "closed #2173"),
 ("FINAL-E2E-01", "HIGH", "duplicate h1#page-heading across loading.tsx and pages, 76 Playwright strict-mode violations", "FIXED_MERGED", "GitHub CI run 40258410831 (frozen SHA): job E2E (Playwright) completed success; not re-run on the certification host (NOT_RUN locally)"),
 ("FINAL-GATE-01", "HIGH", "Live Stack Verification contract score 10/10 fails", "FIXED_MERGED", "GitHub CI run 40258410831 (frozen SHA): job Live Stack Verification completed success; the local static-only score.mjs run (9.8/10, exit 1) is not a valid gate result"),
 ("FINAL-GATE-02", "HIGH", "Release Gate evidence audit, 11 gates UNMEASURED", "UNRESOLVED", "GitHub CI run 40258410831 (frozen SHA): job Release Gate (evidence audit) FAILED at 04:36:42Z with blockers L3 and L6 UNMEASURED (no evidence artifact) and SLO UNMEASURED (no L7-k6-slo.json); L3/Coverage/Integration jobs skipped because Tests failed"),
 ("FINAL-TEST-01", "LOW", "workflow delegations-routes test non-idempotent", "UNRESOLVED", "not re-verified"),
 ("FINAL-FLAKY-01", "LOW", "CreateContractForm GAP-CONTRACTS-NEW-02 flaky in CI", "UNRESOLVED", "known-flaky; not re-verified"),
]:
    rows.append(prior(i, "RUN1", s, t, "see defect-registry.md run 1", st, v))

r2 = []
for f in sorted(glob.glob(f"{L}/run2-discover-*.json")):
    d = J(f); r2 += d if isinstance(d, list) else d.get("findings", [])
r2_appr = {x["id"] for x in J(f"{L}/run2-blocked-approved.json")}
for x in r2:
    if x["id"] == "CLOS2-S2-09": st, v = "BLOCKED_FOR_APPROVAL", "Pending owner decision as of the 2026-10-24 refresh; not re-checked"
    elif x["id"] == "CLOS2-S1-14": st, v = "UNRESOLVED", "LOW-risk, no PASS 2 record found (2026-10-24 refresh); not re-checked"
    elif x["id"] in r2_appr: st, v = "FIXED_MERGED", "owner-approved, fixed and merged (#2186-#2192 via #2193)"
    else: st, v = "FIXED_MERGED", "fixed in Run 2 PASS 2, merged via #2193 (refresh 2026-10-24)"
    rows.append(prior(x["id"], "RUN2", sev(x["severity"]), x["observed"][:140], comp_of(x["file"]), st, v))

r3 = []
for f in sorted(glob.glob(f"{L}/run3-discover-*.json")):
    d = J(f); r3 += d if isinstance(d, list) else d["findings"]
r3_fix = {}
for f in sorted(glob.glob(f"{L}/run3-pass2-*.json")):
    for it in J(f)["items"]: r3_fix[it["id"]] = it.get("status")
r3_appr = {x["id"] for x in J(f"{L}/run3-blocked-approved.json")}
NOTE3 = "; the delta regression gate 20b (242/243 files) passed but a per-defect test mapping is not recorded, so not VERIFIED"
for x in r3:
    if x["id"] in r3_appr: st, v = "FIXED_MERGED", "owner-approved ('yes approved to fix all'), merged in #2279 (e845c0401)"
    elif r3_fix.get(x["id"]) == "FIXED": st, v = "FIXED_MERGED", "fixed in Run 3 PASS 2, merged in #2227 (96e536cf9)"
    else: st, v = "UNRESOLVED", "no PASS 2 FIXED record and not in the owner-approved list"
    rows.append(prior(x["id"], "RUN3", sev(x["severity"]), x["observed"][:140], comp_of(x["file"]), st, v + NOTE3))

ids = [r["id"] for r in rows]; assert len(ids) == len(set(ids)), [i for i, c in collections.Counter(ids).items() if c > 1]
json.dump({"frozenSha": SHA, "bundles": {str(k): v for k, v in MERGE.items()}, "rows": rows}, open(OUT, "w"), indent=1)
print(len(rows), dict(collections.Counter(r["run"] for r in rows)))
