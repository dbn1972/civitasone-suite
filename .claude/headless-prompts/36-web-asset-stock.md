# 36-web-asset-stock — Build Asset Management + Stock/Inventory Screens

## Context

CivitasOne government ERP — Next.js screens for Asset Management and Stock/Inventory modules.

### Pattern every screen MUST follow

1. Server Component — async function, loader, JSX with Tailwind
2. Loader in `apps/web/src/app/_data/loaders.ts` using `fetchJson`
3. Zod schema in `packages/schemas/src/web.ts`
4. Type in `packages/types/src/index.ts`
5. `PageShell`, `DataSourceBadge` from `@civitasone/ui-kit`
6. Breadcrumb, 4 Stats cards, `<table class="tbl">`, status pills, error badge

### Gateway API prefixes
- asset: `/api/v1/asset`
- stock: `/api/v1/stock`
- inventory: `/api/v1/inventory`

## Step 1 — Read existing files

```
apps/web/src/app/(app)/assets/list/page.tsx
apps/web/src/app/(app)/stock/list/page.tsx
apps/web/src/app/(app)/inventory/list/page.tsx
apps/web/src/app/_data/loaders.ts
packages/schemas/src/web.ts
packages/types/src/index.ts
apps/web/src/app/(app)/assets/page.tsx
apps/web/src/app/(app)/stock/page.tsx
```

Also read HTML prototypes:
- ALL files from `~/CivitasOne/erpnext-develop/asset-module/web/`
- `~/CivitasOne/erpnext-develop/civitasone-screens/web/assets.html`
- `~/CivitasOne/erpnext-develop/civitasone-screens/web/stock.html`

## Step 2 — Add Zod schemas to `packages/schemas/src/web.ts`

Append:

```typescript
// Asset schemas
export const AssetDashboardSchema = z.object({
  totalAssets: z.number().default(0),
  underMaintenance: z.number().default(0),
  dueForDisposal: z.number().default(0),
  netBlock: z.number().default(0),
});

export const AssetSummarySchema = z.object({
  id: z.string(),
  assetCode: z.string(),
  name: z.string(),
  category: z.string(),
  type: z.enum(["fixed", "infra", "movable", "it", "vehicle", "other"]),
  purchaseDate: z.string(),
  purchaseCost: z.number(),
  currentValue: z.number(),
  location: z.string().optional(),
  assignedTo: z.string().optional(),
  department: z.string().optional(),
  status: z.enum(["active", "in_use", "maintenance", "disposed", "condemned"]),
  condition: z.enum(["excellent", "good", "fair", "poor"]).optional(),
});
export const AssetSummaryListSchema = z.array(AssetSummarySchema);

export const AssetDetailSchema = AssetSummarySchema.extend({
  description: z.string().optional(),
  serialNo: z.string().optional(),
  warrantyExpiry: z.string().optional(),
  depreciationSchedule: z.array(z.object({
    year: z.number(),
    openingValue: z.number(),
    depreciationAmount: z.number(),
    closingValue: z.number(),
    rate: z.number(),
  })).default([]),
  maintenanceHistory: z.array(z.object({
    id: z.string(),
    date: z.string(),
    type: z.string(),
    description: z.string(),
    cost: z.number(),
    vendor: z.string().optional(),
  })).default([]),
});

export const MaintenanceSummarySchema = z.object({
  id: z.string(),
  assetId: z.string(),
  assetCode: z.string(),
  assetName: z.string(),
  maintenanceType: z.enum(["preventive", "corrective", "amc", "breakdown"]),
  scheduledDate: z.string(),
  completedDate: z.string().optional(),
  vendor: z.string().optional(),
  estimatedCost: z.number().default(0),
  actualCost: z.number().default(0),
  status: z.enum(["scheduled", "in_progress", "completed", "cancelled", "overdue"]),
  remarks: z.string().optional(),
});
export const MaintenanceSummaryListSchema = z.array(MaintenanceSummarySchema);

// Stock schemas
export const StockDashboardSchema = z.object({
  totalSKUs: z.number().default(0),
  lowStockAlerts: z.number().default(0),
  grnsThisMonth: z.number().default(0),
  inventoryValue: z.number().default(0),
});

export const StockItemSummarySchema = z.object({
  id: z.string(),
  itemCode: z.string(),
  name: z.string(),
  category: z.string(),
  unit: z.string(),
  currentStock: z.number(),
  minStockLevel: z.number().default(0),
  maxStockLevel: z.number().optional(),
  unitCost: z.number(),
  totalValue: z.number(),
  warehouseLocation: z.string().optional(),
  isLowStock: z.boolean().default(false),
  lastReceivedDate: z.string().optional(),
  lastIssuedDate: z.string().optional(),
});
export const StockItemSummaryListSchema = z.array(StockItemSummarySchema);

export const StockItemDetailSchema = StockItemSummarySchema.extend({
  description: z.string().optional(),
  hsnCode: z.string().optional(),
  gstRate: z.number().optional(),
  stockLedger: z.array(z.object({
    id: z.string(),
    date: z.string(),
    type: z.enum(["receipt", "issue", "transfer", "adjustment"]),
    quantity: z.number(),
    unitCost: z.number(),
    totalValue: z.number(),
    referenceNo: z.string().optional(),
    party: z.string().optional(),
    balance: z.number(),
  })).default([]),
});

export const StockLedgerEntrySchema = z.object({
  id: z.string(),
  itemCode: z.string(),
  itemName: z.string(),
  date: z.string(),
  type: z.enum(["receipt", "issue", "transfer", "adjustment"]),
  quantity: z.number(),
  unitCost: z.number(),
  totalValue: z.number(),
  referenceNo: z.string().optional(),
  party: z.string().optional(),
  warehouseLocation: z.string().optional(),
  balance: z.number(),
});
export const StockLedgerEntryListSchema = z.array(StockLedgerEntrySchema);
```

## Step 3 — Add types to `packages/types/src/index.ts`

Append:

```typescript
export type AssetSummary = {
  id: string;
  assetCode: string;
  name: string;
  category: string;
  type: "fixed" | "infra" | "movable" | "it" | "vehicle" | "other";
  purchaseDate: string;
  purchaseCost: number;
  currentValue: number;
  location?: string;
  assignedTo?: string;
  department?: string;
  status: "active" | "in_use" | "maintenance" | "disposed" | "condemned";
  condition?: "excellent" | "good" | "fair" | "poor";
};

export type AssetDetail = AssetSummary & {
  description?: string;
  serialNo?: string;
  warrantyExpiry?: string;
  depreciationSchedule: Array<{
    year: number;
    openingValue: number;
    depreciationAmount: number;
    closingValue: number;
    rate: number;
  }>;
  maintenanceHistory: Array<{
    id: string;
    date: string;
    type: string;
    description: string;
    cost: number;
    vendor?: string;
  }>;
};

export type MaintenanceSummary = {
  id: string;
  assetId: string;
  assetCode: string;
  assetName: string;
  maintenanceType: "preventive" | "corrective" | "amc" | "breakdown";
  scheduledDate: string;
  completedDate?: string;
  vendor?: string;
  estimatedCost: number;
  actualCost: number;
  status: "scheduled" | "in_progress" | "completed" | "cancelled" | "overdue";
  remarks?: string;
};

export type StockItemSummary = {
  id: string;
  itemCode: string;
  name: string;
  category: string;
  unit: string;
  currentStock: number;
  minStockLevel: number;
  maxStockLevel?: number;
  unitCost: number;
  totalValue: number;
  warehouseLocation?: string;
  isLowStock: boolean;
  lastReceivedDate?: string;
  lastIssuedDate?: string;
};

export type StockLedgerEntry = {
  id: string;
  itemCode: string;
  itemName: string;
  date: string;
  type: "receipt" | "issue" | "transfer" | "adjustment";
  quantity: number;
  unitCost: number;
  totalValue: number;
  referenceNo?: string;
  party?: string;
  warehouseLocation?: string;
  balance: number;
};
```

## Step 4 — Add loaders

Append to `apps/web/src/app/_data/loaders.ts`:

```typescript
export async function getAssetDashboard() {
  return fetchJson("/api/v1/asset/assets", {} as AssetDashboardSchema, {
    revalidateSeconds: 120, telemetryKey: "assets.dashboard", responseSchema: AssetDashboardSchema,
  });
}

export async function getAssets() {
  return fetchJson("/api/v1/asset/assets", [] as AssetSummary[], {
    revalidateSeconds: 120, telemetryKey: "assets.list", responseSchema: AssetSummaryListSchema,
  });
}

export async function getAssetById(id: string) {
  return fetchJson(`/api/v1/asset/assets/${id}`, null, {
    revalidateSeconds: 60, telemetryKey: "assets.detail", responseSchema: AssetDetailSchema,
  });
}

export async function getFixedAssets() {
  return fetchJson("/api/v1/asset/assets", [] as AssetSummary[], {
    revalidateSeconds: 120, telemetryKey: "assets.fixed", responseSchema: AssetSummaryListSchema,
  });
}

export async function getInfraAssets() {
  return fetchJson("/api/v1/asset/assets", [] as AssetSummary[], {
    revalidateSeconds: 120, telemetryKey: "assets.infra", responseSchema: AssetSummaryListSchema,
  });
}

export async function getAssetMaintenance() {
  return fetchJson("/api/v1/asset/maintenance", [] as MaintenanceSummary[], {
    revalidateSeconds: 120, telemetryKey: "assets.maintenance", responseSchema: MaintenanceSummaryListSchema,
  });
}

export async function getStockDashboard() {
  return fetchJson("/api/v1/stock/items", {} as StockDashboardSchema, {
    revalidateSeconds: 60, telemetryKey: "stock.dashboard", responseSchema: StockDashboardSchema,
  });
}

export async function getStockItems() {
  return fetchJson("/api/v1/stock/items", [] as StockItemSummary[], {
    revalidateSeconds: 60, telemetryKey: "stock.items", responseSchema: StockItemSummaryListSchema,
  });
}

export async function getStockItemById(id: string) {
  return fetchJson(`/api/v1/stock/items/${id}`, null, {
    revalidateSeconds: 30, telemetryKey: "stock.item.detail", responseSchema: StockItemDetailSchema,
  });
}

export async function getStockLedger() {
  return fetchJson("/api/v1/stock/ledger", [] as StockLedgerEntry[], {
    revalidateSeconds: 60, telemetryKey: "stock.ledger", responseSchema: StockLedgerEntryListSchema,
  });
}
```

## Step 5 — Build each page

### 5.1 `/assets/dashboard/page.tsx`

- 4 stats: Total Assets, Under Maintenance, Due for Disposal (condemned count), Net Block (₹)
- Quick links to all sub-pages: Asset List, Fixed Assets, Infrastructure, Maintenance
- API: `getAssetDashboard()`

### 5.2 Enhance `/assets/list/page.tsx`

Read existing and update:
- Table columns: Asset Code, Name, Category, Type, Purchase Date, Purchase Cost (₹), Current Value (₹), Location, Dept, Status, Condition
- Status pills: active=green, in_use=blue, maintenance=yellow, disposed=gray, condemned=red
- Condition: excellent=green, good=blue, fair=yellow, poor=red
- Type filter dropdown
- Stats: Total, Active, Under Maintenance, Total Net Block (₹)
- Link from each row to `/assets/[id]`

### 5.3 `/assets/[id]/page.tsx`

Create `apps/web/src/app/(app)/assets/[id]/page.tsx`:
- Header: Asset Code, Name, Category, Type, Status, Condition
- Details card: Purchase Date, Purchase Cost, Current Value, Serial No, Warranty Expiry, Location, Assigned To, Department
- Depreciation Schedule table: Year, Opening Value (₹), Depreciation (₹), Rate %, Closing Value (₹)
- Maintenance History table: Date, Type, Description, Cost (₹), Vendor
- API: `getAssetById(params.id)`

### 5.4 `/assets/fixed-assets/page.tsx`

Create `apps/web/src/app/(app)/assets/fixed-assets/page.tsx`:
- Note at top: "Showing assets of type: fixed"
- Same table as asset list but filtered to type=fixed
- API: `getFixedAssets()` (caller should note these will be client-filtered from full list if API doesn't support query params)
- Client-side filter: `items.filter(a => a.type === "fixed")`

### 5.5 `/assets/maintenance/page.tsx`

Create `apps/web/src/app/(app)/assets/maintenance/page.tsx`:
- Table: Asset Code, Asset Name, Maintenance Type, Scheduled Date, Completed Date, Vendor, Est. Cost (₹), Actual Cost (₹), Status
- Type pills: preventive=blue, corrective=orange, amc=green, breakdown=red
- Status pills: scheduled=blue, in_progress=yellow, completed=green, cancelled=gray, overdue=red
- Stats: Total, Scheduled, Overdue, Completed

### 5.6 `/assets/infra/page.tsx`

Create `apps/web/src/app/(app)/assets/infra/page.tsx`:
- Same as fixed-assets but filter to type=infra
- Title: "Infrastructure Assets"

### 5.7 `/stock/dashboard/page.tsx`

Create `apps/web/src/app/(app)/stock/dashboard/page.tsx`:
- 4 stats: Total SKUs, Low Stock Alerts, GRNs This Month, Total Inventory Value (₹)
- Low stock alert banner (if lowStockAlerts > 0): show count with link to filtered list
- Quick links: Stock List, Stock Ledger

### 5.8 Enhance `/stock/list/page.tsx`

Read existing and update:
- Table columns: Item Code, Name, Category, Unit, Current Stock, Min Level, Unit Cost (₹), Total Value (₹), Warehouse, Status
- Status: if isLowStock → show red "Low Stock" badge, else green "OK"
- Low stock rows: highlight with subtle red background `bg-red-50`
- Stats: Total SKUs, Low Stock Items, Total Value (₹), Categories count

### 5.9 `/stock/[id]/page.tsx`

Create `apps/web/src/app/(app)/stock/[id]/page.tsx`:
- Header: Item Code, Name, Category, Unit
- Details card: Current Stock, Min Level, Max Level, Unit Cost, Total Value, GST Rate, HSN Code, Warehouse
- Stock Ledger table: Date, Type, Quantity, Unit Cost (₹), Total Value (₹), Reference, Party, Balance
- Type pills: receipt=green, issue=red, transfer=blue, adjustment=yellow
- API: `getStockItemById(params.id)`

### 5.10 `/stock/ledger/page.tsx`

Create `apps/web/src/app/(app)/stock/ledger/page.tsx`:
- Table: Item Code, Item Name, Date, Type, Quantity, Unit Cost (₹), Total Value (₹), Reference, Party, Balance
- Type pills: receipt=green, issue=red, transfer=blue, adjustment=yellow
- Stats: Total Entries, Total Receipts (₹), Total Issues (₹), Net Balance (₹)

### 5.11 `/inventory/list/page.tsx`

Read existing `/inventory/list/page.tsx`. If it already exists and is functional, add a redirect or notice that inventory items are now managed under `/stock/list`. If it's a stub, redirect:

```tsx
import { redirect } from "next/navigation";

export default function InventoryListPage() {
  redirect("/stock/list");
}
```

## Step 6 — Update hub pages

Update `/assets/page.tsx` with tiles: Dashboard, Asset List, Fixed Assets, Infrastructure, Maintenance
Update `/stock/page.tsx` with tiles: Dashboard, Stock List, Stock Ledger

## Step 7 — Verification

```bash
cd ~/CivitasOne/civitasone-suite
pnpm --filter @civitasone/schemas typecheck
pnpm --filter @civitasone/web typecheck
```

Fix any import errors. Common issues:
- `StockItemDetailSchema` references `StockItemSummarySchema` via `.extend()` — ensure correct naming
- The `type` query param filtering note: if the API actually supports `?type=fixed`, use that in the loader; otherwise client-side filter in the page
