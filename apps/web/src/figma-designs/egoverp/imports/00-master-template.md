# Master Figma Make Prompt — CivitasOne Suite

**Usage:** Copy this file, rename to `{screen-name}.md` under the right module folder, fill every placeholder. Do not delete any section. If a section does not apply, write "N/A" — never leave blank.

---

## SECTION 1 — Identity

```
PRODUCT: CivitasOne Suite
SCREEN NAME: {{screen-name}}
ROUTE: {{/path/in/next-app}}
MODULE: {{Auth | Platform | Finance | Procurement | Inventory | Asset | HRMS | Project | CRM | Helpdesk | Report | Public}}
EDITION: {{Small Office | PSU | Govt Department | All}}
PRIMARY ROLE (Vol 1 role matrix): {{role name}}
SECONDARY ROLES: {{list or N/A}}
SCREEN TYPE: {{List | Detail | Form | Dashboard | Wizard | Drawer | Modal | Landing}}
```

## SECTION 2 — Purpose and success criteria

```
PURPOSE (one sentence): {{what this screen exists to do}}
PRIMARY USER GOAL: {{what the user wants to accomplish in under 30s}}
SUCCESS CRITERIA:
- {{measurable outcome 1}}
- {{measurable outcome 2}}
- {{measurable outcome 3}}
```

## SECTION 3 — Data model

```
ENTITY: {{entity name from MASTER_BUILD_BRIEF.md}}
SERVICE OWNER: {{service-name from §16 of MASTER_BUILD_BRIEF.md}}
KEY FIELDS DISPLAYED:
- {{field}} ({{type}}, {{format}})
- {{field}} ({{type}}, {{format}})
RELATED ENTITIES SHOWN: {{list with how they appear — inline, drawer, link}}
COMPUTED FIELDS: {{list with formula}}
```

## SECTION 4 — Layout

```
LAYOUT TEMPLATE (from ui-kit): {{AppShell | AuthShell | InstallerShell | ReportShell | PublicShell}}
PRIMARY REGIONS:
- Header: {{title, breadcrumbs, primary actions}}
- Toolbar / filter bar: {{search, filters, density toggle, export}}
- Main content: {{table | form | cards | chart grid | wizard steps}}
- Side panel / drawer: {{when, what shows}}
- Footer: {{pagination, save bar, system status}}
RESPONSIVE BEHAVIOUR AT 768px:
- {{describe collapse — e.g. filter bar → drawer, table → cards}}
```

## SECTION 5 — Actions

```
PRIMARY ACTIONS (max 3): {{e.g. Approve, Reject, Reassign}}
SECONDARY ACTIONS (max 5): {{e.g. Export, Print, Share, Subscribe, Audit Trail}}
ROW-LEVEL ACTIONS (if list): {{e.g. View, Edit, Delete, Duplicate}}
BULK ACTIONS (if list): {{e.g. Bulk approve, Bulk export}}
DESTRUCTIVE ACTIONS: {{list — must always show ConfirmDialog}}
KEYBOARD SHORTCUTS: {{e.g. Cmd+S save, Cmd+Enter submit, Esc close drawer}}
```

## SECTION 6 — States (all required)

```
DEFAULT STATE: {{what shows on first load with data}}
LOADING STATE: {{Skeleton variant: list-rows | card-grid | form-fields | chart}}
EMPTY STATE: {{component slot — icon, heading, body, primary CTA}}
ERROR STATE: {{ApiError envelope rendered via ErrorState component — heading, body, retry CTA}}
SUCCESS / CONFIRMATION STATE: {{Toast or Banner content}}
PARTIAL STATE (some sections loaded, some pending): {{describe}}
PERMISSION-DENIED STATE: {{what user sees when role lacks access}}
OFFLINE / RECONNECTING STATE (mobile only): {{N/A for web}}
```

## SECTION 7 — Accessibility (WCAG 2.2 AA — non-negotiable)

```
HEADING ORDER: {{h1 → h2 → h3 hierarchy described}}
LANDMARK ROLES: {{header, nav, main, aside, footer assignments}}
KEYBOARD ORDER: {{describe focus order — must match visual order}}
FOCUS VISIBLE: token shadow.focus on every focusable element
SCREEN READER LABELS:
- {{element}}: aria-label "{{exact text}}"
- {{element}}: aria-describedby "{{id of helper text}}"
LIVE REGIONS: {{any aria-live="polite" or "assertive" zones for toasts/alerts}}
CONTRAST: every text/UI pair must meet 4.5:1 (text) and 3:1 (large text + UI)
COLOR-NOT-ONLY: any status conveyed by color also uses icon + text
TOUCH TARGETS (mobile): minimum 44×44 px
```

## SECTION 8 — Theming and localisation

```
TENANT-OVERRIDABLE TOKENS USED: {{brand.primary, brand.secondary, brand.accent}}
DARK MODE: every region must render correctly with surface.canvas-dark, text.primary-dark
RTL: layout must mirror correctly — icons that imply direction must flip, dates/money must localise
LOCALES TO TEST: en-IN, hi-IN, ar-SA (RTL), or-IN (Odia), ta-IN, te-IN
DATE FORMAT: tenant-locale-aware (ICU)
NUMBER / MONEY FORMAT: tenant-locale-aware (ICU), money as ISO currency code + minor units
```

## SECTION 9 — Components (must come from ui-kit only)

```
ATOMS USED: {{Button, Input, Select, etc.}}
MOLECULES USED: {{FormField, SearchBar, Pagination, etc.}}
ORGANISMS USED: {{DataTable, DetailDrawer, ApprovalCard, etc.}}
TEMPLATE USED: {{AppShell, etc.}}
ANY NEW COMPONENT NEEDED?: {{yes/no — if yes, open ui-kit PR before designing}}
```

## SECTION 10 — Out of scope (do not generate)

```
- Custom illustrations beyond ui-kit empty-state slot
- Decorative animation beyond motion.fast / motion.base / motion.slow tokens
- Any color value outside the token set (no hex literals)
- Any font outside font.sans / font.mono
- Modal-within-modal (use drawer or wizard instead)
- Infinite scroll on data tables (use cursor pagination per Vol 4)
- Marketing copy (handled by tech writer)
```

## SECTION 11 — Linked artefacts

```
GITHUB ISSUE: {{link}}
FIGMA FILE: {{link to project file}}
FIGMA FRAME: {{filled after generation}}
ENGINEERING TICKET: {{linked after design approval}}
PARENT SPEC (Vol): {{which product_prompts/vol_*.md governs this screen}}
```

---

## Refinement prompt snippets (use after first generation)

Use these to iterate without restarting. Paste below the original prompt.

```
- "Replace all hex colors with semantic tokens from packages/ui-kit/tokens/color.json"
- "Swap any non-ui-kit component for the closest ui-kit equivalent — flag any missing component"
- "Add empty, loading, and error states beside the default state"
- "Show the dark mode variant of the same frame to the right of the default"
- "Show the RTL variant of the same frame below the default"
- "Add focus rings to every interactive element using shadow.focus token"
- "Collapse the layout to mobile (375px width) — show single column with drawer for filters"
- "Add ARIA labels and roles annotated on each component as Figma comments"
- "Add a density.compact variant of this screen below the default"
```
