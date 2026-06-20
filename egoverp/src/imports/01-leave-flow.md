# HRMS — Leave Application + Approval

**SPRINT:** 7
**ROUTES:** `/hr/leave/apply`, `/hr/leave/my`, `/hr/leave/approvals`
**SERVICE OWNER:** hrms-service

---

## Figma Make prompt

```
Generate the Leave Application + Approval flow for CivitasOne Suite.

APPLY PAGE (/hr/leave/apply):
LAYOUT: FormPage shell
FIELDS:
- Leave type (Select — earned, casual, sick, comp-off, maternity, paternity, LWP)
- From date / To date (DatePicker range) — show calendar with holidays + existing leave overlaid
- Half-day toggle (first day / last day)
- Reason (Textarea, required)
- Contact during leave (Input, optional)
- Handover to (Combobox of employees, optional)
- Attachment (FileUpload — required for sick leave > 2 days)
LIVE BALANCE WIDGET (right side):
- Shows: Type, Entitlement, Used, Pending, Available
- Updates as leave type changes
SAVE BAR: Save draft, Submit for approval

MY LEAVES PAGE (/hr/leave/my):
LAYOUT: ListPage shell
- Cards / table of all leave applications by current user
- Filter by status, year, type
- Click → DetailDrawer with full application + approval history

APPROVAL PAGE (/hr/leave/approvals):
LAYOUT: ListPage shell with ApprovalCard organism
- Each card: employee avatar + name, leave type pill, dates, days, reason snippet
- Card actions: Approve, Reject (with required comment), Reassign (to other approver)
- Bulk approve checkbox
- Filter: my queue (default), my team, all (role-gated)

STATES:
- Empty (no leaves): cheerful empty state with "Apply leave" CTA
- Empty (approval queue): "All caught up!" with checkmark illustration
- Validation error (insufficient balance): inline Banner intent.danger
- Validation error (overlapping leave): inline Banner intent.warning

EVENTS EMITTED:
- hrms.leave.submitted (on apply)
- hrms.leave.approved → triggers attendance + payroll updates
- hrms.leave.rejected → notifies employee

PERMISSIONS:
- Apply: any employee
- Approve own team: People Manager
- Approve any: HR Manager (override with audit reason)

ACCESSIBILITY:
- Calendar widget keyboard-navigable (arrow keys, Page Up/Down for months)
- ApprovalCard actions reachable via Tab, with clear focus order

OUT OF SCOPE:
- Leave encashment (Phase 2)
- Comp-off accrual rules (Phase 2 — handled in policy)
```
