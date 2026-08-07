# Finance — Chart of Accounts

**SPRINT:** 4
**ROUTE:** `/finance/chart-of-accounts`
**EDITION:** All
**PRIMARY ROLE:** Finance Manager / Accountant
**SERVICE OWNER:** finance-service
**ENTITY:** finance_accounts

---

## Figma Make prompt

```
Generate the Chart of Accounts management screen for CivitasOne Suite.

PURPOSE: View, search, and maintain the hierarchical chart of accounts.
Govt edition uses IGAS / IPSAS-aligned account codes; Small Office uses simplified codes.

LAYOUT: AppShell with breadcrumb "Finance / Chart of Accounts"

PRIMARY REGIONS:
- Header: title "Chart of Accounts", primary action "New account", secondary "Import"
- Toolbar:
  - SearchBar (search by code or name)
  - FilterBar: account type (Asset, Liability, Equity, Income, Expense), status (active/inactive)
  - Density toggle (compact / comfortable)
  - Export menu (PDF, XLSX, CSV)
- Main: tree-table (DataTable variant with expandable rows showing parent-child hierarchy)
  Columns: Code, Name, Type, Currency, Balance (computed, current period), Status, Actions
- Side: when row clicked, DetailDrawer slides in with full account details + recent GL entries

DATA MODEL:
- account_id (uuid)
- code (string, unique per tenant)
- name (string)
- type (enum: asset, liability, equity, income, expense)
- parent_id (uuid, nullable — for hierarchy)
- currency (ISO code)
- is_group (boolean — group accounts can have children, leaf accounts hold balances)
- status (active | inactive)
- balance (computed from finance_gl_entries)

ROW ACTIONS:
- View (opens DetailDrawer)
- Edit (opens FormPage at /finance/chart-of-accounts/{id}/edit)
- Add child (only on group accounts — opens new-account form with parent preset)
- Deactivate (ConfirmDialog — checks no open balance, no recent activity)

PRIMARY ACTIONS:
- New account → /finance/chart-of-accounts/new
- Import → modal with CSV upload, template download, validation preview

EMPTY STATE:
- Heading: "No accounts yet"
- Body: "Start with a template or create your first account"
- Primary CTA: "Use Govt IGAS template" (or Small Office template, depending on edition)
- Secondary CTA: "Create account manually"

ERROR STATE: standard ErrorState with retry and correlationId

LOADING STATE: skeleton table rows (10 rows)

PERMISSIONS:
- View: any finance role
- Create / Edit: Finance Manager only
- Deactivate: Finance Manager only + requires audit comment

ACCESSIBILITY:
- Tree-table expand/collapse via Enter or right/left arrows
- aria-expanded on group rows
- aria-level on each row indicating hierarchy depth

OUT OF SCOPE:
- Account merge (Phase 2 — requires GL re-keying)
- Inter-tenant chart sharing (forbidden by tenant isolation rule)
```
