# HRMS & Payroll — UX Audit Report

**Audit date:** August 2026  
**Reviewed by:** AI UX Engineer (code-level review, no live-stack runtime)  
**Scope:** All HRMS and Payroll web pages under `/hr/*`

---

## Executive Summary

The HRMS/Payroll UX is **better than most government ERP systems** — the design system
is thoughtful, offline-first is implemented, and maker-checker patterns are proper. But
it's not yet **world-class** by private-sector standards (think Gusto, Rippling, BambooHR).

**Score: 7.5/10** — Functional and accessible, but not yet delightful or effortless.

---

## What's Already World-Class ✅

### 1. Leave Application Form (ApplyLeaveForm.tsx)
- Progressive disclosure: loads leave context per-employee
- Real-time duration calculation
- Inline balance check (prevents over-application)
- Offline queue support via `fetchOrQueue`
- ARIA live regions for success/error feedback
- Form resets after successful submit

### 2. Payroll Run Lifecycle (PayrollRunActions.tsx)
- Visual status stepper (Draft → Processing → Approved → Disbursed)
- ConfirmDialog with: focus trap, Escape key, overlay dismiss
- Maker-checker: reason required before irreversible actions
- Context-rich confirmation ("₹12,00,000 to 150 employees")
- Busy state disables confirm while processing

### 3. DataTable Component
- Sort, filter, paginate, export CSV
- Keyboard-navigable rows (Enter/Space)
- Integrated EmptyState with contextual CTA
- aria-sort on column headers
- Responsive pagination with screen-reader annotations

### 4. ConfirmDialog
- Full WCAG 2.2 AA: alertdialog role, focus management, Tab trap
- Required reason input for audit trail
- Error message in aria-live region
- Overlay click + ESC key to cancel

### 5. Offline-First (EmployeesTable)
- `useSeededResource` serves cached data when offline
- Cache timestamp displayed to user
- Graceful "you're offline" indicator

---

## What Needs Improvement 🔶

### P0 — Critical UX Issues (Fix Before Launch)

#### 1. Transfer/Promotion Forms Expose Raw UUIDs
**File:** `TransferWithApproval.tsx`, `PromoteWithApproval.tsx`  
**Problem:** Users must enter raw UUIDs for departments, designations, and eOffice operators.  
**Impact:** No real user can complete this task without developer assistance.  
**Fix:** Replace text inputs with searchable dropdowns that fetch departments/designations/operators by name. Auto-fill "From" based on employee's current data.

#### 2. HR Hub is a Wall of 72 Tiles
**File:** `apps/web/src/app/(app)/hr/page.tsx`  
**Problem:** 72 `LinkTiles` in a flat grid with tiny descriptions. A first-time user faces decision paralysis.  
**Impact:** Users will avoid the hub and rely on bookmarks or muscle memory. New users can't find anything.  
**Fix options:**
- Group into collapsible accordion sections (Core, Leave, Payroll, Recruitment, etc.)
- Add a search/filter at the top of the hub
- Show only the user's 8 most-used tiles + "Show all" expand
- Use role-based filtering (employee sees only self-service tiles)

### P1 — Important UX Issues

#### 3. No Toast Notifications
**Problem:** Success messages appear as inline text that's easy to miss. No auto-dismiss toast.  
**Impact:** User uncertainty — "did my action actually work?"  
**Fix:** Add a `<Toast>` component (already in DS: `Toast.tsx` exists!) and trigger it on all successful mutations.

#### 4. No Step Indicator on Complex Forms
**Files:** TransferWithApproval (7 fields), PromoteWithApproval (8 fields)  
**Problem:** All fields shown at once. No sense of progress.  
**Fix:** Group into 2-3 steps: Employee → Details → Justification & Submit.

#### 5. Employee Detail Lacks Quick Actions
**File:** `employees/[id]/page.tsx`  
**Problem:** Profile is read-only display. To do anything (apply leave, initiate transfer) user must navigate away and start fresh.  
**Fix:** Add contextual action buttons: "Apply Leave for this employee", "Initiate Transfer", "View Salary Slip".

#### 6. No Undo for Reversible Actions
**Problem:** After submitting a leave request, there's no "Cancel" option visible. User must navigate to approvals and reject their own request.  
**Fix:** For pending/draft items, show an "Undo" or "Cancel" action in the success toast.

### P2 — Polish & Delight

#### 7. Inconsistent Breadcrumbs
- Leave form: custom Tailwind breadcrumb (HR > Leave > Apply)
- Employee detail: PageHeader `back` link (← Back)
- Payroll structures: PageHeader `back` link
- Dashboard: no breadcrumb at all

**Fix:** Standardize on a single breadcrumb component for all pages.

#### 8. No Animation on State Transitions
**Problem:** Payroll status changes from "draft" to "approved" with no visual celebration.  
**Fix:** Subtle confetti/check animation on approval. Progress bar animation on stepper advancement.

#### 9. Data Table Date Formatting
**Problem:** Dates shown as ISO strings (2024-07-15) instead of Indian locale (15 Jul 2024).  
**Fix:** Apply `formatIndianDate()` consistently in all table columns showing dates.

#### 10. No Keyboard Shortcuts for Power Users
**Problem:** Payroll officers processing 150+ salary slips have no shortcuts.  
**Fix:** Add `Cmd+K` search, `n` for new, `a` for approve in list views.

---

## Design Principles for World-Class ERP UX

1. **Understand then act** — Always show context/summary before asking for a decision
2. **Error prevention > error correction** — Show balance at leave type selection, not after submit
3. **One primary action per screen** — The most important button should be obvious
4. **Progressive disclosure** — Show what's needed now, hide what's needed later
5. **Every dead end is a failure** — Always offer a next step (retry, back, help)
6. **Confirm the irreversible, skip the trivial** — ConfirmDialog for disburse, not for save-draft
7. **Show the human impact** — "₹12L to 150 people" is better than "Process payroll run"
8. **Match mental models** — Government officers think in "files" and "notings", not "UUIDs"

---

## Benchmark Comparison

| Dimension | CivitasOne Now | World-Class (Gusto/Rippling) |
|-----------|---------------|------------------------------|
| Task completion time | ~4 clicks + UUID typing | ~2 clicks + autocomplete |
| Error recovery | Inline text | Toast + undo + retry |
| First-use experience | 72-tile wall | Guided onboarding wizard |
| Maker-checker UX | ✅ Excellent | ✅ Same level |
| Offline resilience | ✅ Excellent | Rarely implemented |
| Accessibility | ✅ Strong | ✅ Strong |
| Visual feedback | Minimal | Animations + toasts |
| Mobile responsiveness | Adequate | Thumb-zone optimized |

---

## Recommendations (Priority Order)

1. Replace UUID inputs with searchable name dropdowns (Transfer/Promotion)
2. Add search/filter to HR hub + role-based tile filtering
3. Wire up Toast component for all mutation feedback
4. Add contextual actions to Employee detail page
5. Standardize breadcrumb navigation across all pages
6. Convert Transfer/Promotion to multi-step wizard
7. Add keyboard shortcuts for payroll officers
8. Animate status stepper transitions
