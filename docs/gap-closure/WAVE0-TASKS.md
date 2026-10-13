# Wave 0: reconcile the gap ledger (task list)

**Status: complete (2026-10-13).** All W0-01 to W0-10 tasks are done. See `w0-report.md`.

**Goal:** turn the ledger into a true, current picture before any new fix work starts, and make the ledger part of the repo so every later PR ticks its own items.

**Owner approval:** on 2026-10-13 the programme owner (dbn1972) said: "provide Wave 0 detail tasks list and keep it in repository and start wave 0".

**Ledger location (from Wave 0 onward):** `docs/gap-ledger/` in this repo is the source of truth. The copy at `~/CivitasOne/gap-ledger/` on cloudsphere-ec2 is frozen as of 2026-10-13 and must not be edited. The raw `gaps.json` (8.7 MB) stays off-repo as the original extract.

## Rules for every Wave 0 task

- **Tick only what main proves.** Tick an item `[x]` only after reading the cited code on `origin/main` and confirming the fix is there. A PR title or a claim is not proof.
- **Tick format:** `- [x] **Status** (W0 2026-10-13: closed by #NNNN, verified on main <sha9>)`.
- **Partly fixed:** keep `[ ]` and add a line under the status: `- **W0 note:** partly fixed by #NNNN — <what remains>`.
- **Code moved or rewritten:** if the item's code no longer exists (file deleted, page removed), mark it `[~]` with `W0: obsolete — <reason>`.
- **Edit only the status lines and W0 notes.** Never change an item's evidence, steps or acceptance text.
- **Read-only on code.** Wave 0 changes nothing outside `docs/gap-ledger/` and `docs/gap-closure/`.

## Tasks

| ID | Task | Output | Done when |
|---|---|---|---|
| W0-01 | Import the ledger markdown into `docs/gap-ledger/`, and add this plan and `CLOSURE-PLAN.md` under `docs/gap-closure/`. | This PR | Files are in the PR. |
| W0-02 | List every PR merged to main since the ledger snapshot (2026-09-29): number, title, files touched, and any GAP-* ids in its title, body or commits. | `docs/gap-closure/w0-merged-prs.md` | Every merged PR since 2026-09-29 is listed. |
| W0-03 | For each module with open items, find the items whose "Files to change" were touched on main since 2026-09-29. Only these can have been fixed. Items whose files were untouched stay open, but SF-related items are still checked in W0-05. | Candidate list per module | Every open item is classed as touched or untouched. |
| W0-04 | Verify each touched candidate against main source and tick it (`[x]`), note it (partly fixed) or mark it obsolete (`[~]`), following the rules above. | Updated module files | Every candidate has a verdict. |
| W0-05 | Shared fixes SF-01..SF-20: check whether each shared component or rule exists on main and is adopted. Mark each DONE, PARTIAL or MISSING, with file:line evidence and adoption counts. | `docs/gap-closure/w0-shared-fixes-status.md` | All 20 have a verdict. |
| W0-06 | The 418 "unverified-service-absent" items: check whether the service they need now exists on main, and re-class each as ready for verify or still absent. | Section in `w0-report.md` | Every such item is re-classed. |
| W0-07 | Sync `PRIORITY_QUEUE.md` with the module files: tick each queue entry whose module item is ticked. The closed modules (hr, finance, payroll, admin, assets, inventory, recruitment) account for about 112 entries. | Updated `PRIORITY_QUEUE.md` | Queue and module files agree. |
| W0-08 | Recount: regenerate the `INDEX.md` table with open, closed and obsolete per module, and the true priority-queue count. | Updated `INDEX.md` and `w0-report.md` | The numbers match a script count of the status lines. |
| W0-09 | Re-baseline the Wave 1 backlog: from W0-05, list the SF PRs still needed (MISSING or PARTIAL) and the module items each one will close. | `docs/gap-closure/wave1-backlog.md` | Each SF PR names its target items. |
| W0-10 | Independent review of the Wave 0 PR: re-check a random sample of 30 newly ticked items and all the obsolete ones against main, then merge. | Review comment | Review is CLEAN. |

## Work split for W0-03 and W0-04 (parallel, disjoint module files)

| Lane | Modules |
|---|---|
| A | crm, citizen, contact, approvals, dashboard |
| B | procurement, works, contracts, fleet, field, inspection, municipal |
| C | tenant-admin, estab, establishment, tenant, identity, auth, domains, setup, settings |
| D | grants, projects, revenue, billing, stock, legal, court, catalogue, pricing, loyalty |
| E | analytics, audit, designer, knowledge, helpdesk, reports, ai, recommendations, cdp, docs |
| F | notifications, learning, platform-admin, workflow, install, locations, telephony, meeting, themes, visitor, policy, metadata, change, plugins, documents, journeys, help, developer-portal, sandbox, offline, library |
| G | W0-05 (shared fixes) and W0-06 (service-absent items) |

The orchestrator does W0-01, W0-02, W0-07, W0-08 and W0-09, and merges the lanes.
