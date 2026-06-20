# Figma Make Prompts — CivitasOne Suite

This directory contains every Figma Make prompt used to design the CivitasOne Suite UI.

**Rules for every prompt in this directory:**

1. Copy the master template (`00-master-template.md`) and fill placeholders. Never freeform.
2. Every output must use ONLY components from `packages/ui-kit` and tokens from `packages/ui-kit/tokens/`.
3. WCAG 2.2 AA compliance is mandatory — every interactive element must be keyboard reachable, focus-visible, and pass contrast ratios.
4. Every screen must have: default, loading, empty, error, success, dark mode, RTL.
5. Mobile breakpoint at 768px — design collapses to single column.
6. Tenant `brand.primary` is overridable at runtime; do not hardcode brand color.
7. Density token (`density.compact` vs `density.comfortable`) — Govt edition defaults to compact, others to comfortable.

**Directory layout:**

```
figma-prompts/
├── README.md                       (this file)
├── 00-master-template.md           (the binding template)
├── 01-foundation/                  (tokens, components, layouts — design once, reuse everywhere)
├── 02-auth/                        (login, MFA, password reset)
├── 03-platform/                    (installer, tenant admin, role manager, plugin/theme managers)
├── 04-finance/                     (COA, GL, journals, budgets, payments)
├── 05-procurement/                 (vendor, PR, RFQ, PO, GRN)
├── 06-inventory-assets/            (items, warehouses, stock, fixed assets)
├── 07-hrms/                        (employee, leave, attendance, payroll)
├── 08-projects/                    (project board, task, timesheet, milestone)
├── 09-crm/                         (lead, contact, deal pipeline)
├── 10-helpdesk/                    (ticket list, ticket detail, SLA, CSAT)
├── 11-reports/                     (report center, dashboard builder, MIS)
├── 12-mobile/                      (Flutter screens — approval inbox, MIS, field officer)
├── 13-public-site/                 (landing, pricing, docs, status, legal)
└── 99-states/                      (empty, error, loading variants library)
```

**Workflow per screen:**

```
1. Open the corresponding prompt file in this directory
2. Fill in placeholders (edition, role, data model link, etc.)
3. Paste into Figma Make
4. Iterate with refinement prompts (in 99-refinement-snippets.md)
5. Constrain output to ui-kit components (manual swap pass if needed)
6. Reviewer signs off: tokens, a11y, RTL, dark, all states
7. Export Figma frame link + PNG into the GitHub issue
8. Engineering picks up in next sprint via .claude/prompts/build-screen.md
```
