#!/usr/bin/env python3
"""Insert/refresh the V4 certification sections in the 8 final-closure reports.
Idempotent: the V4 block sits between <!-- V4-CERT-BEGIN --> and <!-- V4-CERT-END --> right after the H1.
Every count comes from v4-registry.json via defect-summary.json (consolidate-defects.py).
Usage: v4-gen-reports.py <final-closure-dir>
"""
import json, os, re, sys, glob, hashlib, collections
OUTD = sys.argv[1]
L = os.path.expanduser("~/orch-logs/closure"); V = L + "/v4"; C = V + "/cert"; R = C + "/reports"
J = lambda p: json.load(open(p))
reg = J(f"{OUTD}/v4-registry.json"); rows = reg["rows"]; SUM = J(f"{OUTD}/defect-summary.json")
SHA = reg["frozenSha"]; S9 = SHA[:9]
BUNDLE_SHA = {int(k): v for k, v in reg["bundles"].items()}
SNAP = open(f"{R}/ci-snapshot-time.txt").read().strip()
BEGIN, END = "<!-- V4-CERT-BEGIN -->", "<!-- V4-CERT-END -->"
RID = {r["id"]: r for r in rows}

def esc(x): return str(x).replace("|", "\\|").replace("\n", " ").strip()
def sha256(p):
    h = hashlib.sha256(); h.update(open(p, "rb").read()); return h.hexdigest()
def tbl(head, body):
    out = ["| " + " | ".join(head) + " |", "|" + "---|" * len(head)]
    out += ["| " + " | ".join(esc(c) for c in r) + " |" for r in body]
    return "\n".join(out)
def cap(lst, n=10):
    lst = list(lst); return ", ".join(lst[:n]) + (f" (+{len(lst)-n} more; full list in v4-registry.json)" if len(lst) > n else "")

# ------------------------------------------------------------------ tables
def sev_table(scope):
    t = SUM["tables"][scope]
    body = [[s, t[s]["found"], t[s]["fixed"], t[s]["verified"], t[s]["awaiting"], t[s]["unresolved"], t[s]["other"]] for s in ["CRITICAL", "HIGH", "MEDIUM", "LOW", "TOTAL"]]
    return tbl(["Severity", "Found", "Fixed", "Verified", "Awaiting Approval", "Unresolved", "Other (owner-accepted)"], body)
SC_V4C = [k for k in SUM["tables"] if k.startswith("V4 cycle")][0]
SC_V4D = [k for k in SUM["tables"] if k.startswith("V4 discovered")][0]
SC_ALL = [k for k in SUM["tables"] if k.startswith("All runs")][0]
TABLE_NOTE = ("How the numbers are produced: `consolidate-defects.py` reads `v4-registry.json` (one row per defect) and counts rows by `severity` and `closureStatus`. "
 "Found = rows not DUPLICATE/NOT_REPRODUCED. Fixed = fix merged to main (FIXED_MERGED + VERIFIED + VERIFICATION_BLOCKED); Verified is a subset of Fixed (merged AND its regression test passed in the regression lane, no contradicting lane). "
 "Awaiting Approval = BLOCKED_FOR_APPROVAL. Unresolved = UNRESOLVED. Other = owner-accepted deferral. Invariant asserted by the script: Found = Fixed + Awaiting + Unresolved + Other. "
 "Excluded from Found: " + ", ".join(f"{k} ({v['status']}" + (f" of {v['duplicateOf']}" if v['duplicateOf'] else "") + ")" for k, v in SUM["excluded"].items()) + ". "
 "Severity for V4-A..G is the independent verifier's (verify-*.json), not the discoverer's. Certification-found rows (V4-INTEG-01, V4-CERT-nn) carry a provisional severity assigned by the Release Certification Auditor; V4-CERT-15/16 each count one row for many scanner alerts (5 and 245). "
 "Earlier-run rows (RUN1/RUN2/RUN3) have no independent per-defect verification, so none of them is Verified.")

# ------------------------------------------------------------------ gate matrix
def tsv(p):
    out = {}
    for ln in open(p):
        f = ln.rstrip("\n").split("\t")
        if len(f) >= 6: out[f[0]] = f
    return out
btsv = tsv(f"{C}/build/results.tsv")
BUILD_STATUS_OVERRIDE = {"g3-typecheck": "NOT_RELIED_ON (turbo cache replay)", "g3-lint": "NOT_RELIED_ON (turbo cache replay)", "g4-bootstrap-pg(run1)": "DISCARDED (first DB)",
    "g4-turbo-test": "FAIL", "b-tenant-table-rls": "FAIL", "b-flaky-skip": "FAIL", "b-authz-tenant-scanner": "FAIL"}
def gate_rows():
    g = []
    for name, f in btsv.items():
        rc = f[1]; st = BUILD_STATUS_OVERRIDE.get(name, "PASS" if rc == "0" else "FAIL")
        if name.startswith("r-"): st = ("PASS" if rc == "0" else "FAIL") + " (diagnostic rerun)"
        g.append(["build", name, st, f[6] if len(f) > 6 else "", rc, f[2], f[3], f"~/orch-logs/closure/v4/cert/build/{name}.log", f[4]])
    # contract-e2e lane files
    ce = f"{C}/contract-e2e"
    cmap = [("c1", "6a tests/contract (5 files)", "FAIL"), ("c2b", "6b remaining tests/contract (4 files)", "PASS"), ("score", "7 scripts/contract/score.mjs static-only (informational, NOT a valid gate result)", "NOT_RUN"),
            ("xs", "19a tests/cross-service-live full dir", "FAIL"), ("xs2", "19b payroll-posting-history isolated", "FAIL"), ("xs3", "19c module-gating-standalone.live", "PASS")]
    for k, nm, st in cmap:
        rd = lambda e: open(f"{ce}/{k}.{e}").read().strip()
        g.append(["contract-e2e", nm, st, rd("cmd"), rd("exit"), rd("start"), rd("end"), f"~/orch-logs/closure/v4/cert/contract-e2e/{k}.log", rd("sha")])
    # db lane
    for x in J(f"{C}/db.json")["gates"]:
        g.append(["db", x["gate"], x["status"], x.get("command", ""), x.get("exitCode", ""), x.get("startedUtc", ""), x.get("endedUtc", ""), x.get("log", ""), x.get("sha256", "")])
    sp = J(f"{C}/security-perf.json")["gates"]
    for k, x in sp.items():
        g.append(["security-perf", k, x["status"], x.get("command", ""), x.get("exit", ""), x.get("start", ""), x.get("end", ""), x.get("log", "see lane note"), "SHA256SUMS in ~/orch-logs/closure/v4/cert/security-perf/"])
    for x in J(f"{C}/regression.json")["gates"]:
        g.append(["regression", x["gate"], x["status"], x.get("command", ""), x.get("exitCode", ""), x.get("startedUtc", ""), x.get("endedUtc", ""), x.get("log", ""), "per-log hashes in ~/orch-logs/closure/v4/cert/regression/log-hashes.json"])
    return g
GATES = gate_rows()
NOTRUN = [
 ["build", "4b Gateway SEC-021 real-subprocess test (GATEWAY_SPAWN_TESTS=1)", "NOT_RUN", "omitted for time after the main test failures; containers torn down"],
 ["build", "14 gitleaks (local)", "NOT_RUN", "gitleaks not installed on cloudsphere-ec2 (GitHub CI ran it: FAIL, see CI table)"],
 ["contract-e2e", "6c render-smoke contract (apps/web jsdom)", "NOT_RUN", "not executed in the lane (GitHub CI Contract Tests job executed it)"],
 ["contract-e2e", "7 scripts/contract/score.mjs 10/10 on a live stack", "NOT_RUN", "needs live gateway stack on fixed shared ports"],
 ["contract-e2e", "8 Playwright E2E; 19d journey e2e (tests/e2e-live, tests/e2e-personas, apps/web/e2e)", "NOT_RUN", "needs full live stack; prefer-CI rule"],
 ["contract-e2e", "mobile integration tests (apps/mobile Flutter)", "NOT_RUN", "flutter/dart not installed on EC2"],
 ["db", "Web tsc / next build / LocalStack cross-process / Keycloak e2e", "NOT_RUN", "out of scope for the db lane; LocalStack absent (tests/integration/cross-process.localstack.test.ts skipped)"],
 ["security-perf", "15 Trivy (local)", "NOT_RUN", "no local Trivy for the SHA (GitHub Security Scan Trivy jobs ran: see CI table)"],
 ["security-perf", "17 Performance/load (k6 scripts/perf, tests/load; service N+1 suites)", "NOT_RUN", "needs a booted stack on shared dev Postgres/Redis, forbidden by the lane rules; only packages/db perf 3/3 and packages/cache perf-007 6/6 ran"],
 ["regression", "20e web tsc / next build", "NOT_RUN", "outside the regression lane (build lane ran them: PASS)"],
]

# ------------------------------------------------------------------ GitHub CI snapshot
def ci_tables():
    out = []
    summ = []
    for rid, nm in ((40258410831, "CI"), (40258410829, "Security Scan")):
        d = J(f"{R}/ci-run-{rid}.json")
        docker = [j for j in d["jobs"] if j["name"].startswith("Build & Push")]
        other = [j for j in d["jobs"] if not j["name"].startswith("Build & Push")]
        summ.append(f"- {nm} run {rid} (commit {S9}), run conclusion **{d['conclusion']}** at snapshot {SNAP}; {len(docker)} Docker image jobs: " + str(dict(collections.Counter(j['conclusion'] or j['status'] for j in docker))) if docker else f"- {nm} run {rid} (commit {S9}), run conclusion **{d['conclusion']}** at snapshot {SNAP}")
        out.append(tbl(["Workflow run", "Job", "Conclusion"], [[f"{nm} {rid}", j["name"], j["conclusion"] or j["status"]] for j in other]))
    return "\n".join(summ) + "\n\n" + "\n\n".join(out)
CI_MD = ci_tables()
CI_FAILS = {"Tests": "@civitasone/citizen-service#test (service-gaps-partial-routes, V4-INTEG-01) and @civitasone/web#test (auditResource, V4-CERT-02); 121 of 123 turbo tasks passed",
            "Architecture Guard": "tenant-table-rls-guard, flaky-skip-guard, authz-tenant-scanner (V4-CERT-03/04/05)",
            "Contract Tests": "cross-service-events contract: stale baseline entry + new orphan event (V4-CERT-06/07)",
            "Release Gate (evidence audit)": "L3 and L6 UNMEASURED (no evidence artifact), SLO UNMEASURED (no L7-k6-slo.json); L3 Schema Integrity, Coverage Gate, Integration Tests jobs were skipped because Tests failed (FINAL-GATE-02)",
            "Secret Scan": "gitleaks: leaks found 2 (generic-api-key) in services/queue-service/vitest.config.ts:10 and services/hrms-service/src/modules/leave/comp-off-authz.test.ts:32, values redacted (V4-CERT-17)"}

# ------------------------------------------------------------------ V4 registry markdown
def prs_s(r):
    p = ", ".join(f"#{x}" for x in r.get("originalPRs", [])) or "n/a"
    b = ", ".join(f"#{x} ({BUNDLE_SHA[x][:9]})" for x in r.get("bundles", [])) or "n/a"
    return p, b
def review_s(r):
    if not r.get("reviews"): return "none (certification-found or not reproduced)" if r["run"] != "V4" else "none recorded"
    return "; ".join(f"PR #{x['pr']} round {x['round']} head {str(x['head'])[:9]} -> {x['verdict']} ({x['at']}): " + re.sub(r"^\*+\s*Independent review.*?(CLEAN|CHANGES REQUESTED)(\s*\(correction\))?[\s*\-\u2014:]*", "", x["excerpt"], count=1)[:230] for x in r["reviews"])
def detail(r):
    p, b = prs_s(r)
    tests = ", ".join(f"`{t['path']}`" + ("" if t["at_sha"] else " (not at the SHA)") for t in r.get("testFiles", [])) or "none"
    out = [f"#### {r['id']} - {r['severity']} - {r['closureStatus']}",
        f"- Title: {r['title']}", f"- Severity: {r['severity']}" + (f" (discoverer said {r['severityAtDiscovery']})" if r.get("severityAtDiscovery") and r["severityAtDiscovery"] != r["severity"] else ""),
        f"- Component: {r['component']}", f"- Requirement: {r['requirement']}",
        f"- Reproduction evidence: {r['reproduction']}", f"- Root cause: {r['rootCause']}", f"- Corrective action: {r['correctiveAction']}",
        f"- Changed files: {cap(r.get('changedFiles', [])) or 'none'}", f"- Test cases: {tests}",
        f"- Verification result: {r['verification']}", f"- Independent reviewer decision: {review_s(r)}",
        f"- PR: original {p}; bundle {b}", f"- Merge commit SHA: " + (", ".join(m for m in r.get("mergeCommits", [])) or "n/a (not merged)"),
        f"- Closure status: {r['closureStatus']}" + (f" (duplicate of {r['duplicateOf']})" if r.get("duplicateOf") else ""),
        f"- Residual risk: {r['residualRisk']}"]
    if r.get("relatedDefects"): out.append("- Related: " + ", ".join(r["relatedDefects"]))
    return "\n".join(out)

GUARD = {  # class-level related CI guard / contract (not a claim that the guard catches this exact defect)
 "V4-B-03": "authz-tenant-scanner (webhook entries were baselined; now stale)", "V4-B-09": "authz-tenant-scanner (ai/prompt entry was baselined; now stale)",
 "V4-B-06": "tenant-table-rls-guard (FAILS on the new directory tables)", "V4-B-01": "tenant-table-rls-guard (new RLS table passes); web auditResource.test (FAILS, V4-CERT-02)",
 "V4-C-01": "tenant-index-guard + schema-drift-guard (PASS, db lane)", "V4-C-03": "tenant-index-guard + schema-drift-guard (PASS, db lane)",
 "V4-C-04": "closure3-s4-09 reference-sequence tests; schema-drift-guard", "V4-C-05": "schema-drift-guard",
 "V4-D-01": "cross-service-events contract (stale baseline entry finance.payment.file_decided, V4-CERT-06)", "V4-G-09": "cross-service-events contract (orphan citizen.refund.approved, V4-CERT-07)",
 "V4-G-01": "gateway public-prefixes contract tests (tests/contract/gateway.contract.test.ts)", "V4-E-06": "secret-scanner.mjs (PASS)", "V4-E-07": "secret-scanner.mjs (PASS)",
 "V4-E-03": "secret-scanner.mjs (PASS)", "V4-C-06": "packages/db perf tests (PASS)", "V4-F-04": "packages/db perf tests (PASS)",
}
def mapping_md():
    body = []
    for r in rows:
        if r["run"] == "V4" and r["closureStatus"] == "VERIFIED":
            body.append([r["id"], r["severity"], "; ".join(t["path"] + ("" if t["at_sha"] else " [absent at SHA]") for t in r["testFiles"]) or "none", GUARD.get(r["id"], "none identified (regression test is the only control)"), "PASS in regression gate 20a/20b"])
    return tbl(["Defect", "Sev", "Regression test(s)", "Related CI guard / contract", "Result"], body)

def registry_index():
    body = []
    for r in rows:
        if r["run"] in ("V4", "V4-CERT"):
            p, b = prs_s(r)
            body.append([r["id"], r["severity"], r["component"][:70], r["closureStatus"], p, b, ", ".join(m[:9] for m in r.get("mergeCommits", [])) or "n/a"])
    return tbl(["ID", "Sev", "Component", "Closure status", "Original PR", "Bundle", "Merge commit"], body)

def prior_table(run):
    body = [[r["id"], r["severity"], r["closureStatus"], r["component"][:60], r["title"][:90], r["verification"][:140]] for r in rows if r["run"] == run]
    return tbl(["ID", "Sev", "Status", "Component", "Title", "Basis"], body)

# ------------------------------------------------------------------ owner decisions
OWNER = """| Date | Decision | Wording | Status |
|---|---|---|---|
| 2026-10-25 | Credential rotation (Keycloak admin-cli client secret, dev-superadmin password, UAT demo password, all previously present in git history) | Owner, verbatim in chat: "continue with the current credentials ,no change" (source `~/orch-logs/closure/deferred-approval.md`) | ACCEPTED_RISK, not rotated, not a release blocker by owner decision |
| 2026-10-25 | Integration of V4 HIGH and BLOCKED_FOR_APPROVAL PRs | Orchestrator asked "may I merge the 16 high-severity fixes and the 14 protected-area fixes once they pass review?"; owner replied, verbatim: "close all by tomorrow morning" (source `deferred-approval.md`) | Approval to integrate after independent review CLEAN and CI gate; no review or gate step waived. Does not cover the new dependency in #2282 or any NOT_RUN gate |
| 2026-10-25 | Run 3 BLOCKED_FOR_APPROVAL items | Quoted in the #2279 PR body: "yes approved to fix all" | 29 findings fixed and merged in #2279 |
| 2026-10-25 | fastify / drizzle-orm / find-my-way major upgrades | Relayed by the orchestrator task for this certification (the owner's own wording is not in the logs this lane could read, so it is not quoted): deferred until after the outstanding tasks | DEFERRED; CVE exceptions expire 2026-11-08 (13 days after the certification date) |
| 2026-10-25 | zod 3.x | Relayed by the orchestrator task: exception accepted | Exception GHSA-mrhx-c7xc-m3w5 expires 2026-11-23 |
| 2026-10-25 | 27 coverage services and visual snapshots | Relayed by the orchestrator task: accepted deferrals | ACCEPTED_DEFERRAL; payroll visual-regression snapshots also accepted known-stale on 2026-10-23 22:10 IST (deferred-approval.md) |"""

# ------------------------------------------------------------------ section builders
HDR = lambda title: f"""{BEGIN}
## V4 certification refresh 2026-10-26 (frozen SHA `{SHA}`)

Scope: MASTER PROMPT V4.0 certification of the integrated main commit `{SHA}` ({S9}, the squash of bundle #2280; bundles #2279 `{BUNDLE_SHA[2279][:9]}` and #2281 `{BUNDLE_SHA[2281][:9]}` are ancestors). Discovery baseline was `1eaeecae7`. This section was written by the Release Certification Auditor on the existing PR #2172 branch `docs/final-closure-reports` after merging `origin/main` into it (no history rewrite). The certification lanes were read-only on code. Anything not executed is marked NOT_RUN; no gate is claimed that was not run or read from a recorded result.

**Release decision (V4): FAIL.** Detail in `release-readiness.md`. Earlier sections of this file are kept below unchanged as history.

"""
FTR = f"\n{END}\n"

def sec_defect_registry():
    verified = [r for r in rows if r["run"] == "V4" and r["closureStatus"] == "VERIFIED"]
    s = HDR("") + f"""### V4 consolidated defect table (computed)

Scope: {SC_V4C}

{sev_table(SC_V4C)}

V4 discovered defects only (V4-A..G):

{sev_table(SC_V4D)}

All runs (Run 1, Run 2, Run 3, V4, certification-found):

{sev_table(SC_ALL)}

{TABLE_NOTE}

Script: `quality-reports/final-closure/consolidate-defects.py` reads `v4-registry.json` (built by `v4-build-registry.py` from the lane/verify/remediation/cycle-2 JSON, the PR comments via `gh`, and the regression lane result) and writes `defect-summary.json`. Commands, exit codes, timestamps and hashes are in `evidence-manifest.json` under `v4_certification.commands`.

Rows by run: {json.dumps(SUM['byRun'])}

### V4 flow

58 defects were confirmed by seven discipline lanes (A-G) on `1eaeecae7`, each independently verified. 3 are duplicates (V4-E-04 of V4-A-03; V4-E-01 and V4-G-04 of V4-B-02), 1 is NOT_REPRODUCED (V4-B-05: `sanitationRoutes` is never registered), leaving 54 distinct defects. 47 fix PRs (#2235-#2278, plus cycle-2 #2282, #2283, #2284) were each independently reviewed (the last "Independent review (V4" comment on every PR is CLEAN), then bundled into #2280 (bundle A, merged {BUNDLE_SHA[2280][:9]}), #2281 (bundle B, shared packages, merged {BUNDLE_SHA[2281][:9]}) and, for V4-C-04 building/event, CLOS3-S4-09 in #2279 (merged {BUNDLE_SHA[2279][:9]}). The originals are CLOSED. Limitation: every one of the 63 review comments was posted from the single GitHub account `dbn1972`; the reviewers were separate agents but the account does not prove independence.

Closure rule applied: VERIFIED only if merged AND its regression test passed in the regression lane (and no lane contradicts it). {len(verified)} V4 defects meet it. V4-G-12 does not: a test file changed by its PR fails 10 of 38 tests at the frozen SHA (V4-INTEG-01), so it is UNRESOLVED. V4-D-03 and V4-D-04 failed in local parallel runs on emulated Postgres but passed in the serial regression lane and in GitHub CI, so they are VERIFIED with that conflict recorded (V4-CERT-01).

### V4 registry index

{registry_index()}

### Defect-to-control mapping (each VERIFIED V4 defect)

The "related CI guard" column names a class-level guard where one exists; it is not a claim that the guard would have caught this exact defect.

{mapping_md()}

### V4 defect detail (V4-A..G, then certification-found)

""" + "\n\n".join(detail(r) for r in rows if r["run"] == "V4") + "\n\n### Certification-found defects (V4-INTEG-01, V4-CERT-nn)\n\nSeverity for these rows is provisional, assigned by the Release Certification Auditor. None is fixed: the lane was read-only on code.\n\n" + "\n\n".join(detail(r) for r in rows if r["run"] == "V4-CERT") + f"""

### Earlier runs in the consolidated rows

Run 1 and Run 2 detail stays in the sections below. The rows are re-listed here so the counts above are reproducible; statuses are those of the 2026-10-24 refresh (not re-checked here), updated only where the frozen-SHA GitHub CI gives newer evidence (FINAL-E2E-01, FINAL-GATE-01) or the git log shows the fix landed (CLOS-S4-05 in #2279).

#### Run 1 ({SUM['byRun']['RUN1']['rows']} rows)

{prior_table('RUN1')}

#### Run 2 ({SUM['byRun']['RUN2']['rows']} rows)

{prior_table('RUN2')}

#### Run 3 ({SUM['byRun']['RUN3']['rows']} rows; first time listed in these reports; IDs `CLOS3-*`, sources `run3-discover-*.json`, `run3-pass2-*.json`, `run3-blocked-approved.json`)

Merged in #2227 (`96e536cf9`, 70 low/medium fixes) and #2279 (`{BUNDLE_SHA[2279][:9]}`, 29 owner-approved fixes). Two rows have no PASS 2 record and are UNRESOLVED (CLOS3-S1-15 Low, CLOS3-S3-13 Medium).

{prior_table('RUN3')}
""" + FTR
    return s

def sec_autonomous():
    rem = J(f"{V}/remediation-result.json")["result"]; c2 = J(f"{V}/cycle2-result.json")["result"]
    auto = {}
    for sl in rem:
        for p in sl["prs"]:
            if p["cls"] == "AUTO": auto[p["number"]] = (sl["slice"], p["defects"], p.get("round"))
    for x in c2:
        if x.get("cls") == "AUTO" and x.get("pr"): auto.setdefault(x["pr"], (x["id"], [x["id"]], 1))
    auto[2282] = ("visitor-ml cycle 2", ["V4-F-02"], 1)
    body = []
    for n, (sl, ds, rd) in sorted(auto.items()):
        did = [d for d in DPR_BY_PR.get(n, [])]
        body.append([f"#{n}", sl, ", ".join(did) or ", ".join(map(str, ds)), "#" + "/#".join(map(str, sorted({b for d in did for b in RID[d].get('bundles', [])}))) if did else "", rd])
    return HDR("") + f"""### V4 autonomous fixes

Autonomy rule for V4: AUTO_FIX defects (LOW/MEDIUM, no protected area) were fixed and reviewed without a separate owner ask; HIGH and BLOCKED_FOR_APPROVAL defects were fixed on branches and integrated only under the owner approval "close all by tomorrow morning" (see `deferred-approval-items.md`). {len(auto)} PRs were AUTO class. Each was reviewed by an independent agent (review comment CLEAN) and merged inside a bundle; the originals are closed.

{tbl(['PR', 'Slice', 'Defects', 'Bundle', 'Review round (CLEAN)'], body)}

Not autonomous even though small: #2282 (V4-F-02) adds the runtime dependency `@fastify/multipart` 8.3.1 with lockfile additions; the remediation lane had stated this needs owner approval, and no dependency-specific approval is recorded. Listed as an open approval-evidence item in `deferred-approval-items.md`.

Unfixed by the autonomous lane and later resolved by cycle 2: V4-A-07 (CreateTenderForm, #2236), V4-G-01 (#2283), V4-F-02 (#2282), V4-D-02 second half (#2258), V4-B-01 persistence (#2271), V4-B-03 (#2268), V4-C-04 parking/trade (#2284), V4-G-12 fixtures (#2246). Each has an Independent review comment; see `defect-registry.md`.

Not fixed: V4-B-05 (NOT_REPRODUCED; latent dead code), and every certification-found row (V4-INTEG-01, V4-CERT-01..17).
""" + FTR

def sec_baseline():
    gm = tbl(["Lane", "Gate / step", "Status", "Command (verbatim)", "Exit", "Start UTC", "End UTC", "Log", "sha256"],
             [[g[0], g[1], g[2], "`" + g[3].replace("`", "'") + "`" if g[3] else "", g[4], g[5], g[6], g[7], g[8]] for g in GATES])
    nr = tbl(["Lane", "Gate", "Status", "Reason"], NOTRUN)
    return HDR("") + f"""### V4 baseline and environment

- Frozen SHA: `{SHA}` (file `~/orch-logs/closure/v4/FROZEN_SHA`). Chain: discovery baseline `1eaeecae7` -> #2227 `96e536cf9` -> #2279 `{BUNDLE_SHA[2279][:9]}` -> #2281 `{BUNDLE_SHA[2281][:9]}` -> #2280 `{BUNDLE_SHA[2280][:9]}` (4 release commits, 685 files, 28 new migration files, no number collisions).
- Host: cloudsphere-ec2 aarch64, node v22.23.2 (host) / 22.23.4 (container), pnpm 9.0.0 (`cert/build.json`). DB tests ran on disposable `postgis/postgis:16-3.4` (amd64 emulated on an arm64 host, so timing-sensitive results can differ from CI) in private docker network namespaces, with redis:7-alpine, non-superuser service roles, `scripts/ci/bootstrap-postgres.sh` (exit 0). The shared dev Postgres (:5435) was not used for tests (one disclosed exception below).
- Lanes: build, db, contract-e2e, security-perf, regression (certification), after discovery lanes A-G, remediation (83 agents), cycle 2 (20 agents). Result files: `~/orch-logs/closure/v4/cert/{{build,db,contract-e2e,security-perf,regression}}.json`.
- Disclosure: during the contract-e2e lane one stray `psql` probe to the shared dev Postgres :5435 was attempted by mistake while checking port isolation; it failed password authentication and read nothing. No pushes, merges or code changes were made by any certification lane.
- Prior baseline (earlier refreshes) is retained below.

### V4 gate matrix (every executed step with command, exit code, UTC times, log, sha256)

Statuses are the lanes' own, except where the step is a diagnostic rerun or not relied on (marked). Lane summaries in `cert/*.json` are authoritative for the narrative; the rows below come from `build/results.tsv`, `contract-e2e/*.{{cmd,exit,start,end,sha}}`, `db.json`, `security-perf.json`, `regression.json`.

{gm}

### Gates not run

{nr}

### GitHub CI evidence for the frozen SHA (read-only, snapshot {SNAP}, query log `cert/reports/ci-run-*.json`)

This is executed evidence from GitHub, not from this host. Both runs ended with conclusion failure.

{CI_MD}

Failing jobs: """ + "; ".join(f"**{k}**: {v}" for k, v in CI_FAILS.items()) + FTR

def sec_regression():
    revert = [["PR #2241", "V4-G-03", "2"], ["PR #2238", "V4-E-02", "2"], ["PR #2244", "V4-G-06", "3"], ["PR #2240", "V4-B-02 / V4-G-04 / V4-E-01", "3"], ["PR #2246", "V4-G-12 (appeal-filing-integrity)", "8"],
              ["PR #2270", "V4-D-06", "3"], ["PR #2275", "V4-G-05", "6"], ["PR #2258", "V4-D-02", "2"], ["PR #2260", "V4-D-01", "4"], ["PR #2266", "V4-A-02", "4"]]
    reg_gates = [[x["gate"], x["status"], x.get("exitCode", ""), x["result"][:1500]] for x in J(f"{C}/regression.json")["gates"]]
    return HDR("") + f"""### V4 regression results (frozen SHA)

Regression lane (`cert/regression.json`, logs `~/orch-logs/closure/v4/cert/regression/`, per-log hashes `log-hashes.json`): DB tests on a disposable `postgis:16-3.4` on 127.0.0.1:55912, bootstrapped by `bootstrap-postgres.sh` (exit 0), reruns with the correct per-service DB and `--no-file-parallelism` are authoritative (earlier attempts kept in `attempt*/`).

{tbl(['Gate', 'Status', 'Exit', 'Result'], reg_gates)}

Cross-check by this auditor (command recorded as `xcheck-regression-logs`, log `cert/reports/xcheck-regression-logs.log`): grepping every regression log for failed Test Files/Tests finds only `services_citizen-service.log` (1 file failed, 10 tests failed) and `delta_services_citizen-service.log`; no other package log reports a failure.

Revert-proof (gate 20c): with the PR's non-test diff reverse-applied, the tests fail; on the SHA they pass. Caveat from the lane: PR2240 and PR2258 reversals delete a source file, so those failures may be import-resolution rather than assertion failures; 4 other HIGH diffs (#2242, #2261, #2262, #2252) did not reverse-apply cleanly, so their revert proof is not available from this lane (#2252 and others were shown to fail on origin/main by the reviewers in the PR comments).

{tbl(['PR', 'Defect', 'Tests failing when reverted'], revert)}

Other regression facts: 244 test files added or modified between `1eaeecae7` and the SHA (55 packages) ran serially: 242 of 243 collected files, 2533 tests pass; the only failure is `services/citizen-service/tests/service-gaps-partial-routes.test.ts` (V4-INTEG-01). apps/web: 12 V4 files and 61 delta files pass. `tsc --noEmit` exits 0 in all 55 changed services and packages. No conflict markers; no migration-number collision.

Full-suite results outside the regression lane (build/db/contract lanes and GitHub CI): see `release-readiness.md`. Summary of red results at the frozen SHA: citizen-service (10 tests, confirmed in GitHub CI), web auditResource (1 test, confirmed in GitHub CI), three architecture guards, cross-service-events contract (2 tests), tests/data-integrity (7), tests/cross-service (5), tests/cross-service-live payroll-posting-history (2), tests/security (1 deterministic), analytics-service (1, local only), grant-service (4 local only, passes in GitHub CI), finance pfms-adapter (12, unmigrated test DB, not rerun).

### Per-defect regression evidence

{mapping_md()}
""" + FTR

SECDEF = ["V4-A-01","V4-A-02","V4-A-03","V4-A-04","V4-B-01","V4-B-02","V4-B-03","V4-B-04","V4-B-06","V4-B-07","V4-B-09","V4-B-10","V4-C-02","V4-E-02","V4-E-03","V4-E-05","V4-E-06","V4-E-07","V4-G-01","V4-G-02","V4-G-03","V4-G-05","V4-G-06","V4-G-08"]
def sec_security():
    sd = tbl(["Defect", "Sev", "Status", "Title", "Control"], [[i, RID[i]["severity"], RID[i]["closureStatus"], RID[i]["title"][:150], RID[i]["testFiles"][0]["path"] if RID[i]["testFiles"] else ""] for i in SECDEF])
    cves = ["fastify x5 (GHSA-jx2c-rxcm-jvmq, 667r-xxjv-c9mm, p68q-wchp-6fh7, hwr6-493r-vm6h, 9q9j-q6p8-xq58)", "drizzle-orm gpj5-g38j-94v9", "find-my-way c96f-x56v-gq3h", "extract-zip x2 (jmr9-qjv8-65gv, 7pqw-9j4j-h8q3)", "node-forge 86w9-cpqp-85rv"]
    return HDR("") + f"""### V4 security findings

#### Security defects fixed in V4 (executed evidence: regression lane PASS unless noted)

{sd}

All of the above are merged in #2280/#2281. HIGH items: V4-A-01 (service-worker cache not purged on logout), V4-A-02 (CSP blocked presigned uploads, availability), V4-B-02 (citizen document ownership), V4-G-01..G-03, G-05, G-06, G-08, V4-E-02 (citizen requests list leaked all citizens). V4-E-03 and V4-E-05 are auth/contract boundary changes approved under "close all by tomorrow morning". Open security-relevant follow-ups from certification: V4-CERT-03 (RLS on new public directory tables), V4-CERT-10 (BYPASSRLS roles), V4-CERT-11 (plaintext PII), V4-CERT-17 (gitleaks), V4-CERT-15/16 (scanner alerts).

#### Dependency scan (gate 14, `node scripts/ci/cve-audit-gate.mjs`, exit 0, 2026-10-26T02:21:48Z to 02:24:57Z, log sha256 prefix d297a60c6819)

PASS_WITH_KNOWN: 0 unallow-listed CRITICAL/HIGH; 11 allow-listed exceptions. 10 expire **2026-11-08** (13 days after certification): {', '.join(cves)}. zod GHSA-mrhx-c7xc-m3w5 expires **2026-11-23** (28 days). Owner decisions: fastify/drizzle-orm/find-my-way major upgrades deferred until after the outstanding tasks; zod 3.x exception accepted (see `deferred-approval-items.md`). These exceptions are time-boxed: if the deferred upgrades are not done by 2026-11-08 the gate will fail.

#### Secret scanning

- Local: `scripts/ci/secret-scanner.mjs` exit 0 and the `ci.yml` secret-scan grep patterns clean (build lane, 2026-10-26T03:02:57Z to 03:03:03Z). gitleaks was not installed on the host (NOT_RUN locally).
- GitHub Security Scan run 40258410829, job Secret Scan (gitleaks-action): **FAILED**, 2 `generic-api-key` findings in the frozen-SHA commit (`services/queue-service/vitest.config.ts:10`, `services/hrms-service/src/modules/leave/comp-off-authz.test.ts:32`; values redacted and not reproduced in these reports). Tracked as V4-CERT-17. The GitHub CI run's own Secret Scan job (grep patterns) succeeded.
- This certification's reports contain no secret literals (checked with the `ci.yml` patterns and `secret-scanner.mjs`, commands recorded in the evidence manifest).

#### Code scanning and container scanning

`gh api code-scanning/alerts?state=open&ref=refs/heads/main`: **2421 open alerts**, none from the frozen SHA (older SHAs `96e536cf9`, `e845c0401`): CodeQL 2 critical / 68 high / 14 medium / 34 warning / 1561 note; Trivy 3 critical / 177 high. High CodeQL rules include js/missing-rate-limiting, js/path-injection, js/request-forgery, js/insufficient-password-hash (gateway `api-key-auth.ts`), js/disabling-certificate-validation; Trivy findings are mostly image CVEs on hrms/finance/gateway, plus node-forge CVE-2026-85393 and uuid CVE-2026-41907 (evidence `cert/security-perf/codeql-all.json`). Not triaged: V4-CERT-15 (CRITICAL) and V4-CERT-16 (HIGH) are UNRESOLVED. The GitHub Security Scan jobs for the frozen SHA (CodeQL SAST, Trivy hrms/gateway/finance, CVE/SCA gate, Dependency Audit, ZAP DAST baseline) all completed success; a successful scan job is not the same as zero alerts.

#### Tenant isolation and data protection (tests not run by the ci.yml test job)

- `tests/data-integrity`: 7 failed / 19 passed. Roles `citizen_svc`, `legal_svc`, `telephony_svc` carry BYPASSRLS in the bootstrapped DB, which makes RLS inert for those services (V4-CERT-10, HIGH, cause not triaged: bootstrap-only or production-like is unknown). Plaintext PII at rest: `telephony.calls.caller_number/callee_number`, `citizen portal.citizen_profiles.mobile` (V4-CERT-11).
- `tests/security`: IDOR/RLS-GUC suite 3 failed on run 1 and 1 on rerun. Two of the first-run failures were 5000 ms timeouts on emulated PG; the deterministic failure is a stale sanity test (V4-CERT-09).
- `tenant-table-rls-guard` FAILS for `adv_permit_directory` and `building_permit_directory` (V4-CERT-03).

#### Accepted risk

Credentials present in git history (Keycloak admin-cli client secret, dev-superadmin password, UAT demo password): owner decision "continue with the current credentials ,no change". ACCEPTED_RISK, not rotated. Residual risk: anyone with repo history access holds working non-production-looking credentials; rotating was explicitly declined.

#### Review limitation and disclosure

All 63 independent-review comments (on the 47 fix PRs, counted from the PR comments by `gh`) were posted from one GitHub account (`dbn1972`). One stray, failed `psql` probe to the shared dev Postgres occurred in the contract-e2e lane (nothing read).
""" + FTR

def sec_deferred():
    pend = tbl(["ID", "Sev", "Run", "Status"], [[p["id"], p["severity"], p["run"], "BLOCKED_FOR_APPROVAL"] for p in SUM["approvalPending"]])
    nr = [n for n in NOTRUN]
    return HDR("") + f"""### V4 deferred and approval items

#### Owner decisions recorded for this cycle

{OWNER}

#### Approval status (computed)

BLOCKED_FOR_APPROVAL rows across all runs: {len(SUM['approvalPending'])}; V4 cycle rows awaiting approval: 0 (all V4 HIGH/BLOCKED PRs were integrated under "close all by tomorrow morning"). The pending rows are carried over from earlier runs, unchanged and not re-checked in V4 certification:

{pend}

#### Open approval-evidence items (not decided by the owner in any record this lane could read)

1. **#2282 / V4-F-02 new runtime dependency** `@fastify/multipart` 8.3.1 (exact pin; lockfile additions: multipart, busboy, deepmerge, error, stream-wormhole). The remediation lane marked it as needing owner approval; the PR carries no APPROVAL REQUIRED tag; the blanket approval covers HIGH and BLOCKED_FOR_APPROVAL PRs only. Needs an explicit owner acknowledgement or removal.
2. **Gate waivers**: none recorded. Every NOT_RUN mandatory gate below therefore has no owner deferral: gateway SEC-021 real-subprocess test, performance/load (gate 17), local Playwright/journey E2E, local live-stack contract score, local gitleaks, local Trivy, mobile tests, LocalStack cross-process, Keycloak e2e. (GitHub CI executed E2E, Live Stack Verification, Trivy and mobile jobs for the SHA and they succeeded; see `release-readiness.md`.)
3. **Time-boxed exceptions**: 10 CVE exceptions expire 2026-11-08; zod 2026-11-23.
4. **Decisions needed on certification findings**: whether `adv_permit_directory`/`building_permit_directory` get RLS or a justified baseline (V4-CERT-03); whether the two gitleaks findings are fake test values (V4-CERT-17); production role attributes (V4-CERT-10); triage policy for 5 critical / 245 high scanner alerts (V4-CERT-15/16).
5. **Deferred feature work from V4 notes**: none outstanding after cycle 2 (V4-A-07 tender, V4-D-02 second half, V4-B-01 persistence, V4-G-01, V4-F-02, V4-C-04 rest, V4-B-03 were all completed in cycle 2).

#### Not-run gates (no owner deferral)

{tbl(['Lane', 'Gate', 'Status', 'Reason'], nr)}
""" + FTR

def sec_release():
    sev = SUM["tables"][SC_V4C]
    fails = [
     ("Gate 4 unit/service tests", "FAIL", "build lane 118/123 tasks; GitHub CI Tests job failed (citizen-service#test, web#test)", "cert/build.json; ci-run-40258410831.json"),
     ("Gate 5/9 service suites with DB", "FAIL", "63/67 green locally; analytics, audit (flaky), citizen, grant red locally; citizen red in CI", "cert/db.json"),
     ("Gate 6a contract tests", "FAIL", "cross-service-events 2 failures (confirmed in CI)", "cert/contract-e2e.json"),
     ("Gate 11 tenant isolation/IDOR/RLS tests", "FAIL", "tests/security idor-inventory deterministic failure", "cert/db.json"),
     ("Gate 12 cross-service flows (tests/cross-service)", "FAIL", "5 failed / 9 passed", "cert/db.json"),
     ("Gate 13 DB integrity (tests/data-integrity)", "FAIL", "7 failed / 19 passed, BYPASSRLS roles + PII at rest", "cert/db.json"),
     ("Gate 14 Architecture Guard", "FAIL", "tenant-table-rls-guard, flaky-skip-guard, authz-tenant-scanner (confirmed in CI)", "cert/build.json; CI Architecture Guard"),
     ("Gate 14 gitleaks (CI)", "FAIL", "2 findings in the frozen-SHA commit; not runnable locally", "job-121365184496.log"),
     ("Gate 15b open code-scanning alerts", "FAIL", "5 critical / 245 high open on main, untriaged", "cert/security-perf/codeql-all.json"),
     ("Gate 18 recovery/resilience", "FAIL (unverified)", "root 91/91, circuit-breaker 18/18, billing adapters 37/37 pass; finance pfms-adapter 12/28 failed on an unmigrated test DB and was NOT rerun; lane called it PASS_WITH_KNOWN but no owner deferral covers it, so it cannot be PASS", "cert/security-perf.json"),
     ("Gate 19 cross-service-live", "FAIL", "payroll-posting-history 2 tests deterministic", "cert/contract-e2e/xs.log, xs2.log"),
     ("Gate 20 regression", "FAIL", "citizen-service service-gaps-partial-routes 10/38 red (V4-INTEG-01)", "cert/regression.json"),
     ("Release Gate (evidence audit, CI)", "FAIL", "L3, L6 and SLO UNMEASURED", "job-121392646315.log"),
    ]
    passes = [
     ("Gate 1 install --frozen-lockfile", "PASS", "exit 0", "cert/build/g1-install.log"),
     ("Gate 2 turbo build, web tsc, web next build", "PASS", "99/99 tasks; tsc empty; next build ok", "cert/build"),
     ("Gate 3 forced typecheck, forced lint, jsx-a11y ratchet", "PASS", "0 lint errors (warnings only)", "cert/build"),
     ("Gate 14 other architecture guards (18+) and guard unit tests", "PASS", "exit 0", "cert/build/a01..b-*"),
     ("Gate 14 secret scan (repo scripts)", "PASS", "secret-scanner.mjs and ci.yml grep clean", "cert/build/s01, s02"),
     ("Gate 14 dependency scan", "PASS_WITH_KNOWN", "0 unallow-listed HIGH/CRITICAL; 11 allow-listed, 10 expire 2026-11-08, zod 2026-11-23; owner deferral recorded", "cert/security-perf/cve-gate.log"),
     ("Gate 16 bootstrap-postgres, tenant-index-guard, schema-drift-guard", "PASS", "0 migration failures, 8 baselined drifts, no new", "cert/db.json"),
     ("Gate 12 root integration + eOffice loop-back", "PASS", "133 passed, 9 skipped (LocalStack)", "cert/db.json"),
     ("Gate 6b remaining contract files; 19c module-gating-standalone", "PASS", "45 tests; 10/10", "cert/contract-e2e.json"),
    ]
    ci_only = [
     ("Gate 8 Playwright E2E", "NOT_RUN locally; CI job E2E (Playwright) success; Procurement E2E Gate success"),
     ("Gate 7 live-stack contract score 10/10", "NOT_RUN locally; CI job Live Stack Verification success"),
     ("Gate 15 Trivy container scan", "NOT_RUN locally; CI Trivy jobs (hrms, gateway, finance) success"),
     ("Mobile (Flutter) tests", "NOT_RUN locally; CI job Mobile (Flutter) success"),
     ("Accessibility axe, Mutation, Screen Verification, QA Readiness, L10/L11, ZAP DAST, CodeQL SAST job, CVE/SCA gate", "executed only in GitHub CI; jobs success"),
    ]
    still_nr = [n for n in NOTRUN if n[1].split()[0] in ("4b", "17", "6c", "20e") or "LocalStack" in n[1] or "journey" in n[1]]
    return HDR("") + f"""### V4 release decision

**DECISION: FAIL**

Rules applied (V4): PASS only if every mandatory gate PASSes (PASS_WITH_KNOWN only for owner-accepted deferrals), evidence is complete, approvals are satisfied and no release-blocking defect is open. A NOT_RUN mandatory gate without an owner deferral gives BLOCKED. A failing gate or an open HIGH/CRITICAL defect gives FAIL. FAIL outranks BLOCKED here because gates fail and HIGH/CRITICAL defects are open; the NOT_RUN gates would on their own have forced BLOCKED. Nothing was rounded up.

### Consolidated defect table (V4 cycle, computed by `consolidate-defects.py`)

{sev_table(SC_V4C)}

{TABLE_NOTE}

### Why FAIL (each item has evidence)

{tbl(['Gate / condition', 'Result', 'Detail', 'Evidence'], [list(x) for x in fails])}

### Open HIGH / CRITICAL defects

{tbl(['ID', 'Sev', 'Run', 'Status', 'Title'], [[d['id'], d['severity'], d['run'], d['status'], d['title'][:110]] for d in SUM['openHighCritical']])}

### Gates that passed

{tbl(['Gate', 'Result', 'Detail', 'Evidence'], [list(x) for x in passes])}

### Gates executed only by GitHub CI (not run on the certification host)

These are recorded from the GitHub run record (snapshot {SNAP}); this lane did not execute them.

{tbl(['Gate', 'Status'], [list(x) for x in ci_only])}

The GitHub CI run (`40258410831`) for the frozen SHA ended **failure**; the Docker image matrix jobs succeeded. Job table in `baseline-assessment.md`.

### NOT_RUN with no owner deferral

{tbl(['Lane', 'Gate', 'Status', 'Reason'], [list(x) for x in NOTRUN])}

### Approvals and evidence completeness

- V4 HIGH and BLOCKED_FOR_APPROVAL PRs: approved ("close all by tomorrow morning"), reviewed CLEAN. Not covered: the new dependency in #2282; every NOT_RUN gate.
- Awaiting approval from earlier runs: {len(SUM['approvalPending'])} rows (listed in `deferred-approval-items.md`).
- Evidence incomplete: SEC-021 spawn test, perf/load, local E2E/journey/mobile/LocalStack/Keycloak, finance pfms-adapter rerun, render-smoke locally.
- Environment caveat: tests ran on amd64-emulated Postgres; some local-only failures (grant-service, analytics-service, IDOR timeouts) did not reproduce in GitHub CI or on rerun and are recorded as LOW/environmental, not dismissed.

### What would change the decision

Clear V4-INTEG-01, V4-CERT-02..07 (small test/baseline fixes); resolve or formally triage V4-CERT-10, V4-CERT-15, V4-CERT-16, FINAL-GATE-02 (Release Gate L3/L6/SLO evidence); resolve V4-CERT-17 gitleaks; run or have the owner defer the NOT_RUN gates; record the approval for the #2282 dependency and decide the 6 pending earlier-run approvals; rerun finance pfms-adapter on a migrated DB. Then recertify a new frozen SHA: this decision applies to `{SHA}` only.

### Residual risk accepted by the owner (does not change the decision)

Credentials in git history (not rotated); CVE exceptions until 2026-11-08 / 2026-11-23; payroll visual snapshots stale; 27 coverage services and visual snapshots deferred.
""" + FTR

SECTIONS = {
 "defect-registry.md": sec_defect_registry, "autonomous-fixes.md": sec_autonomous, "baseline-assessment.md": sec_baseline,
 "regression-results.md": sec_regression, "security-findings.md": sec_security, "deferred-approval-items.md": sec_deferred, "release-readiness.md": sec_release,
}
DPR_BY_PR = collections.defaultdict(list)
for r in rows:
    if r["run"] == "V4":
        for p in r.get("originalPRs", []):
            DPR_BY_PR[p].append(r["id"])

def apply(fn, block):
    p = os.path.join(OUTD, fn); txt = open(p).read()
    if BEGIN in txt:
        a = txt.index(BEGIN); b = txt.index(END) + len(END)
        txt = txt[:a].rstrip("\n") + "\n\n" + txt[b:].lstrip("\n")
    lines = txt.split("\n", 1); head, rest = lines[0], (lines[1] if len(lines) > 1 else "")
    txt = head + "\n\n" + block.strip("\n") + "\n\n" + rest.lstrip("\n")
    open(p, "w").write(txt)

for fn, f in SECTIONS.items():
    apply(fn, f())

# ------------------------------------------------------------------ evidence manifest
mp = os.path.join(OUTD, "evidence-manifest.json"); man = J(mp)
cmds = []
for ln in open(f"{R}/results.tsv"):
    f = ln.rstrip("\n").split("\t")
    if len(f) >= 7: cmds.append({"name": f[0], "exitCode": f[1], "startedUtc": f[2], "endedUtc": f[3], "log": f[4], "sha256": f[5], "command": f[6]})
srcs = {}
for p in sorted(glob.glob(f"{V}/*.json") + glob.glob(f"{C}/*.json") + [f"{L}/deferred-approval.md", f"{L}/owner-questions-decided.md", f"{V}/FROZEN_SHA"]):
    srcs[p.replace(os.path.expanduser("~"), "~")] = sha256(p)
prs = {}
for n in sorted(set(list(range(2235, 2285)) + [2279, 2280, 2281])):
    d = J(f"{R}/pr-{n}.json")
    prs[str(n)] = {"state": d["state"], "mergeCommit": (d["mergeCommit"] or {}).get("oid"), "title": d["title"]}
ci = {}
for rid in (40258410829, 40258410831):
    d = J(f"{R}/ci-run-{rid}.json"); ci[str(rid)] = {"conclusion": d["conclusion"], "snapshotUtc": SNAP, "jobs": {j["name"]: (j["conclusion"] or j["status"]) for j in d["jobs"]}}
man["v4_certification"] = {
  "generatedUtc": SNAP, "decision": "FAIL", "frozenSha": SHA, "dbPath": "disposable postgis/postgis:16-3.4 (amd64 emulated), private docker netns; shared dev PG not used",
  "bundles": {k: v for k, v in BUNDLE_SHA.items()}, "consolidated": SUM["tables"], "byRun": SUM["byRun"], "excludedFromFound": SUM["excluded"],
  "openHighCritical": SUM["openHighCritical"], "approvalPending": SUM["approvalPending"],
  "scripts": ["quality-reports/final-closure/v4-build-registry.py", "quality-reports/final-closure/consolidate-defects.py", "quality-reports/final-closure/v4-gen-reports.py"],
  "registry": "quality-reports/final-closure/v4-registry.json", "registrySha256": sha256(f"{OUTD}/v4-registry.json"),
  "commands": cmds, "gates": [dict(zip(["lane", "gate", "status", "command", "exit", "startedUtc", "endedUtc", "log", "sha256"], g)) for g in GATES],
  "notRun": [dict(zip(["lane", "gate", "status", "reason"], g)) for g in NOTRUN],
  "githubCi": ci, "sourceFileHashes": srcs, "pullRequests": prs,
  "ownerDecisions": [{"date": "2026-10-25", "id": "credentials", "verbatim": "continue with the current credentials ,no change", "status": "ACCEPTED_RISK"},
                     {"date": "2026-10-25", "id": "high-blocked-integration", "verbatim": "close all by tomorrow morning", "status": "APPROVED_FOR_INTEGRATION_AFTER_REVIEW"},
                     {"date": "2026-10-25", "id": "fastify-drizzle-find-my-way-majors", "verbatim": None, "note": "relayed by orchestrator task; deferred until after outstanding tasks; exceptions expire 2026-11-08", "status": "DEFERRED"},
                     {"date": "2026-10-25", "id": "zod-3x", "verbatim": None, "note": "relayed by orchestrator task; exception expires 2026-11-23", "status": "ACCEPTED_DEFERRAL"},
                     {"date": "2026-10-25", "id": "coverage-and-visual", "verbatim": None, "note": "relayed by orchestrator task: 27 coverage services + visual snapshots accepted deferrals", "status": "ACCEPTED_DEFERRAL"}],
}
json.dump(man, open(mp, "w"), indent=2)
print("ok", {fn: os.path.getsize(os.path.join(OUTD, fn)) for fn in list(SECTIONS) + ["evidence-manifest.json"]})
