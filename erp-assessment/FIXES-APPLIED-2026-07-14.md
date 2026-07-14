# CivitasOne — P0/P1 Fixes Applied (2026-07-14)

**Author:** Claude · **Branch/target:** `main` · **Worktree:** `/tmp/cms-wt`
**Scope:** the discrete, high-certainty P0/P1 tickets from `TICKETS-FOR-KIRO.md` (the ERP Testing Board defect register). All fixes were verified against live code first, ship with a proving test, and were pushed to `main` one logical wave per commit (the shared worktree auto-`git reset --hard`s). Kiro retains the larger service-failure and integration tickets.

## Commits
| Commit | Wave | Tickets |
|---|---|---|
| `88978a2` | P0-1 | PAY-DEF01, BL-03, SEC-P1-06, SEC-P1-01 |
| `0152f12` | P0-2 | SEC-P0-03 (plugin RCE) |
| `27dd130` | P1 | NOTIF-CRASH, SEC-P1-09, INV-MIGRATIONS |
| `6885184` | tests | coverage top-up (sandbox, payslip ownership) |

## Fixes, with evidence

### PAY-DEF01 — EPFO ECR pensionable wage `(88978a2)`
- **Was:** ECR EPF/EPS/EDLI wage columns used `basicMinor` only → for a 7th-CPC employee (basic 12,000 + DA 5,000) the challan showed 12,000 vs the correct 15,000 → EPFO portal rejects the challan.
- **Now:** new `ecr-domain.ts` `computePensionableWage(basic, da) = min(basic + DA, 15,000)`; DA is summed from the slip's `components` (no dedicated DA column). `ecr-routes.ts` calls it.
- **Tests/coverage:** `ecr-pensionable-wage.test.ts` 5/5 independent-oracle cases; **ecr-domain.ts 100% (stmt/branch/func/line)**.

### BL-03 — salary GL settlement never posted `(88978a2)`
- **Was:** finance GL consumer subscribed to `payroll.run.finalized` — a topic **no service emits**; payroll emits `payroll.run.disbursed`. The net-payable liability never cleared to bank.
- **Now:** finance consumes `payroll.run.disbursed` and posts the settlement journal `Dr net-payable / Cr bank` (env-configurable heads `PAYROLL_GL_NET_PAYABLE_HEAD` / `PAYROLL_GL_BANK_HEAD`, default 2101/1101). Deterministic journal id → idempotent on redelivery; zero-net runs no-op; unknown head → `finance.gl.rejected`.
- **Tests:** `payroll-settlement.test.ts` 4/4, **stash-proven** (3/4 fail on old code — the exact defect signature); 3 branches (post / zero-net / rejected) covered.

### SEC-P1-06 — pensioner PAN/bank plaintext `(88978a2)`
- **Was:** `POST /v1/payroll/pensioners` inserted via raw `` sql`…` `` — bypassing the `encryptedText` (AES-256-GCM) Drizzle transform → PAN + bank account stored in plaintext (DPDP violation).
- **Now:** insert via the `payrollPensioners` Drizzle table so `bank_account_no`/`bank_ifsc`/`pan` are encrypted at rest.

### SEC-P1-01 — payslip PDF IDOR `(88978a2, 6885184)`
- **Was:** `GET /v1/payroll/slips/:id/pdf` allowed the `employee` role with no ownership check → any employee could download any co-worker's payslip (gross/net/PAN/IFSC/UAN) by iterating slip ids.
- **Now:** route calls `enforceEmployeeOwnership(ctx, slip.employeeId)` — a self-service employee is confined to their own record; privileged roles/service accounts pass through.
- **Tests:** `payslip-ownership.test.ts` 6/6 (own→ok, co-worker→403, dual-role, service-account).

### SEC-P0-03 — plugin hook RCE `(0152f12)`
- **Was:** `engine.ts:132` ran plugin-supplied handler code via `new Function(handler)` in the host module scope → `process`/`require`/`fs` and every closed-over binding reachable = arbitrary RCE when `PLUGIN_RUNTIME_ENABLED=true`. (The ticket assumed a `sandbox/runtime.ts` existed — it did not.)
- **Now:** new `sandbox/runtime.ts` runs the handler with `node:vm` in a fresh **null-prototype** context, `codeGeneration` disabled: `process`/`require`/`module`/`eval` and the `this.constructor` realm-escape are all denied; wall-clock + vm timeout bound runaways; `ctx.log`/`ctx.emit` callbacks preserved.
- **Residual (documented in-file):** a host function passed into the sandbox still exposes `.constructor`; fully sealing that needs a worker_threads layer — tracked as follow-up. The acute default-reachable RCE surface is closed.
- **Tests/coverage:** `plugin-sandbox.test.ts` 12/12; **runtime.ts 100% stmt/line/func** (branch 81.8%; the 2 uncovered branches are unreachable non-Error `String(err)` fallbacks).

### NOTIF-CRASH — missing smtp-sender `(27dd130)`
- **Was:** `src/modules/email/smtp-sender.ts` was referenced but absent → email channel failed to load.
- **Now:** added; dry-run (`sent:false`, log only) when `SMTP_HOST` unset, dispatch via the existing nodemailer transport (`sent:true`) when set; remote handshake is fire-and-forget so a slow relay can't block the consumer.
- **Tests:** smtp-sender 2/2 (both branches exercised).

### SEC-P1-09 — hardcoded BYPASSRLS passwords `(27dd130)`
- **Was:** `visitor/migrations/0009` + `meeting/migrations/0007` shipped literal `*_scanner_dev_pw` for BYPASSRLS roles.
- **Now:** password sourced from `civitas.<svc>_scanner_password` GUC (set from secrets manager pre-migration); when absent, a random 64-hex one-time password is generated (`md5(random()||clock_timestamp())` ×2 — no pgcrypto dependency). Rotation only on explicit GUC (idempotent re-runs).
- **Verified live:** role created BYPASSRLS+LOGIN, `pw_length=64`.

### INV-MIGRATIONS — missing inventory tables `(27dd130)`
- **Was:** `inventory.cost_layers` + `inventory.cycle_counts` existed in the Drizzle schema but were never migrated → costing/cycle-count routes 500'd.
- **Now:** migration `0011_cost_layers_cycle_counts.sql` creates both with fail-closed RLS (`NULLIF(current_setting('app.tenant_id',true),'')::uuid`) + FORCE, CHECK constraints, and FIFO/pending-review indexes.
- **Verified live:** both tables present, `rowsecurity`+`force` = t; **costing suite 15/15**; no missing-relation errors.

### ANALYTICS-BIGINT — NOT-A-BUG
- `facts/normalize.ts:15` `num()` already coerces decimal strings (`"250.00"` → `250n`, `"250.50"` → paise) safely — resolved earlier in `061d6a16`. No change needed.

## Coverage summary (changed logic modules)
| Module | Stmt | Branch | Line | Note |
|---|---|---|---|---|
| `payroll/ecr-domain.ts` | 100% | 100% | 100% | pure oracle-tested |
| `plugin/sandbox/runtime.ts` | 100% | 81.8% | 100% | residual = unreachable non-Error fallbacks |
| `notification/email/smtp-sender.ts` | — | — | — | both branches (dry-run + dispatch) exercised |
| finance GL settlement handler | — | — | — | 3 branches (post/zero-net/rejected) tested |
| payroll ownership guard | 100% | 100% | 100% | 6 semantic cases |

Route/migration changes are validated by integration tests + live DB verification (schema present, RLS enabled, suites green) rather than unit line-coverage.

## Verification discipline
Every fix: (1) verified the defect against real code before editing; (2) confirmed **zero net-new `tsc --noEmit` errors** against the pre-existing baseline (168 payroll / 147 finance / clean plugin — inherited from the tenant-hardening merges #114–116); (3) shipped a test that fails-before/passes-after where a runtime surface exists; (4) ran adjacent suites for regressions (finance 68/68, payroll oracle 13/13, costing 15/15).
