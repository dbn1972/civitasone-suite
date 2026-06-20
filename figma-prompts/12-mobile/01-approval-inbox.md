# Mobile — Approval Inbox (Flutter)

**SPRINT:** 11
**PLATFORM:** Flutter mobile (iOS + Android)
**SCREEN:** ApprovalInboxScreen (lib/main.dart → /approvals)

---

## Figma Make prompt

```
Generate the Approval Inbox screen for CivitasOne Suite mobile app.

PURPOSE: Single screen where a manager / approver sees ALL pending approvals
across modules (leave, expense, PO, payment, ticket reassignment) and can act
in seconds. Optimised for on-the-go decisions.

LAYOUT:
- Status bar (system)
- App bar: title "Approvals", filter icon, count badge
- Segmented control: All | Today | Overdue
- Tab bar (horizontal scroll): All | Leave | Expense | PO | Payment | Helpdesk
- Scrollable list of ApprovalCard items
- Pull-to-refresh
- Empty state: "All caught up!" with checkmark illustration

APPROVAL CARD:
- Module pill (top-left) with icon + color (Leave / Expense / PO / etc.)
- SLA chip (top-right) with color: green / amber / red countdown
- Requester avatar + name + role
- Summary line: "{type} for {amount or duration} on {dates}"
- Two-line preview of details
- Three buttons (large, thumb-reachable):
  - Approve (intent.success, leading icon check)
  - Reject (intent.danger, leading icon X) — opens bottom sheet for required comment
  - Review (tertiary, opens full detail drawer)
- Long-press → context menu: Reassign, Delegate, Add note, Open in web

DETAIL DRAWER:
- Slide up from bottom
- Full details + attachments
- Audit trail expandable
- Same three buttons sticky at bottom

GESTURES:
- Swipe right → Approve (with haptic + undo Toast)
- Swipe left → Reject (opens comment sheet)
- Tap card → Detail drawer

STATES:
- Default
- Empty: cheerful illustration + "You're all caught up"
- Loading: shimmer cards (3)
- Error: ErrorState with retry CTA
- Offline: Banner at top "You're offline — actions will sync when reconnected"
  Approve / Reject queued locally and sync on reconnect

PERMISSIONS:
- Inbox shows only approvals assigned to the current user
- Reassign requires team-lead role

OFFLINE:
- Local SQLite cache of last 50 approval cards
- Outbox queue for actions taken offline (visible in app bar with count)
- Conflict resolution: on sync, if server state changed, show resolution sheet

ACCESSIBILITY:
- Large touch targets (≥ 44 dp)
- Voice-over labels include module + requester + amount + SLA
- Approve / Reject buttons announce confirmation
- Supports system text scaling up to 200%

THEMING:
- Material 3 with CivitasOne tenant brand color seeded
- Dark mode honors system preference + per-user override

LOCALISATION:
- en-IN, hi-IN, ar-SA (RTL), or-IN, ta-IN, te-IN
- Dates / money / durations formatted via intl package

OUT OF SCOPE:
- Voice approval (Phase 2)
- Biometric step-up for high-value approvals (Phase 2)
```
