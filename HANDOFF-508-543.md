# CivitasOne — Claude Code handoff: finish CI + land through #543

## Goal
Get **CI green enough to merge**, then land in order:

1. **#508** — CI unblock (`ai/fix-ci-eslint-configs`) — **do this first**
2. **#515** — Phase 1 citizen runtime + FN-14 pay→receipt→GL (`feat/usd-phase1-citizen-runtime-combined`)
3. **#526** — Phase 1 designer B4–B8 (`feat/usd-phase1-designer-b4-b8-combined`)
4. **#527** — Phase 1 FN-09/10/11 Test/Review/Pack (`feat/usd-phase1-test-review-pack`)
5. **#543** — Phase 2 combined (`feat/usd-phase2-combined`) — **end state**

**Do not admin-merge red PRs.** Prefer normal merge when required checks are green. Minimize pushes on #508 (queue congestion + tip supersession is why this felt stuck).

Repo: `dbn1972/civitasone-suite`
Local/EC2: suite `/home/ec2-user/CivitasOne/civitasone-suite`; worktrees `/home/ec2-user/wt/<name>` — never dirty-edit live suite `main`.
Laptop paths sometimes used: `~/Projects/civitasone-suite`, `~/Projects/wt/*`.

---

## What already happened (don't redo)

### Billing red herring
Early #508 failures looked like GitHub billing; **jobs do run**. Real problem = **baseline CI debt + congested runners + too many tip pushes**.

### #508 progress (branch `ai/fix-ci-eslint-configs`)
Last known tip when handoff was written: **`961fa3f2`** — always verify with:
`gh pr view 508 --json headRefOid,url`

Already fixed / pushed on this branch (among others):
- ESLint configs for several services; cdp/queue typing
- Metadata CQRS test harness (`202` + `drain()`)
- Screen gate / gateway notification alias / L10 ports / court `worker-main`
- Grant migration `0006` RLS + `AADHAAR_HMAC_KEY` + allow-list
- RTL baseline ratcheted **171 → 246**
- Stock vitest `describe.configure` → `testTimeout`
- **Root cause of latest Tests auth fail:** Turbo 2 `envMode=strict` stripped `PGPASSWORD` → inventory DQ + install silo used `civitas_dev_pw` while CI admin is `civitas_test`. Fixed via `turbo.json` `test.passThroughEnv` + vitest/admin wiring. Local at time of fix: install 13/13, inventory DQ 35/35.

**When handoff was written:** Tests on `961fa3f2` were still **queued/pending** (never concluded). Contract previously failed on older tip `4155dc17` with `cross-service-events.contract.test.ts` (RTL 246 OK).

### Phase 1
| PR | Branch | Status |
|---|---|---|
| #517 B2/B3 | — | **MERGED** to main |
| #513/#514 | — | closed → superseded by **#515** |
| #515 | `feat/usd-phase1-citizen-runtime-combined` | OPEN — citizen UX + sandbox pay confirm→receipt→GL |
| #518–525 | — | closed → superseded by **#526** |
| #526 | `feat/usd-phase1-designer-b4-b8-combined` | OPEN — B4–B8 designer depth |
| #527 | `feat/usd-phase1-test-review-pack` | OPEN — Test/Review/Pack polish |

### Phase 2
| PR | Status |
|---|---|
| #535–#542 | closed → superseded by **#543** |
| #543 | OPEN — combined Phase 2 tip |

**#543 already includes** (renumbered migrations):
- FN-09 export + FN-29 statutory ack
- FN-24 channels (intake allow-list → 422 `CHANNEL_NOT_ALLOWED`)
- FN-23 applicant types
- FN-17 domain pack activate + installer UI
- FN-08 notification.send from pack bindings
- FN-21 engine binding UI
- FN-25/26 SLA/escalation + doc verification lanes

Migrations on #543 tip: citizen **0023** FN-23 → **0024** FN-24 → **0025** FN-21 → **0026** FN-25/26; workflow **0037**.

Infra fix already on #543 tip **`3538fbd7`** (verify):
- Removed git symlinks `services/{crm,report,workflow}-service/node_modules` pointing at absolute EC2 paths (broke `pnpm install` on runners)
- `aquasecurity/trivy-action@0.28.0` → **`@v0.36.0`** (old tag does not exist)

---

## Known remaining blockers (verify live with `gh`)

### #508 (must clear first)
1. **Tests** — confirm tip goes green after PGPASSWORD fix; if still red, get failing package from logs (don't guess).
2. **Contract Tests** — `cross-service-events.contract.test.ts` style failures: deadSubscriptions count drift; metadata phantom `audit.event.record`; update baseline/expectations carefully.
3. Downstream often red: Accessibility, Procurement E2E, Playwright E2E, Screen Gate, Mutation, L10 — **only peel after Tests + Contract green**, one class at a time.

### #515 / #526 / #527
Not waiting only on #508. Best path: **merge #508 → rebase each on main → re-run**.
#526 previously: inventory schema drift, meeting alias, screen `/notification/experiments`, A11y/Procurement/L0 — many overlap #508 fixes.

### #543
After Trivy/symlink fix, re-check CI. May need rebase onto main after #508 (+ ideally Phase 1) lands.

---

## Recommended procedure

```bash
gh pr view 508 --json headRefOid,statusCheckRollup,mergeable,url
gh pr checks 508

git fetch origin
# use worktree for ai/fix-ci-eslint-configs — never dirty live main

# If Tests fail: one failure class → local proof → ONE commit → ONE push
# If Contract fail: fix cross-service-events baseline locally → ONE push
# Cancel only superseded runs on OLD SHAs of this branch

# Merge #508 with normal gh pr merge when required checks green (no --admin)

# Then for 515, 526, 527, 543: rebase onto origin/main, push, wait CI, merge
# Order: 515 → 526 → 527 → 543
```

### Local proof commands that mattered
```bash
pnpm --filter @civitasone/grant-service exec vitest run
pnpm --filter @civitasone/inventory-service exec vitest run
pnpm --filter @civitasone/install-service exec vitest run
pnpm --filter @civitasone/metadata-service exec vitest run
```

### Anti-patterns
- Pushing a new CI unblock commit before previous tip Tests finish
- Parallel Phase PR peels that duplicate #508 work
- Admin-merging red

---

## Phase 2 complete definition (BRD §11 / DoD §13)
Exit: end-to-end citizen journey + pack portability with **TL + PGR/Water**, including DoD (f) municipal pack activation (FN-17).
**#543 merge + green CI** is the engineering milestone; full BRD DoD (a)–(e) may still need smoke after merge.

Leftovers after #543 (optional):
- Live NPCI BBPS (`BBPS_ENABLED`)
- Fail-open channel policy when no published definition
- CRM company profiles (FN-23 OQ-4)
- Online `payment_received` notify; possible double `issued` notify
- Engine preview → live revenue-service; wire `engineAvailable` into B5 after #526
- Guided lanes → executable workflow auto-deploy; live SLA sweeper e2e

---

## PR URLs
- https://github.com/dbn1972/civitasone-suite/pull/508
- https://github.com/dbn1972/civitasone-suite/pull/515
- https://github.com/dbn1972/civitasone-suite/pull/526
- https://github.com/dbn1972/civitasone-suite/pull/527
- https://github.com/dbn1972/civitasone-suite/pull/543

## Success criteria
1. #508 merged (or clearly blocked with one concrete remaining check + log line)
2. #515, #526, #527 rebased and merged (or listed with exact remaining fails)
3. #543 rebased onto updated main, CI addressed, **merged**
4. Short report: SHAs merged + anything still open vs BRD DoD
