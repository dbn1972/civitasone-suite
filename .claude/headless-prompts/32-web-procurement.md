# 32-web-procurement — Build Procurement Module Web Screens

## Context

You are building Next.js web screens for the Procurement module of CivitasOne, a government ERP platform.

### Pattern every screen MUST follow

1. **Server Component** — `apps/web/src/app/(app)/{module}/{screen}/page.tsx` — async function, calls a loader, renders JSX with Tailwind
2. **Loader** — added to `apps/web/src/app/_data/loaders.ts`
3. **Zod schema** — added to `packages/schemas/src/web.ts`
4. **Type** — added to `packages/types/src/index.ts`
5. **Components**: `PageShell`, `DataSourceBadge` from `@civitasone/ui-kit`
6. **Breadcrumb**: `<Link href="/procurement">Procurement</Link> / ScreenName`
7. **Stats row**: 4 `<div class="stat">` cards
8. **Table**: `<table class="tbl">` with thead + tbody
9. **Status pills**: `<span class="rounded-full bg-{color}-50 px-2 py-1 text-xs">status</span>`
10. **Error handling**: `{source === "error" ? <DataSourceBadge source={source} /> : null}`

### Gateway API prefixes
- procurement: `/api/v1/procurement`
- contract: `/api/v1/contract`

## Step 1 — Read existing patterns

Read:
```
apps/web/src/app/(app)/procurement/vendors/page.tsx
apps/web/src/app/(app)/procurement/orders/page.tsx
apps/web/src/app/(app)/procurement/approvals/page.tsx
apps/web/src/app/_data/loaders.ts
packages/schemas/src/web.ts
packages/types/src/index.ts
apps/web/src/app/(app)/procurement/page.tsx
```

Also read HTML prototypes from `~/CivitasOne/erpnext-develop/procurement-module/web/`:
- `dashboard.html`, `indents.html`, `vendors.html`, `vendor-detail.html`
- `rfq.html`, `rfq-detail.html`, `purchase-orders.html`, `po-detail.html`
- `goods-receipt.html`, `contracts.html`, `contract-detail.html`
- `purchase-approvals.html`, `tenders.html`, `tender-detail.html`

## Step 2 — Add Zod schemas to `packages/schemas/src/web.ts`

Append:

```typescript
// Procurement schemas
export const ProcurementDashboardSchema = z.object({
  pendingIndents: z.number().default(0),
  activePOs: z.number().default(0),
  grnsThisMonth: z.number().default(0),
  contractRenewalsDue: z.number().default(0),
});

export const IndentSummarySchema = z.object({
  id: z.string(),
  indentNo: z.string(),
  requestedBy: z.string(),
  department: z.string(),
  itemCount: z.number(),
  estimatedAmount: z.number(),
  requestDate: z.string(),
  requiredByDate: z.string().optional(),
  status: z.enum(["draft", "pending_approval", "approved", "rejected", "converted_to_po"]),
});
export const IndentSummaryListSchema = z.array(IndentSummarySchema);

export const IndentDetailSchema = IndentSummarySchema.extend({
  lineItems: z.array(z.object({
    itemCode: z.string(),
    itemName: z.string(),
    quantity: z.number(),
    unit: z.string(),
    estimatedUnitPrice: z.number(),
    totalPrice: z.number(),
  })).default([]),
  approvalTrail: z.array(z.object({
    actor: z.string(),
    action: z.string(),
    timestamp: z.string(),
    remarks: z.string().optional(),
  })).default([]),
});

export const VendorDetailSchema = z.object({
  id: z.string(),
  vendorCode: z.string(),
  name: z.string(),
  gstin: z.string().optional(),
  panNo: z.string().optional(),
  category: z.string(),
  empanelmentStatus: z.enum(["empanelled", "provisional", "blacklisted", "not_empanelled"]),
  rating: z.number().min(0).max(5).optional(),
  contactPerson: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  bankAccountNo: z.string().optional(),
  ifscCode: z.string().optional(),
});
export const VendorDetailListSchema = z.array(VendorDetailSchema);

export const RFQSummarySchema = z.object({
  id: z.string(),
  rfqNo: z.string(),
  title: z.string(),
  indentRef: z.string().optional(),
  vendorsInvited: z.number().default(0),
  responsesReceived: z.number().default(0),
  closingDate: z.string(),
  status: z.enum(["draft", "issued", "closed", "cancelled", "awarded"]),
});
export const RFQSummaryListSchema = z.array(RFQSummarySchema);

export const RFQDetailSchema = RFQSummarySchema.extend({
  description: z.string().optional(),
  lineItems: z.array(z.object({
    itemName: z.string(),
    quantity: z.number(),
    unit: z.string(),
  })).default([]),
  responses: z.array(z.object({
    vendorId: z.string(),
    vendorName: z.string(),
    totalAmount: z.number(),
    submittedAt: z.string(),
    status: z.string(),
  })).default([]),
});

export const GRNSummarySchema = z.object({
  id: z.string(),
  grnNo: z.string(),
  poRef: z.string(),
  vendor: z.string(),
  receivedDate: z.string(),
  receivedBy: z.string(),
  itemCount: z.number(),
  totalValue: z.number(),
  status: z.enum(["draft", "received", "quality_check", "accepted", "partially_rejected", "rejected"]),
});
export const GRNSummaryListSchema = z.array(GRNSummarySchema);

export const TenderSummarySchema = z.object({
  id: z.string(),
  tenderNo: z.string(),
  title: z.string(),
  type: z.enum(["open", "limited", "single_source", "gem"]),
  estimatedValue: z.number(),
  publishDate: z.string().optional(),
  bidClosingDate: z.string(),
  openingDate: z.string().optional(),
  status: z.enum(["draft", "published", "evaluation", "awarded", "cancelled"]),
  bidsReceived: z.number().default(0),
});
export const TenderSummaryListSchema = z.array(TenderSummarySchema);

export const TenderDetailSchema = TenderSummarySchema.extend({
  scope: z.string().optional(),
  eligibilityCriteria: z.string().optional(),
  bids: z.array(z.object({
    vendorId: z.string(),
    vendorName: z.string(),
    bidAmount: z.number(),
    technicalScore: z.number().optional(),
    financialScore: z.number().optional(),
    status: z.string(),
  })).default([]),
});
```

## Step 3 — Add types to `packages/types/src/index.ts`

Append:

```typescript
export type IndentSummary = {
  id: string;
  indentNo: string;
  requestedBy: string;
  department: string;
  itemCount: number;
  estimatedAmount: number;
  requestDate: string;
  requiredByDate?: string;
  status: "draft" | "pending_approval" | "approved" | "rejected" | "converted_to_po";
};

export type VendorDetail = {
  id: string;
  vendorCode: string;
  name: string;
  gstin?: string;
  panNo?: string;
  category: string;
  empanelmentStatus: "empanelled" | "provisional" | "blacklisted" | "not_empanelled";
  rating?: number;
  contactPerson?: string;
  email?: string;
  phone?: string;
  address?: string;
  bankAccountNo?: string;
  ifscCode?: string;
};

export type RFQSummary = {
  id: string;
  rfqNo: string;
  title: string;
  indentRef?: string;
  vendorsInvited: number;
  responsesReceived: number;
  closingDate: string;
  status: "draft" | "issued" | "closed" | "cancelled" | "awarded";
};

export type GRNSummary = {
  id: string;
  grnNo: string;
  poRef: string;
  vendor: string;
  receivedDate: string;
  receivedBy: string;
  itemCount: number;
  totalValue: number;
  status: "draft" | "received" | "quality_check" | "accepted" | "partially_rejected" | "rejected";
};

export type TenderSummary = {
  id: string;
  tenderNo: string;
  title: string;
  type: "open" | "limited" | "single_source" | "gem";
  estimatedValue: number;
  publishDate?: string;
  bidClosingDate: string;
  openingDate?: string;
  status: "draft" | "published" | "evaluation" | "awarded" | "cancelled";
  bidsReceived: number;
};
```

## Step 4 — Add loaders to `apps/web/src/app/_data/loaders.ts`

Append:

```typescript
export async function getProcurementDashboard() {
  return fetchJson("/api/v1/procurement/indents", {} as ProcurementDashboardSchema, {
    revalidateSeconds: 60,
    telemetryKey: "procurement.dashboard",
    responseSchema: ProcurementDashboardSchema,
  });
}

export async function getProcurementIndents() {
  return fetchJson("/api/v1/procurement/indents", [] as IndentSummary[], {
    revalidateSeconds: 60,
    telemetryKey: "procurement.indents",
    responseSchema: IndentSummaryListSchema,
  });
}

export async function getProcurementIndentById(id: string) {
  return fetchJson(`/api/v1/procurement/indents/${id}`, null, {
    revalidateSeconds: 30,
    telemetryKey: "procurement.indent.detail",
    responseSchema: IndentDetailSchema,
  });
}

export async function getProcurementVendors() {
  return fetchJson("/api/v1/procurement/vendors", [] as VendorDetail[], {
    revalidateSeconds: 300,
    telemetryKey: "procurement.vendors",
    responseSchema: VendorDetailListSchema,
  });
}

export async function getProcurementVendorById(id: string) {
  return fetchJson(`/api/v1/procurement/vendors/${id}`, null, {
    revalidateSeconds: 120,
    telemetryKey: "procurement.vendor.detail",
    responseSchema: VendorDetailSchema,
  });
}

export async function getRFQs() {
  return fetchJson("/api/v1/procurement/rfqs", [] as RFQSummary[], {
    revalidateSeconds: 60,
    telemetryKey: "procurement.rfqs",
    responseSchema: RFQSummaryListSchema,
  });
}

export async function getRFQById(id: string) {
  return fetchJson(`/api/v1/procurement/rfqs/${id}`, null, {
    revalidateSeconds: 30,
    telemetryKey: "procurement.rfq.detail",
    responseSchema: RFQDetailSchema,
  });
}

export async function getProcurementGRNs() {
  return fetchJson("/api/v1/procurement/grns", [] as GRNSummary[], {
    revalidateSeconds: 60,
    telemetryKey: "procurement.grns",
    responseSchema: GRNSummaryListSchema,
  });
}

export async function getProcurementTenders() {
  return fetchJson("/api/v1/procurement/tenders", [] as TenderSummary[], {
    revalidateSeconds: 120,
    telemetryKey: "procurement.tenders",
    responseSchema: TenderSummaryListSchema,
  });
}

export async function getProcurementTenderById(id: string) {
  return fetchJson(`/api/v1/procurement/tenders/${id}`, null, {
    revalidateSeconds: 60,
    telemetryKey: "procurement.tender.detail",
    responseSchema: TenderDetailSchema,
  });
}
```

## Step 5 — Build each page

### 5.1 `/procurement/dashboard/page.tsx`

- 4 stats: Pending Indents, Active POs, GRNs This Month, Contract Renewals Due
- Quick links to all sub-modules
- API: `getProcurementDashboard()`

### 5.2 `/procurement/indents/page.tsx`

- Table: Indent No, Requested By, Department, Item Count, Est. Amount (₹), Request Date, Required By, Status
- Status pills: draft=gray, pending_approval=yellow, approved=green, rejected=red, converted_to_po=blue
- 4 stats: Total, Pending Approval, Approved, Converted
- New Indent button (placeholder link `/procurement/indents/new`)

### 5.3 `/procurement/indents/[id]/page.tsx`

- Header detail section: Indent No, Department, Requested By, Dates, Status
- Line items table: Item Code, Item Name, Quantity, Unit, Est. Unit Price (₹), Total (₹)
- Approval trail timeline
- API: `getProcurementIndentById(params.id)`

### 5.4 Enhance `/procurement/vendors/page.tsx`

Read existing and update with:
- Table columns: Vendor Code, Name, GSTIN, Category, Empanelment Status, Rating (stars out of 5), Contact
- Empanelment status pills: empanelled=green, provisional=yellow, blacklisted=red, not_empanelled=gray
- Rating: display as numeric with /5 suffix
- Link from each row to `/procurement/vendors/[id]`

### 5.5 `/procurement/vendors/[id]/page.tsx`

- Profile card: all fields from VendorDetailSchema
- Bank details section
- API: `getProcurementVendorById(params.id)`

### 5.6 `/procurement/rfq/page.tsx`

- Table: RFQ No, Title, Indent Ref, Vendors Invited, Responses, Closing Date, Status
- Status pills: draft=gray, issued=blue, closed=gray, cancelled=red, awarded=green
- 4 stats: Total, Issued, Responses Received (sum), Awarded
- New RFQ button

### 5.7 `/procurement/rfq/[id]/page.tsx`

- Header: RFQ No, Title, Closing Date, Status
- Line items table
- Vendor responses table: Vendor Name, Bid Amount (₹), Submitted At, Status
- API: `getRFQById(params.id)`

### 5.8 Enhance `/procurement/orders/page.tsx`

Read existing and update:
- Table columns: PO No, Vendor, Amount (₹), Order Date, Delivery Date, GRN Status, Status
- Add vendor filter dropdown (client-side filter using URL search params)
- Status pills: draft=gray, approved=green, partial_grn=yellow, fully_received=blue, cancelled=red
- Link from each row to `/procurement/orders/[id]`

### 5.9 `/procurement/orders/[id]/page.tsx`

Create `apps/web/src/app/(app)/procurement/orders/[id]/page.tsx`:
- Add loader `getProcurementPOById(id: string)` → `GET /api/v1/procurement/pos/:id`
- Add PO detail schema with lineItems and GRN status summary
- Header: PO No, Vendor, Order Date, Total Amount, Status
- Line items table with GRN qty received
- API: loader

### 5.10 `/procurement/grn/page.tsx`

Create `apps/web/src/app/(app)/procurement/grn/page.tsx`:
- Table: GRN No, PO Ref, Vendor, Received Date, Received By, Items, Total Value (₹), Status
- Status pills: received=blue, quality_check=yellow, accepted=green, rejected=red, partially_rejected=orange-ish (amber)
- 4 stats: Total GRNs, Accepted, Pending QC, Rejected

### 5.11 `/procurement/tenders/page.tsx`

Create `apps/web/src/app/(app)/procurement/tenders/page.tsx`:
- Table: Tender No, Title, Type, Est. Value (₹), Publish Date, Bid Close Date, Bids, Status
- Type pills: open=blue, limited=purple, single_source=orange, gem=teal
- Status pills: draft=gray, published=green, evaluation=yellow, awarded=blue, cancelled=red
- 4 stats: Total, Published, Under Evaluation, Awarded

## Step 6 — Update `/procurement/page.tsx`

Add tiles for all sub-modules:
- Dashboard, Indents, Vendors, RFQ, Purchase Orders, GRN, Contracts, Tenders, Approvals

## Step 7 — Verification

```bash
cd ~/CivitasOne/civitasone-suite
pnpm --filter @civitasone/schemas typecheck
pnpm --filter @civitasone/web typecheck
```
