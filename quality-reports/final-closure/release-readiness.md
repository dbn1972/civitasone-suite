# Release readiness

## Decision

**FAIL.** This is the PASS 4 independent verifier's decision, reproduced unchanged. Nothing in this report overrides it.

## Executed evidence (what was actually run)

- Integration `closure/pass3-integration` @ `cca1ae6461f162b636bdc4321969c5e9419e530d` (draft #2171, 16 PRs; #2161 excluded for conflicts).
- Green locally: install, typecheck (126/126), lint (0 errors, warnings only), `pnpm test:contract` (148 passed, 1 skipped), web build (485s), 20 of 31 guards (incl. bundle-size on rerun).
- Red locally: web vitest (1 failure, `auditResource.test.ts`, also red on origin/main), `raw-status-leak-guard` (1 NEW violation, #2166), baseline-failing guards (money-precision 151, secret-scanner 71, sql-injection 24, package-exports 10, same as baseline), 7 service suites (audit, gateway, helpdesk, identity, inventory, visitor, workflow; 19 services green).
- CI on #2171: red Architecture Guard, CVE / SCA Gate, CodeQL, E2E (Playwright), Tests, 3x Trivy container scan; 17 jobs green; 6 skipped.
- PASS 4 verifier re-ran `raw-status-leak-guard` (fails) and `auditResource.test.ts` (fails), and ran four test files plus auditResource (54/55 pass).

## Release blockers (from the verifier's list)

1. Architecture Guard failure: raw `res.status` in the thrown Error at `apps/web/src/app/(app)/workflow/_components/DocVerificationChecklist.tsx:65` (#2166, commit `6f98bca86`). Route it through `useFormError` or add a `status-leak-ok` suppression.
2. E2E `hrms-payroll/payroll-runs.spec.ts:28` expects a /pending/ tile that #2159 removed; five visual-regression snapshots (Payroll Runs List, Run Detail paid and draft, Empty payroll, Run not found) not regenerated.
3. E2E `plugins.spec.ts`: three tests fail because `/plugins/installed` now reads `GET /api/v1/plugins` (#2152) and `apps/web/e2e/global-setup.ts` does not mock it.
4. CVE-2026-94482 (Next.js App Router DoS) fails CVE / SCA and Trivy. Upgrade pending owner approval.
5. DELEG-REVOKE-OWNERSHIP (High): any workflow_user can revoke or list any delegation. Pending owner approval.
6. Web vitest 'auditResource covers every resource type the services emit' (missing `medical_employee_record`) is red on main and on the integration. Add the type to `HR_AUDIT_RESOURCE_TYPES` (from #2150).
7. Mandatory gates with no evidence: Coverage Gate, Integration Tests, Live Stack Verification, Schema Integrity (L3) were skipped; schema-drift-guard and tenant-index-guard were not evaluated.
8. Seven service suites red locally: audit, gateway, helpdesk, identity, inventory, visitor, workflow. Five of them (gateway, helpdesk, identity, visitor, workflow) fail the same way on origin/main.

Additional verifier findings: CLOS-FLAKY-DRAINAGE (Medium) unapproved; #2161's defects are not closed because it is excluded; the ml-insights test rewrite is a behaviour change, not a clean low-risk test fix; the spot-check requirement for FIXED defects is not met (8 distinct FIXED defects had no regression test run by the verifier; per-defect diffs not read).

## Status of this run's own work (executed facts)

- 39 LOW defects fixed with regression tests: 14 merged to main (#2155, #2157), 25 in open PRs (#2154, #2165, #2169, #2170) plus 9 flaky-test fixes in #2167. None is marked VERIFIED.
- 7 defects plus 4 other items are BLOCKED awaiting owner approval (`deferred-approval-items.md`).
- Seven security PRs merged during the run (`security-findings.md`).
- Loop bounds: PASS 1 to PASS 4 completed once; no correction cycles beyond the first are recorded in the sources I was given.

## Analysis (not executed evidence)

- Most red CI jobs are baseline/environmental per PASS 3 (CVE, auditResource, 19 E2E specs red on main), but that does not make them acceptable for release: a release candidate needs these gates green or explicitly waived by the owner.
- Four regressions are attributable to the integration (#2166, #2159 x2, #2152) and have small obvious fixes, which would be low-risk under the brief; they were not fixed because the bounded loop ended at PASS 4.
- Skipped gates are a larger risk than the failures: until Tests is green, Coverage Gate, Integration Tests, Live Stack Verification and Schema Integrity do not run, so correctness of the DB-touching changes (migrations 0038, 0039, 0046) in integration is unproven in CI.

## Recommendations (not executed)

1. Fix, in one small PR each or one bundle: DocVerificationChecklist raw status; add `medical_employee_record`; regenerate the five payroll snapshots and update the payroll KPI spec; mock `GET /api/v1/plugins` in e2e global-setup.
2. Decide the Next.js CVE upgrade and DELEG-REVOKE-OWNERSHIP (owner approval).
3. Re-run CI on the integration (or on main after merging) so the skipped gates execute; run schema-drift-guard and tenant-index-guard against a bootstrapped disposable DB.
4. Resolve the #2161 conflicts and reintegrate it before any release candidate.
5. Have a verifier run regression tests for all 39 fixes and mark VERIFIED where they pass.
6. Re-run the final verification after the above; the current FAIL stands until then.
