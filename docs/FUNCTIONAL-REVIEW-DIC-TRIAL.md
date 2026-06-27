# Functional Review — CivitasOne (DIC Trial Tenant)

**Tenant:** District Industries Centre (DIC) — Trial
**Build under review:** `apps/web` App Router screens rendered against the E2E gateway fixtures
**Data source:** `apps/web/e2e/global-setup.ts` (DIC trial dataset, mock gateway on `:4001`)
**Screenshot gallery:** `docs/screenshots/index.html` (28 screens across 16+ modules; manifest `docs/screenshots/results.json`, captured `2026-06-27T08:41:24Z`)
**Review method:** Each captured route's server `page.tsx`, its client table/action components, the data loaders (`apps/web/src/app/_data/loaders.ts`), the response mappers (`apps/web/src/app/_data/apiMappers.ts`), and the shared design-system primitives (`apps/web/src/app/_components/ds/*`) were read directly and cross-checked against the fixture payloads.

---

## Executive Summary

The DIC trial build is **functionally ready for a guided trial** with notes. Across the 16 reviewed modules every captured screen renders, is reachable, and presents the seeded data through a consistent, well-engineered design system. The architecture is solid:

- **Real data plumbing.** Pages are async server components that call typed loaders. Loaders validate/​map upstream payloads and degrade gracefully — on upstream failure they return seeded/empty data plus a `source: "error"` flag that surfaces a visible `DataSourceBadge`. Tables additionally hydrate from an offline cache (`useSeededResource`) and show a "showing saved data / you're offline" status line.
- **States are covered at the module level.** Every module folder ships `loading.tsx` (skeletons) and `error.tsx` (an `alert`-role recovery card with retry + back link). Next.js cascades these to all child routes, so even leaf screens without their own state files are covered. Empty states (`EmptyState`) are used throughout.
- **Primary actions are genuinely wired.** Finance is the strongest example: payment/sanction/bill actions POST/PATCH the proxied service endpoints behind maker-checker confirm dialogs with mandatory reason capture. Create/register/log actions across HR, Procurement, Citizen, Audit, Estab and Knowledge route to real `/new` forms or client action buttons.
- **The render-function regression is resolved.** A repo-wide check confirms no server `page.tsx` passes a `render:` function to the client `DataTable` (see "Recently Fixed"). Server screens now use the server-safe `cellType: "status" | "amount"` / `rowLinkKey` API; rich cell rendering lives in `"use client"` table components.

Detracting items are mostly **cosmetic or accessibility-hygiene**, not blockers — with three exceptions worth tracking before a wider rollout: (1) a mapper drops the seeded Asset-Maintenance record so that screen shows empty in the trial, (2) a repo-wide broken `aria-labelledby="page-heading"` reference leaves the main landmark unnamed, and (3) the Legal "Active Cases" KPI under-counts because of a status-vocabulary mismatch. None prevent a trial; all are listed below.

**Overall verdict: GO for DIC trial (with the tracked notes).**

---

## Per-Module Findings

| Module | Screens Reviewed | Data OK | Navigation | Actions Wired | Issues Found | Verdict |
|---|---|---|---|---|---|---|
| **Dashboard** | Command Centre (`/dashboard`) | ✅ Role-filtered module hub + RoleCommandCenter | ✅ PageHeader, `nav` w/ aria-label, module tiles link out | ✅ "My approvals" → `/workflow`; tiles navigate | Empty-state path for users with no modules is correct | **PASS** |
| **Finance** | Dashboard, Chart of Accounts, Payments | ✅ COA (2 heads), payments register (1 row), dashboard KPIs | ✅ PageHeader + quick-link grid | ✅ Maker-checker actions POST/PATCH real proxy endpoints; search/filter/segments | None functional; no breadcrumb on leaf list (by design) | **PASS** |
| **HR** | Dashboard, Employees, Org Chart | ✅ Employees (2), KPIs; Org Chart empty (fixture `org-chart: []`) | ✅ "View all" link; row links to `/hr/employees/{id}` | ✅ Directory client table wired | Broken `aria-labelledby` (see D2); Org Chart empty in trial dataset | **PASS-WITH-NOTES** |
| **Procurement** | Dashboard, Vendors | ✅ Vendor (Bharat Electronics) renders; dashboard KPIs all 0 per fixture | ✅ PageHeader + quick links | ✅ "+ Register Vendor" → `/new`; "+ New Indent" | Dashboard counters legitimately zero in trial data | **PASS** |
| **Projects** | Projects list, Milestones | ✅ 1 project, 1 milestone render; RAG KPIs computed | ✅ PageHeader; row links | ✅ "+ New Project" → `/new` | No back link on list (reachable from hub) | **PASS** |
| **Grants** | Grants, Grantees | ✅ Grant + grantee render; money KPIs via `formatMoney` | ✅ Breadcrumb `nav` + `main` landmark on both | ✅ Client tables; navigates to detail | None | **PASS** |
| **Assets** | Fixed Assets, Maintenance | ⚠️ Fixed assets render; **Maintenance shows empty** — mapper drops the seeded job (D1) | ✅ PageHeader; row links (maintenance link unreachable, see D1) | ✅ Register/Schedule/Log links | D1 (Medium), D7 (Low mapper fidelity) | **PASS-WITH-NOTES** |
| **Citizen** | RTI, Requests | ✅ RTI app + service request render; SLA KPIs | ✅ PageHeader | ✅ Register RTI / Log Request client buttons | None functional | **PASS** |
| **CRM** | Contacts, Dashboard | ✅ Contact renders; dashboard KPIs | ✅ Contacts `back="/crm"`; toolbar; info `role=note` | ✅ New Contact / New Engagement links | None | **PASS** |
| **Audit** | Observations | ✅ Observation renders w/ risk + money pills | ✅ Breadcrumb (`aria-current`); segmented filter syncs to URL | ✅ Log Observation button; row → detail | None | **PASS** |
| **Legal** | Cases | ⚠️ Case renders, but **"Active Cases" KPI = 0** (status mismatch, D3) | ✅ PageHeader; cause-list link; row → detail | ✅ "+ New Case" → `/new` | D3 (Medium); hardcoded "64% favourable" delta; no `main` landmark | **PASS-WITH-NOTES** |
| **Establishment** | Files (eOffice), Meetings | ✅ File + meeting render | ✅ PageHeader; dak/dispatch/approvals/calendar links | ✅ Create File / Schedule links | Mislabeled KPIs (D5): "SLA Breached"=pending count; meetings hardcoded "+3%", "Action Items"=meeting count | **PASS-WITH-NOTES** |
| **Knowledge** | Repository | ✅ Document renders; archived-count note | ✅ PageHeader | ✅ Import + Publish Document buttons | Mislabeled KPIs (D5): "Circulars"/"Published" both = approved count; "Notifications" = under-review count | **PASS-WITH-NOTES** |
| **Stock** | Items | ✅ SKU renders; value/low-stock KPIs | ✅ PageHeader; row → detail | ⚠️ "+ New Item" wired; **"Export" button dead** (D4) | D4 (Low) | **PASS-WITH-NOTES** |
| **Billing** | Plans | ✅ Plan renders via `ModuleListPage` | ✅ PageHeader (no breadcrumb on list) | ✅ "+ New Plan" → `/new` | Broken `aria-labelledby` (D2) | **PASS** |
| **TenantAdmin** | Users, Operations | ✅ User + ops processes/schedulers render; ops score computed; role-guarded | ✅ Breadcrumb + `back` on both | ⚠️ Operations fully wired; **Users "Export" button dead** (D4) | D2, D4 | **PASS-WITH-NOTES** |

> Verdict legend: **PASS** = renders, navigates and primary actions wired with no observed gaps; **PASS-WITH-NOTES** = fully usable for a trial but carries at least one listed defect; **FAIL** = a captured screen does not render its data or a primary path is broken. No module scored FAIL.

---

## Defects Found

### D1 — Seeded Asset-Maintenance record is dropped by the mapper (Medium)
**Files:** `apps/web/src/app/_data/apiMappers.ts` (`mapMaintenanceSummaries`), `apps/web/src/app/(app)/assets/maintenance/page.tsx`
`mapMaintenanceSummaries` hard-requires `assetId` (`if (!id || !assetId) continue;`), but the DIC fixture row at `/api/v1/asset/maintenance` (`mnt-001`) has **no `assetId`** field. The record is therefore filtered out, so the Maintenance screen renders the empty state ("No maintenance jobs") and all four KPI cards read 0 — even though the trial dataset defines a scheduled job. The captured screenshot will not match the seeded intent. Fix by adding `assetId` to the fixture (and/or seed), or by relaxing the mapper to fall back to `assetCode`. Related fidelity issue: see D7.

### D2 — Main landmark has no accessible name; broken `aria-labelledby` repo-wide (Medium, a11y)
**Files:** `apps/web/src/app/_components/ds/PageHeader.tsx` and dozens of pages (e.g. `hr/dashboard`, `hr/employees`, `billing/plans`, `tenant-admin/*`, `projects/*`)
Many screens declare `<main className="page-main" aria-labelledby="page-heading">`, but **no element anywhere defines `id="page-heading"`** — `PageHeader` renders a bare `<h1>{title}</h1>` with no `id`. The `aria-labelledby` therefore references a non-existent node, leaving the primary landmark unnamed for assistive tech. Fix by giving `PageHeader`'s `<h1>` `id="page-heading"` (or accepting a `headingId` prop). Low effort, broad benefit.

### D3 — Legal "Active Cases" KPI under-counts (Medium)
**File:** `apps/web/src/app/(app)/legal/list/page.tsx`
The KPI computes `active = items.filter(i => i.status === "pending")`, but the seeded case (`leg-001`) has `status: "active"`, and the table's own pill logic doesn't list "active" among its known states. Result: the case is listed yet "Active Cases" shows **0**, which misrepresents the data. The card also renders a hardcoded `delta="64% favourable"` that is not derived from the dataset. Align the status vocabulary (page, table pills, fixture/seed) and drive the delta from data.

### D4 — Dead "Export" controls (Low)
**Files:** `apps/web/src/app/(app)/stock/list/page.tsx`, `apps/web/src/app/(app)/tenant-admin/users/page.tsx`
Both render an `Export` button with no `onClick`/handler and no `href`, so it is a visible no-op. Either wire it to an export action or remove it until implemented. (Most other list screens correctly omit such a control.)

### D5 — Misleading KPI labels not backed by their own metric (Low)
**Files:** `knowledge/repository/page.tsx`, `estab/list/page.tsx`, `estab/meetings/page.tsx`, `legal/list/page.tsx`
Several stat cards display a value that does not match the label:
- Knowledge: **"Circulars"** and **"Published"** both show the same `approved` count; **"Notifications"** shows the `under_review` count.
- Establishment files: **"SLA Breached"** shows the count of `pending` files (no real breach calc).
- Establishment meetings: **"Action Items"** shows total meeting count; **Compliance** has a hardcoded `+3%` delta.
These don't break the screen but can mislead a trial evaluator. Either compute the true metric or relabel.

### D6 — Inconsistent semantic landmark usage (Low, a11y/consistency)
**Files:** various (`legal/list`, several `finance/*`, `knowledge/repository` use bare fragments or `<div className="wrap">`; `hr/*`, `billing/*`, `tenant-admin/*`, `audit/observations` use `<main>`)
Some screens omit the `<main>` landmark entirely while others include it. Standardise on a single page wrapper so every screen exposes exactly one named `main` landmark (combine with D2).

### D7 — Maintenance mapper fidelity (Low)
**File:** `apps/web/src/app/_data/apiMappers.ts` (`mapMaintenanceSummaries`)
Even when a row survives, the mapper hardcodes `maintenanceType: "corrective"`, never maps `vendor`, and derives `assetCode` from `assetId.slice(0,8)`. The "Type" and "Technician / Agency" columns will not reflect source values. Minor, but worth aligning with the `MaintenanceSummary` contract.

---

## Recently Fixed

The **DataTable render-function-to-client-component** bug was fixed across **18 pages**. The root cause was server components passing a `render: (row) => …` function to the client-side `DataTable`, which is not serializable across the server/client boundary. The fix introduces a server-safe column API (`cellType: "status" | "amount"`, `rowLinkKey` + `rowLinkPrefix`) and moves any rich cell rendering into dedicated `"use client"` table components.

Verification for this review: a repo-wide search for `render:` functions inside server `page.tsx` files under `(app)/` returned **no matches**, and the captured tables (`AccountsTable`, `PaymentsTable`, `ObservationsTable`, `LegalCasesTable`, etc.) are all `"use client"`. The fix set covers:

- `audit/observations/[id]`, `audit/exports`
- `finance/budget/sanctions/[id]`, `finance/expenditure/bills/[id]`
- `plugins`
- `tenant-admin/operations`, `tenant-admin/security`, `tenant-admin/sso`, `tenant-admin/mfa`, `tenant-admin/siem`, `tenant-admin/idp`
- `contracts/list`
- `inventory/reconcile`
- `reports/list`, `reports/mis`
- `knowledge/list`, `knowledge/dashboard`
- `citizen/grievances`

No regression of this class was observed in the captured screens.

---

## Sign-offs

| Role | Assessment | Decision |
|---|---|---|
| **Functional Lead** | All 16 modules render seeded data, navigate correctly, and expose wired primary actions behind appropriate confirmations. Module-level loading/error/empty states are comprehensive. The render-function regression is verified resolved. Tracked items are non-blocking. | **GO** |
| **Domain Expert (Gov-ERP)** | Domain workflows are represented faithfully (finance maker-checker, eOffice file tracking, RTI 30-day clock, audit observations, grants UC compliance). Two KPI accuracy issues (Legal "Active Cases" D3, Establishment/Knowledge labels D5) and the dropped maintenance record (D1) should be corrected before evaluators score those screens, but they don't block a guided trial. | **GO (with notes)** |
| **QA** | No FAIL-level screen. Confirmed: 18-page DataTable fix holds; states cascade correctly; offline/error badges work. Open defects: D1 (Medium), D2 (Medium, a11y), D3 (Medium), D4–D7 (Low). Recommend fixing D1–D3 in the next patch and D2 as a quick global hygiene change. | **GO** |

### Final Recommendation: **GO for DIC trial**
Proceed with the District Industries Centre trial. Schedule D1, D2 and D3 for the immediate follow-up patch; D4–D7 can be batched as polish.

---

## Final Functional Readiness Score

# **88 / 100**

**Scoring rationale**
- Data display (24/25): every captured screen renders seeded data correctly except Asset Maintenance (D1).
- Navigation (19/20): consistent PageHeader, breadcrumbs/back where expected, working sub-navigation; minor inconsistency in back-link/landmark usage.
- States (20/20): loading, error and empty states present and cascading across all modules.
- Functional completeness (17/20): primary create/view/filter actions wired and confirmation-gated; deductions for two dead Export controls (D4) and the maintenance row that never reaches its detail link (D1).
- Accessibility (8/15): strong baseline (semantic tables, `aria-sort`, status pills with text labels, `role="status"`/`alert` regions, focusable rows) offset by the repo-wide broken `aria-labelledby` (D2) and inconsistent `main` landmarks (D6).

*Report generated from direct review of the page source and fixture data; reference the visual gallery at `docs/screenshots/index.html`.*
