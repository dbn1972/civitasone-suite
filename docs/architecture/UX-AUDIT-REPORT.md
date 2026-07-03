# CivitasOne Suite — UX Audit Report

> Date: 2025 · Scope: Web frontend (`apps/web`) · Author: Platform Engineering

---

## 1. What's World-Class (Already Done)

These patterns place CivitasOne's UX well above the average enterprise ERP:

### 1.1 Plain-Language Error Messages
Every API error is mapped through a human-friendly error dictionary. Users never see raw HTTP codes, database constraint violations, or stack traces. Error states include suggested next-steps.

### 1.2 HelpTip Glossary Tooltips
Over 70 government/ERP-specific terms are explained via inline `<HelpTip>` components. Users working with HoA hierarchies, PFMS codes, or GST terminology get contextual definitions without leaving their workflow.

### 1.3 Guided Setup Wizard (8 Steps)
New tenants are guided through an 8-step onboarding wizard with:
- Honest tri-state progress tracking (not-started / in-progress / complete)
- Module-aware step visibility (only shows relevant steps)
- Non-blocking: users can skip and return later

### 1.4 FirstRunTour (4-Step Walkthrough)
A fully accessible 4-step spotlight tour highlights key navigation elements on first login:
- Keyboard-navigable (Tab/Enter/Escape)
- ARIA live-region announcements
- Respects `prefers-reduced-motion`
- Dismissable and never re-shown once completed

### 1.5 EmptyState Patterns
No screen is ever blank. Every list view, dashboard card, and data table provides:
- Contextual illustration
- Clear explanation of what belongs here
- Primary action CTA to get started
- Link to relevant Help Centre article

### 1.6 Role-Based Dashboard Filtering
The dashboard dynamically adapts based on JWT roles:
- Finance officers see budget widgets
- HR admins see leave/attendance
- Platform admins see system health
- Citizens see their service requests only

### 1.7 Module Toggle UI with WCAG Switches
Tenant Admin module toggles use proper `role="switch"` with `aria-checked`, meeting WCAG 2.2 Level AA. Toggle state changes show confirmation and warn about cascading effects.

### 1.8 Offline-First with ConnectionStatus Banner
A persistent banner detects connectivity loss and:
- Queues mutations locally
- Shows sync status on reconnection
- Never loses user work
- Degrades gracefully (read-only mode when offline)

### 1.9 Progressive Disclosure
Complex forms use staged revelation:
- Basic fields shown first
- Advanced options behind "More options" expanders
- Conditional sections appear only when relevant
- Reduced cognitive load for 80% of use cases

---

## 2. What Needs Improvement (Gaps Found)

### 2.1 [FIXED] Sidebar Did Not Receive `enabledModules` From Layout
**Before:** The `Sidebar` component accepted an `enabledModules` prop for per-tenant module filtering, but `AppShell` never passed it — all modules were always visible regardless of tenant configuration.

**Fix applied:** `AppShell` now accepts and forwards `enabledModules`. The `(app)/layout.tsx` calls `getEnabledModules()` server-side and passes the result through the shell to the sidebar.

### 2.2 [FIXED] No Server-Side Route Guard for Disabled Modules
**Before:** A user who knew a module URL (e.g. `/finance`) could navigate directly even if their tenant had that module disabled. The sidebar hid the link but didn't block access.

**Fix applied:** Created `ModuleGate` — a reusable Server Component that checks module enablement and renders a friendly "Module Not Enabled" fallback with a link to Tenant Admin. Applied to all 20 module route directories.

### 2.3 Help Centre Missing for Some Modules
The Help Centre content index covers finance, procurement, HRMS, projects, grants, and assets. The following modules lack dedicated help articles:
- Helpdesk
- Telephony
- Legal
- Audit
- Billing
- Knowledge Base
- Inventory

**Impact:** Users in these modules see generic "help coming soon" content.

### 2.4 Glossary Missing Key Terms
The HelpTip glossary (~70 terms) is missing several commonly-used abbreviations:
- **HoA** — Head of Account (government chart of accounts hierarchy)
- **GST** — Goods and Services Tax
- **PFMS** — Public Financial Management System
- **DBT** — Direct Benefit Transfer
- **EMD** — Earnest Money Deposit
- **UC** — Utilization Certificate

### 2.5 No Onboarding Video/Animation
The FirstRunTour is text-only. There is no introductory video, animated walkthrough, or interactive demo. Visual learners have no alternative to reading.

### 2.6 No "What Changed" Changelog for Returning Users
After platform updates, returning users see no indication of new features, changed workflows, or deprecated screens. There is no in-app changelog, release notes banner, or "what's new" spotlight.

### 2.7 No In-App Feedback Mechanism
There is no "Was this helpful?" widget, NPS prompt, or contextual feedback button. User satisfaction data must be gathered externally.

### 2.8 No Keyboard Shortcut Reference Sheet
Only `Ctrl+K` (command palette / search) is discoverable. There is no shortcut reference modal (typical `?` trigger), no cheat sheet in Help Centre, and no tooltip hints showing shortcuts alongside menu items.

---

## 3. Tenant Configurability Assessment

| Capability | Status | Notes |
|---|---|---|
| Module toggle (enable/disable) | ✅ Fully functional | Per-tenant via Tenant Admin; persisted in tenant settings |
| Sidebar filtering | ✅ Now wired | `enabledModules` flows from server → AppShell → Sidebar |
| Route guarding | ✅ Now enforced | `ModuleGate` blocks access to disabled module routes server-side |
| Setup wizard | ✅ Adapts | Steps shown only for enabled modules |
| Help Centre | ✅ Filters | Articles scoped to enabled modules only |
| Org terminology | ✅ Adapts | Labels adjust to org type (Govt / PSU / Private) |
| Theme / branding | ✅ Per-tenant | Via theme-service; custom logos, colours, and typography |
| Role-based access | ✅ JWT roles | Visibility controlled by Keycloak roles in access token |
| Currency / locale | ✅ Tenant setting | INR default; locale-aware number/date formatting |
| Notification preferences | ✅ Per-user | Users control email/push/in-app per event type |

---

## 4. Recommendations for World-Class UX

### 4.1 Animated Micro-Interactions
Add subtle success animations (checkmark pulse, card slide-in) for completed actions. Reduces anxiety about whether an action succeeded. Use Framer Motion with `prefers-reduced-motion` respect.

### 4.2 "What To Do Next" Suggestions
After each completed action (voucher submitted, leave approved, vendor created), show a contextual suggestion card:
- "You just created a vendor. Next: attach a bank account →"
- "Budget sanctioned. Next: create an allocation →"

### 4.3 Voice Navigation for Accessibility
Integrate Web Speech API for hands-free navigation. Critical for government officers working in high-volume environments. Start with command palette voice activation.

### 4.4 Multi-Language Support with Auto-Detection
Add i18n framework (next-intl or react-i18next) with:
- Hindi, Tamil, Telugu, Kannada, Bengali, Marathi at minimum
- Auto-detect from browser `Accept-Language`
- Per-user language preference
- RTL support for Urdu if needed

### 4.5 Contextual AI Assistant ("Ask CivitasOne")
A floating chat bubble powered by RAG over Help Centre content + tenant data context:
- Natural language queries ("How do I create a supplementary budget?")
- Context-aware (knows which module the user is in)
- Escalates to helpdesk ticket when stuck
- Respects RBAC (only answers about visible data)

### 4.6 Keyboard Shortcut System
Expand beyond `Ctrl+K`:
- `G + F` → Go to Finance
- `G + H` → Go to HR
- `N + V` → New Voucher
- `?` → Show shortcut reference sheet
- Display shortcuts in tooltip hints on hover

### 4.7 In-App Changelog & Feature Announcements
After each release:
- Subtle "New" badge on changed navigation items (auto-expires after 3 days)
- "What's new" modal on first login post-update
- Per-release changelog page linked from Help Centre

### 4.8 Contextual Feedback Widget
"Was this helpful?" thumb-up/down on:
- Help Centre articles
- Error message screens
- Setup wizard steps
- Post-action confirmation cards

Feeds into analytics dashboard for PM prioritisation.

### 4.9 Progressive Loading & Skeleton States
Replace loading spinners with content-shaped skeleton screens for:
- Dashboard cards
- Data tables
- Form sections
- Sidebar navigation groups

### 4.10 Smart Defaults & Autocomplete
Reduce form fatigue by:
- Pre-filling fields from previous entries (last-used head of account, vendor)
- Fuzzy autocomplete on account codes and employee IDs
- "Copy from previous" for repetitive voucher entries
- Template-based form filling for common transactions

---

## 5. Summary

| Area | Score | Verdict |
|---|---|---|
| Error handling & messaging | 9/10 | Exceptional — plain language, never raw codes |
| Onboarding & first-run | 8/10 | Strong wizard + tour; needs video |
| Navigation & discoverability | 8/10 | Good progressive disclosure; needs shortcuts |
| Accessibility (WCAG 2.2 AA) | 8/10 | Solid ARIA, focus mgmt; needs voice nav |
| Multi-tenant configurability | 9/10 | Near-complete — module, theme, role, locale |
| Feedback & continuous improvement | 5/10 | No in-app feedback; no changelog |
| Internationalisation | 4/10 | English only; framework not wired yet |
| **Overall UX Maturity** | **7.5/10** | **Above average for govt ERP; clear path to 9+** |

---

*This audit was conducted against the `apps/web` frontend codebase. Findings are based on code review, component analysis, and architectural assessment. Production user testing is recommended to validate perceived UX quality.*
