# CivitasOne Frontend UAT — World-Class Test Prompt

Use this prompt to run persona-based, multi-device functional and visual UAT on CivitasOne web and mobile.

---

## Mission

Act as **CTO-led Frontend UAT Command Center**. Organize ERP domain experts, functional testers, and technical QA to validate that CivitasOne web (`apps/web`) and mobile (`apps/mobile`) deliver correct, role-appropriate, responsive experiences against the **live stack** — not mocks alone.

---

## Test Team (assign one lead per track)

| Track | Lead persona | Responsibility |
|-------|--------------|----------------|
| **Functional UAT** | Finance officer, Procurement officer, HR officer, Auditor | Execute business journeys; verify data, workflows, approvals |
| **Technical QA** | QA automation engineer | Playwright/viewport matrix, API↔UI contract, RBAC, console errors |
| **ERP SME** | Former PA/CFO office, CAG audit, e-Gov P2P specialist | Score against world-class govt ERP standards |
| **Visual UX** | UX reviewer | Layout at mobile/tablet/desktop; truncation, nav, touch targets |
| **Mobile field** | Field officer with Android/iOS | Offline sync, approvals, geo attendance, PKCE login |

---

## Personas (dev login: `/auth/dev`, password `Civitas@123`)

| Username | Role | Responsibility | Must access | Must NOT access |
|----------|------|----------------|-------------|-----------------|
| `superadmin` | Platform Super Admin | Tenant config, all modules | Finance, Procurement, HR, Audit, Tenant Admin | — |
| `officer` | Department Officer | Budget, P2P, leave, payroll ops | Finance, Procurement, HR | Break-glass |
| `auditor` | Internal Auditor / Legal | Observations, cases, compliance | Audit, Legal, Reports | Finance payments write, Tenant users |

---

## Device matrix (visual + functional)

| Profile | Viewport | Validate |
|---------|----------|----------|
| Mobile | 390×844 | Sidebar collapse, table scroll, FAB/buttons, no horizontal overflow |
| Tablet | 768×1024 | KPI grid, table columns, nav drawer |
| Desktop | 1280×800 | Full table, multi-column KPIs, breadcrumbs |

For each persona × device × journey: capture screenshot, record HTTP status, h1, table row count, console errors.

---

## Critical journeys (minimum 5 per module)

Each journey must include:
1. **Happy path** — list or dashboard loads with seed data
2. **Detail path** — drill-down shows mapped fields (not "not found")
3. **Unauthorized path** — wrong role blocked or redirected
4. **Invalid/empty path** — graceful empty state, not crash
5. **Audit path** — action leaves trace (approval queue, status change)

### Modules

- **Finance:** dashboard → sanctions → bills → payments → GL
- **Procurement:** indents → PO → GRN → approvals
- **HR:** employees → leave → payroll → attendance
- **Audit/Legal:** observations → compliance → legal cases
- **Assets/Stock:** register → detail → ledger
- **Citizen/Helpdesk:** tickets → detail → SLA
- **Platform:** tenant users → roles → break-glass (superadmin only)

---

## Scoring (0–10 per module)

| Dimension | Weight |
|-----------|--------|
| Functional completeness | 2.0 |
| End-to-end workflow | 2.0 |
| RBAC / persona correctness | 1.5 |
| Data correctness / no false "not found" | 1.5 |
| Responsive UX (mobile/tablet/desktop) | 1.0 |
| Visual polish / accessibility | 1.0 |
| Performance (<3s first paint) | 1.0 |

**Ratings:** 9–10 World Class · 8–8.9 Production Ready · 7–7.9 Conditional · <7 Not Ready

---

## Execution commands

```bash
# Live web — persona × viewport matrix
cd apps/web && node scripts/frontend-quick-uat.cjs

# Procurement module deep dive
JWT_SECRET=civitasone-dev-secret node scripts/procurement-e2e.mjs

# Mobile unit tests (requires Flutter SDK)
cd apps/mobile && flutter test
```

**Evidence output:** `/tmp/civitasone-frontend-uat/report.json` + PNG screenshots per check.

---

## Go / no-go gates

- **Block release** if any persona sees HTTP 500 on core dashboard
- **Block release** if RBAC allows auditor/officer into tenant-admin or break-glass
- **Block release** if detail pages show "not found" with HTTP 200 API
- **Block mobile field rollout** if offline write flows (approvals, leave, tickets) fail

---

## Deliverable format

1. Executive summary (overall score, go/no-go)
2. Persona scorecard
3. Viewport scorecard
4. Finding register (UAT-FE-xxx, severity, screenshot path)
5. World-class vs gap analysis
6. Remediation priority list
