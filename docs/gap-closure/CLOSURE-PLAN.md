# Module gap closure plan

**Status:** Wave 0 started on owner instruction (2026-10-13). The wave order and the decisions in section 5 are still open.

Prepared 2026-10-13 by the Claude orchestrator. Source: `docs/gap-ledger/` (INDEX.md, PRIORITY_QUEUE.md, SHARED_FIXES.md, BACKEND_CHECKLIST.md, per-module files).

## 1. Where we are

- 4,652 tracked items: **3,092 open** across 62 modules, **1,560 closed**.
- Closed modules: hr (528), finance (311), payroll (259), admin (164), assets (151), inventory (62), recruitment (85).
- Largest open modules: crm 359, procurement 216, works 200, tenant-admin 195, estab 163, citizen 134, grants 86, projects 85, revenue 79, analytics 79, audit 75, tenant 73, designer 70, knowledge 69, helpdesk 67.
- PRIORITY_QUEUE.md: 219 unticked, but about 112 of them belong to modules already closed (hr, payroll, finance, recruitment, assets, admin, inventory). The real open priority count is about **107**.
- 428 items are backend-verify (BACKEND_CHECKLIST.md, by service).
- The ledger lags merged work: for example, u11-works (#1944) and u20-analytics (#1955) merged review-2 gap closures, yet works still shows 200 open.

## 2. Waves

| Wave | Scope | Why first |
|---|---|---|
| 0. Reconcile | Tick ledger items already closed by merged PRs (u-series, Kiro module PRs). Sync PRIORITY_QUEUE.md with the closed modules. Check which of SF-01..SF-20 already exist on main. | Stops duplicate work; gives true counts. |
| 1. Shared fixes | SF-01..SF-20 (list/table rebuild, error-vs-empty, status pills, masking + export audit, pickers, IST dates, paise parser, form primitives, 202 UX, self-scoping, layout guards...). One PR per SF, each ticks every module item it closes. | Each SF closes items in many modules at once. |
| 2. Priority queue | The ~107 open high-severity items (money, approvals, identity, PII, access scope): grants 14, procurement 12, revenue 7, projects 7, learning 5, estab 5, crm 5, works 4, then the singles. | Security and money risk. |
| 3. Citizen and money modules | citizen 134, revenue 79, billing 58, procurement 216, grants 86. | Public-facing and financial. |
| 4. Large internal modules | crm 359, works 200, tenant-admin 195, estab 163, projects 85. | Biggest remaining volume. |
| 5. Remaining modules | analytics, audit, tenant, designer, knowledge, helpdesk, legal, notifications, stock, learning, platform-admin, ai, workflow, reports, then the long tail (< 33 items each). | Lower risk. |

Backend-verify items are folded into each module's wave, using that service's BACKEND_CHECKLIST section.

## 3. How each PR is built, reviewed and merged

1. **Build (Kiro).**
   - One PR per module, or per page cluster of at most about 40 items for large modules (crm, procurement, works, tenant-admin, estab).
   - Each PR ticks `[x] Status` for every item it closes, in the same PR, so the ledger never drifts again.
2. **Test.** Every closed item has the test its ledger entry specifies (the Given/When/Then), and no test is weakened. Usual house rules apply:
   - CQRS with a per-command messageId;
   - FORCE RLS;
   - empty vs error states;
   - en and hi i18n;
   - masking;
   - authz on every route;
   - no guard baselines.
3. **Review (orchestrator).** Independent review → fix → re-review until CLEAN. The reviewer also checks that every ticked item is really closed.
4. **Merge.** Bundles of reviewed PRs, one CI run per bundle. At most 6 PRs in review at once, with a stack depth of at most 2.
5. **Capacity on cloudsphere-ec2.** About 7 concurrent full-stack test agents at most. Prune volumes and old worktrees before each wave.

6. **Provisional W0 ticks (owner decision, 2026-10-13: "Re-check during each wave").** Some W0 ticks say `PROVISIONAL — re-confirm in this module's next wave PR`. Before that module's next wave PR merges, its reviewer re-confirms each of them against main, then either drops the PROVISIONAL marker or reopens the item with a note. A module PR does not merge with unresolved provisional ticks in its own module.

## 4. Rough size

About 3,092 items at about 35 per PR gives roughly 90 PRs, in about 15 bundles. At about 5 or 6 reviewed PRs a day, that is roughly 3 to 4 weeks of steady work after Wave 0. This is an estimate and will be re-baselined after Wave 0.

## 5. Owner decisions needed

1. Approve the wave order, or reorder.
2. Builder capacity: Kiro alone, or Kiro plus orchestrator fix agents in parallel on separate modules.
3. Sequencing against the SmartTransfer M01 close-out (ST-M01-13b Timefold benchmark, Helm settings, dev deploy, contract tag), which uses the same Kiro capacity.
