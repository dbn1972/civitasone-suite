# Workflow Prompt — Release Gate

**Use when:** Sprint end. Runs automatically via GitHub Action on the `release-candidate-{{sprint}}` tag.

---

## Inputs

```
SPRINT: {{N}}
RELEASE TAG: release-candidate-sprint-{{N}}
PREVIOUS RELEASE TAG: release-candidate-sprint-{{N-1}}
COMMIT RANGE: {{prev}}..{{current}}
PRS MERGED THIS SPRINT: {{list with titles and authors}}
```

---

## Checks (Claude runs each, produces a report)

### 1. Schema changes (per service)

For each service touched, list:
- New tables (with prefix verified)
- Altered tables
- New indexes
- New RLS policies
- Migration count and reversibility status

### 2. API contract changes

- New endpoints with method + path + auth requirement + permission key
- Removed endpoints (BLOCKER if any consumer still references them)
- Breaking changes to existing endpoints (BLOCKER)
- New error codes registered

### 3. Event contract changes

- New events emitted (with payload schema)
- New consumers added (subscribed to which events)
- Removed events (BLOCKER if any consumer still subscribed)
- Schema-version bumps

### 4. Permission changes

- New permission keys added to policy-service
- Removed permissions (BLOCKER if any code still references)
- Role-permission mapping changes

### 5. Test coverage delta

- Per-service coverage before and after
- Net change in coverage % (warning if regressed by >2%)
- Untested files in this sprint's diff

### 6. Security scan results

- Semgrep findings (HIGH/CRITICAL count) — must be 0
- Trivy container scan (HIGH/CRITICAL) — must be 0
- npm audit (HIGH/CRITICAL) — must be 0
- OWASP ZAP findings (HIGH) — must be 0

### 7. Performance benchmarks

- p95 latency per critical endpoint (per Vol 13 SLOs)
- Throughput on key write paths (target 1,000 TPS)
- Cache hit ratio on read paths (target ≥80%)
- Regressions vs previous sprint (warning if >10% slower)

### 8. Bundle / artefact size

- web/.next bundle size delta
- Per-service Docker image size delta
- Flutter APK / IPA size delta

### 9. Documentation

- API reference auto-generated (verify pipeline ran green)
- Changelog entries present for every merged PR
- Runbooks updated for new ops surface (BLOCKER if new service / new alert without runbook)

### 10. Enterprise Readiness Score delta

- Previous score
- Current score on reference deploy
- Categories that changed (with reason)
- BLOCKER if score regressed
- WARN if score < 85 and sprint is post-Sprint 3

### 11. Definition of Done compliance (Vol 6)

- Every story closed has: tests, docs, telemetry, runbook entry, security review, a11y review
- Stories without all criteria → list for follow-up

### 12. Edition matrix (Vol 1 + MASTER_BUILD_BRIEF.md §23)

- Verify every new feature is correctly gated per edition (Small Office / PSU / Govt)
- No code fork per edition (BLOCKER if found)

---

## Output format

```
SPRINT {{N}} RELEASE REPORT — {{date}}

GATE STATUS: PASS | FAIL

If FAIL — BLOCKERS:
1. {{description}} (owner: {{name}})
2. ...

SUMMARY:
- PRs merged: {{count}}
- New endpoints: {{count}}
- New events: {{count}}
- New permissions: {{count}}
- Schema migrations: {{count}}
- Coverage delta: {{±X%}}
- Readiness score: {{before}} → {{after}}
- p95 latency delta: {{summary}}

DETAILS:
[full output of each section 1–12]

NEXT SPRINT ACTIONS:
- {{actionable follow-ups}}
```

If GATE STATUS = PASS → proceed to release. If FAIL → release blocked, fixes required in patch sprint before promotion.
