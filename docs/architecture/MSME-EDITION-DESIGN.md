# CivitasOne MSME Edition — Design Document

## MSME Classification (Government of India)

India classifies MSMEs into **Manufacturing** and **Services** sectors with investment + turnover criteria:

| Category | Investment (Plant & Machinery) | Turnover |
|----------|-------------------------------|----------|
| **Micro** | ≤ ₹1 Cr | ≤ ₹5 Cr |
| **Small** | ≤ ₹10 Cr | ≤ ₹50 Cr |
| **Medium** | ≤ ₹50 Cr | ≤ ₹250 Cr |

Each has different operational needs. The platform renders a **tailored experience** based on:
1. `msme_category`: micro | small | medium
2. `msme_sector`: manufacturing | trading | services
3. `msme_industry`: NIC 2-digit code (textiles, food, IT, construction, etc.)

---

## MSME Sub-Types & Their Module Needs

### Manufacturing MSME (e.g. Kumar Textiles, Patel Auto Parts)

```
┌─────────────────────────────────────────────────────────────────┐
│  Dashboard                                                       │
│  ┌──────────┬──────────┬──────────┬──────────┬───────────────┐ │
│  │ Orders   │Production│ Stock    │ Dispatch │ GST Returns   │ │
│  │ received │ tracking │ levels   │ pending  │ due dates     │ │
│  └──────────┴──────────┴──────────┴──────────┴───────────────┘ │
│                                                                  │
│  Modules visible:                                                │
│  ├── Sales (quotations → orders → invoices → e-way bill)        │
│  ├── Purchase (raw material POs → GRN → vendor bills)           │
│  ├── Production (BOM → work orders → finished goods)  ← NEW    │
│  ├── Stock & Inventory (raw material → WIP → finished goods)    │
│  ├── Quality (inspection on GRN + finished goods)     ← NEW    │
│  ├── Dispatch (delivery challan → e-way bill → POD)             │
│  ├── GST (auto-compute on invoice, GSTR-1/3B filing)            │
│  ├── Payroll (PF/ESI/TDS for factory workers)                   │
│  ├── Fixed Assets (plant & machinery register)                   │
│  ├── Bank & Payments (receivables, payables, reconciliation)     │
│  └── Reports (P&L, balance sheet, stock valuation, GST summary) │
│                                                                  │
│  NOT visible: eOffice, Treasury, HoA, PFMS, RTI, Grants, CSMOP │
└─────────────────────────────────────────────────────────────────┘
```

### Trading MSME (e.g. Gupta Traders, Sharma Electronics Wholesale)

```
┌─────────────────────────────────────────────────────────────────┐
│  Dashboard                                                       │
│  ┌──────────┬──────────┬──────────┬──────────┬───────────────┐ │
│  │ Sales    │ Purchase │Receivable│ Stock    │ GST Summary   │ │
│  │ today    │ due      │ overdue  │ alerts   │ liability     │ │
│  └──────────┴──────────┴──────────┴──────────┴───────────────┘ │
│                                                                  │
│  Modules visible:                                                │
│  ├── Sales (quotation → invoice → e-invoice → e-way bill)       │
│  ├── Purchase (PO → GRN → vendor bill → 3-way match)           │
│  ├── Stock (item master → stock transfer → reorder alerts)      │
│  ├── CRM (leads → customers → follow-ups)                       │
│  ├── GST (auto GSTR-1/3B, HSN summary, ITC reconciliation)     │
│  ├── Bank (receivables/payables aging, reconciliation)           │
│  ├── Payroll (basic — few staff)                                │
│  ├── TReDS (upload invoices for factoring)            ← NEW    │
│  └── Reports (profit margins, stock valuation, debtor aging)    │
│                                                                  │
│  NOT visible: Production, Quality, eOffice, Treasury, PFMS      │
│  SIMPLIFIED: Payroll (no APAR, no disciplinary, no deputation)  │
└─────────────────────────────────────────────────────────────────┘
```

### Services MSME (e.g. Innovate IT Solutions, Priya Consulting)

```
┌─────────────────────────────────────────────────────────────────┐
│  Dashboard                                                       │
│  ┌──────────┬──────────┬──────────┬──────────┬───────────────┐ │
│  │ Projects │ Invoices │Receivable│ Employees│ GST Returns   │ │
│  │ active   │ pending  │ aging    │ on bench │ due dates     │ │
│  └──────────┴──────────┴──────────┴──────────┴───────────────┘ │
│                                                                  │
│  Modules visible:                                                │
│  ├── Projects (client projects → milestones → time tracking)    │
│  ├── CRM (leads → proposals → won/lost pipeline)               │
│  ├── Invoicing (time-based / milestone-based / retainer)        │
│  ├── HR (employees, leave, attendance, training)                │
│  ├── Payroll (salary + PF + ESI + professional tax)             │
│  ├── Contracts (client agreements, renewals, SLAs)              │
│  ├── GST (services GST, reverse charge, TDS on services)       │
│  ├── Bank (receivables, client payments tracking)               │
│  └── Reports (project profitability, utilisation, revenue)      │
│                                                                  │
│  NOT visible: Stock, Production, Quality, Dispatch, e-Way Bill  │
│  NOT visible: eOffice, Treasury, HoA, PFMS, RTI, Grants, CSMOP │
└─────────────────────────────────────────────────────────────────┘
```

---

## Technical Implementation

### 1. MSME Profile (stored on tenant)

```typescript
// tenant.settings (JSONB) for MSME edition tenants
{
  "msme": {
    "udyamNumber": "UDYAM-OD-01-0012345",
    "category": "small",              // micro | small | medium
    "sector": "manufacturing",        // manufacturing | trading | services
    "nicCode": "13",                  // NIC 2-digit (13 = textiles)
    "nicDescription": "Manufacture of Textiles",
    "investmentMinor": 500000000,     // ₹50 lakh in paise
    "turnoverMinor": 2000000000,      // ₹2 Cr in paise
    "registeredState": "Odisha",
    "dateOfIncorporation": "2018-04-15",
    "proprietorName": "Rajesh Kumar",
    "gstin": "21AABCK1234F1Z5"
  }
}
```

### 2. Module Manifest (which modules light up per MSME type)

```typescript
// gateway-service/src/msme-modules.ts

export const MSME_MODULES: Record<string, Record<string, boolean>> = {
  manufacturing: {
    sales: true,
    purchase: true,
    production: true,          // BOM, work orders
    stock: true,               // raw material → WIP → FG
    quality: true,             // inspection, rejection
    dispatch: true,            // delivery challan, e-way
    gst: true,
    payroll: true,
    fixedAssets: true,         // plant & machinery
    bank: true,
    crm: false,               // optional (most mfg sell B2B via agents)
    projects: false,
    contracts: false,
    treds: true,               // invoice factoring
  },
  trading: {
    sales: true,
    purchase: true,
    production: false,
    stock: true,
    quality: false,            // optional
    dispatch: true,
    gst: true,
    payroll: true,             // simplified
    fixedAssets: false,
    bank: true,
    crm: true,                 // customer management critical
    projects: false,
    contracts: false,
    treds: true,
  },
  services: {
    sales: true,               // invoicing
    purchase: true,            // vendor bills (subcontractors)
    production: false,
    stock: false,
    quality: false,
    dispatch: false,
    gst: true,
    payroll: true,             // full (employees are the product)
    fixedAssets: false,
    bank: true,
    crm: true,                 // pipeline is everything
    projects: true,            // project-based billing
    contracts: true,           // client SOWs
    treds: false,
  },
};
```

### 3. Dashboard Rendering (API response shapes per sector)

```typescript
// dashboard-service or apps/web adaptive dashboard
// GET /v1/dashboard → returns sector-specific widgets

// Manufacturing dashboard widgets:
{ widgets: ["orders_received", "production_status", "stock_levels", "dispatch_pending", "gst_due"] }

// Trading dashboard widgets:
{ widgets: ["sales_today", "purchase_due", "receivable_overdue", "stock_alerts", "gst_liability"] }

// Services dashboard widgets:
{ widgets: ["active_projects", "pending_invoices", "receivable_aging", "bench_strength", "gst_due"] }
```

### 4. Onboarding Flow (Self-Signup for MSME)

```
Step 1: Enter Udyam Number (UDYAM-XX-XX-XXXXXXX)
        → API pulls: name, category, sector, NIC code from Udyam portal
        
Step 2: Confirm GSTIN (auto-populated from Udyam)
        → Validates GSTIN against GST portal
        
Step 3: Set password + mobile OTP verification

Step 4: System auto-creates tenant:
        - edition: "small_office"
        - settings.msme: { category, sector, nicCode, udyamNumber, gstin }
        - Provisions appropriate modules based on sector
        - Seeds chart of accounts (simplified: income/expense/asset/liability)
        - Creates first user with owner role
        
Step 5: Guided setup wizard:
        - Manufacturing: "Add your products → Set up BOM → Add suppliers"
        - Trading: "Add your products → Import stock → Add customers"
        - Services: "Create first project → Add team members → Send invoice"
```

### 5. Simplified vs Full Mode

| Feature | Full Mode (Govt/PSU) | Simplified Mode (MSME) |
|---------|---------------------|----------------------|
| Chart of Accounts | 6-tier Head of Account (HoA) | Flat: Income / Expense / Asset / Liability |
| Journal entry | Double-entry with narration | Auto-generated from invoices (user never sees GL) |
| Approval workflow | Multi-level CSMOP chain | Single-level (owner approves) or auto-approve < threshold |
| File management | eOffice (noting, DFA, dispatch) | Simple document upload/attach |
| Payroll | Full (APAR, deputation, disciplinary) | Basic (salary, PF, ESI, TDS — that's it) |
| Procurement | Tender → EMD → PBG → 3-way match | Simple PO → receive → pay |
| Reporting | Budget utilisation, parliamentary QA | Profit & loss, cash flow, GST summary |
| Language | English (formal govt) | Hindi + regional languages |
| Terminology | "Sanction", "Head of Account", "DFA" | "Invoice", "Payment", "Stock" |

### 6. Industry-Specific Presets (NIC Code → Module Config)

| NIC Code | Industry | Extra Modules |
|----------|----------|---------------|
| 10-12 | Food Processing | Quality (FSSAI compliance), batch tracking, expiry |
| 13-14 | Textiles & Garments | Production (looms/orders), piece-rate wages |
| 20-21 | Chemicals & Pharma | Quality (GMP), batch tracking, MSDS, drug license |
| 25-28 | Metal & Machinery | Fixed assets, job-work, weight-based stock |
| 29-30 | Auto Components | Production (just-in-time), vendor rating |
| 45-47 | Wholesale/Retail Trade | CRM, loyalty, multi-location stock |
| 62-63 | IT & IT Services | Projects, time tracking, milestone billing |
| 41-43 | Construction | Project costing, material requisition, site-wise |
| 69-70 | Professional Services | Time billing, retainer management |

---

## Data Model (What Changes)

### Tenant Settings Extension

```sql
-- Already in JSONB settings — no migration needed
-- The frontend reads tenant.settings.msme.sector to determine module visibility
```

### Module Guard Enhancement

```typescript
// gateway-service/src/module-guard.ts (existing)
// Add MSME-aware logic:

function resolveEnabledModules(tenant: TenantView): Set<string> {
  if (tenant.edition === "small_office") {
    const msme = tenant.settings?.msme as MsmeProfile | undefined;
    const sector = msme?.sector ?? "trading"; // default to trading if unset
    return new Set(
      Object.entries(MSME_MODULES[sector] ?? MSME_MODULES.trading)
        .filter(([_, enabled]) => enabled)
        .map(([mod]) => mod)
    );
  }
  // govt/psu editions use the existing full module set
  return EDITION_MODULES[tenant.edition];
}
```

### Screen Configuration API

```typescript
// GET /v1/config/screens → returns which screens to render
// Already exists in gateway-service as the screen manifest

// For MSME manufacturing:
{
  "sidebar": [
    { "key": "dashboard", "label": "Dashboard", "icon": "home" },
    { "key": "sales", "label": "Sales & Invoices", "icon": "receipt" },
    { "key": "purchase", "label": "Purchases", "icon": "shopping-cart" },
    { "key": "production", "label": "Production", "icon": "factory" },
    { "key": "stock", "label": "Stock", "icon": "package" },
    { "key": "dispatch", "label": "Dispatch", "icon": "truck" },
    { "key": "gst", "label": "GST", "icon": "file-tax" },
    { "key": "payroll", "label": "Payroll", "icon": "users" },
    { "key": "bank", "label": "Banking", "icon": "building-bank" },
    { "key": "reports", "label": "Reports", "icon": "chart" }
  ]
}

// For MSME services:
{
  "sidebar": [
    { "key": "dashboard", "label": "Dashboard", "icon": "home" },
    { "key": "projects", "label": "Projects", "icon": "briefcase" },
    { "key": "crm", "label": "Clients", "icon": "users" },
    { "key": "invoicing", "label": "Invoicing", "icon": "receipt" },
    { "key": "hr", "label": "Team", "icon": "user-group" },
    { "key": "payroll", "label": "Payroll", "icon": "wallet" },
    { "key": "gst", "label": "GST & Tax", "icon": "file-tax" },
    { "key": "bank", "label": "Banking", "icon": "building-bank" },
    { "key": "reports", "label": "Reports", "icon": "chart" }
  ]
}
```

---

## Frontend Adaptive Rendering

The Next.js app renders based on the tenant config returned at login:

```tsx
// apps/web/src/app/(app)/layout.tsx
// Reads the screen manifest and renders only the enabled sidebar items

export default async function AppLayout({ children }) {
  const tenant = await getCurrentTenant();
  const screens = await getScreenManifest(tenant.id);
  
  return (
    <SidebarProvider items={screens.sidebar}>
      <Sidebar />
      <main>{children}</main>
    </SidebarProvider>
  );
}
```

### Terminology Localization by Edition

```typescript
// apps/web/src/lib/terminology.ts
const TERMS: Record<string, Record<string, string>> = {
  govt: {
    "invoice": "Bill",
    "customer": "Vendor/Citizen",
    "payment": "Payment/Sanction",
    "employee": "Officer/Staff",
    "project": "Scheme/Project",
  },
  msme_manufacturing: {
    "invoice": "Invoice/Bill",
    "customer": "Customer/Buyer",
    "purchase": "Raw Material Purchase",
    "stock": "Inventory",
    "employee": "Worker/Staff",
  },
  msme_services: {
    "invoice": "Invoice",
    "customer": "Client",
    "project": "Project/Engagement",
    "employee": "Team Member",
    "payment": "Client Payment",
  },
};
```

---

## Revenue Tiers for MSME

| Tier | Price | Features | Target |
|------|-------|----------|--------|
| **Free** (Govt sponsored) | ₹0 | Basic invoicing + GST + 3 users | Micro enterprises |
| **Starter** | ₹499/month | Full modules + 10 users + 5GB | Small businesses |
| **Growth** | ₹1,499/month | All modules + 50 users + 25GB + e-Invoice + TReDS | Growing SMEs |
| **Enterprise** | ₹4,999/month | Unlimited + multi-location + API access + priority support | Medium enterprises |

---

## Implementation Priority

| # | Feature | Effort | Sector Impact |
|---|---------|--------|---------------|
| 1 | Module manifest per sector (gateway config) | Low | All |
| 2 | Onboarding with Udyam auto-fill | Medium | All |
| 3 | Simplified accounting (income/expense, hide GL) | Medium | All |
| 4 | Customer invoicing + e-Invoice API | Medium | Manufacturing + Trading |
| 5 | e-Way bill generation | Medium | Manufacturing + Trading |
| 6 | Sector-specific dashboard widgets | Low | All |
| 7 | Production module (BOM, work orders) | High | Manufacturing only |
| 8 | Project time-tracking & milestone billing | Medium | Services only |
| 9 | TReDS invoice factoring integration | Medium | Manufacturing + Trading |
| 10 | WhatsApp bot (invoice, payment reminders) | Medium | All |
