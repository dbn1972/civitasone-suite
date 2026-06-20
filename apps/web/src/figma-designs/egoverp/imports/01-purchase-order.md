# Procurement — Purchase Order Flow

**SPRINT:** 6
**ROUTES:** `/procurement/orders` (list), `/procurement/orders/new` (create), `/procurement/orders/{id}` (view)
**SERVICE OWNER:** procurement-service
**ENTITY:** procurement_purchase_orders + procurement_po_lines

---

## Figma Make prompt

```
Generate the Purchase Order screens (list + create + view) for CivitasOne Suite.

PURPOSE: Manage vendor purchase orders end-to-end with three-way match support
(PO → GRN → Invoice). Source: skill procurement-workflows.

LIST PAGE (/procurement/orders):
LAYOUT: ListPage shell
- Header: "Purchase Orders", primary action "New PO"
- Toolbar: SearchBar (by PO number, vendor), FilterBar (status: draft / pending approval /
  approved / partially received / received / cancelled; vendor; date range), density toggle, export
- DataTable columns: PO Number, Vendor, Date, Status (pill), Total, Currency, Approver, Actions
- Row click → /procurement/orders/{id}
- Bulk actions: Bulk approve (for users with Procurement Manager role)

CREATE PAGE (/procurement/orders/new):
LAYOUT: FormPage shell with sticky save bar
HEADER FIELDS:
- Vendor (Combobox, required — pulls from procurement_vendors)
- Delivery address (Select from tenant addresses)
- Expected delivery date (DatePicker)
- Cost center / project (Combobox, optional)
- Terms (Textarea)
LINES TABLE:
- Columns: Item (Combobox from inventory-service), Description, Qty, UOM, Unit price,
           Tax code, Line total
- Add line / delete line / reorder
- Footer row: Subtotal, Tax total, Grand total
SAVE BAR:
- Save as draft (secondary)
- Submit for approval (primary, disabled until vendor + ≥1 valid line)

VIEW PAGE (/procurement/orders/{id}):
LAYOUT: DetailPage shell with tabs
TABS:
- Overview (all fields read-only, status pill at top)
- Lines (table of items with received quantity tracking)
- Receipts (list of GRNs against this PO, click → GRN detail)
- Invoices (list of supplier invoices matched, three-way match status indicator)
- Audit trail (timeline of all events)
ACTIONS (in header, role-gated):
- Approve / Reject (if status = pending approval, role = Procurement Manager)
- Cancel (with ConfirmDialog + audit comment, only before any GRN posted)
- Print / Export PDF
- Create GRN (only if status = approved)

STATES:
- All from master template
- Special: "Partially received" status shows progress bar (received qty / ordered qty)
- Three-way match indicators on Invoices tab: matched (success), variance (warning), unmatched (danger)

EVENTS EMITTED:
- procurement.purchase_order.approved → triggers finance.commitment.created

PERMISSIONS:
- Create / Edit: Procurement Clerk
- Approve: Procurement Manager (or based on approval matrix from policy-service)
- Cancel: Procurement Manager + audit comment

OUT OF SCOPE:
- Sub-contracting orders (Phase 2)
- Drop-ship PO (Phase 2)
- E-tender integration (Govt edition Phase 2)
```
