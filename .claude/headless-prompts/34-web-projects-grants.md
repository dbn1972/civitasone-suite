# 34-web-projects-grants — Build Projects + Grants Module Web Screens

## Context

CivitasOne government ERP — Next.js screens for Projects and Grants modules.

### Pattern every screen MUST follow

1. Server Component — async function, loader, JSX with Tailwind
2. Loader in `apps/web/src/app/_data/loaders.ts` using `fetchJson`
3. Zod schema in `packages/schemas/src/web.ts`
4. Type in `packages/types/src/index.ts`
5. `PageShell`, `DataSourceBadge` from `@civitasone/ui-kit`
6. Breadcrumb, 4 Stats cards, `<table class="tbl">`, status pills, error badge

### Gateway API prefixes
- project: `/api/v1/project`
- grant: `/api/v1/grants`

## Step 1 — Read existing files

```
apps/web/src/app/(app)/projects/list/page.tsx
apps/web/src/app/(app)/grants/list/page.tsx
apps/web/src/app/(app)/grants/installments/page.tsx
apps/web/src/app/_data/loaders.ts
packages/schemas/src/web.ts
packages/types/src/index.ts
apps/web/src/app/(app)/projects/page.tsx
apps/web/src/app/(app)/grants/page.tsx
```

Also read HTML prototypes:
- `~/CivitasOne/erpnext-develop/projects-module/web/dashboard.html`
- `~/CivitasOne/erpnext-develop/projects-module/web/projects.html`
- `~/CivitasOne/erpnext-develop/projects-module/web/project-detail.html`
- `~/CivitasOne/erpnext-develop/projects-module/web/milestones.html`
- `~/CivitasOne/erpnext-develop/projects-module/web/fund-releases.html`
- `~/CivitasOne/erpnext-develop/projects-module/web/utilization.html`
- `~/CivitasOne/erpnext-develop/projects-module/web/schemes.html`
- `~/CivitasOne/erpnext-develop/grants-module/web/dashboard.html`
- `~/CivitasOne/erpnext-develop/grants-module/web/grants.html`
- `~/CivitasOne/erpnext-develop/grants-module/web/grant-detail.html`
- `~/CivitasOne/erpnext-develop/grants-module/web/grantees.html`
- `~/CivitasOne/erpnext-develop/grants-module/web/releases.html`
- `~/CivitasOne/erpnext-develop/grants-module/web/uc-management.html`

## Step 2 — Add Zod schemas to `packages/schemas/src/web.ts`

Append:

```typescript
// Projects schemas
export const ProjectsDashboardSchema = z.object({
  totalProjects: z.number().default(0),
  onTrackPct: z.number().default(0),
  delayed: z.number().default(0),
  totalOutlay: z.number().default(0),
});

export const ProjectSummarySchema = z.object({
  id: z.string(),
  projectCode: z.string(),
  name: z.string(),
  scheme: z.string().optional(),
  department: z.string().optional(),
  startDate: z.string(),
  expectedEndDate: z.string().optional(),
  totalBudget: z.number(),
  expenditure: z.number().default(0),
  completionPct: z.number().default(0),
  status: z.enum(["planning", "active", "on_hold", "completed", "cancelled", "delayed"]),
});
export const ProjectSummaryListSchema = z.array(ProjectSummarySchema);

export const ProjectDetailSchema = ProjectSummarySchema.extend({
  description: z.string().optional(),
  milestones: z.array(z.object({
    id: z.string(),
    title: z.string(),
    dueDate: z.string(),
    completedDate: z.string().optional(),
    status: z.enum(["pending", "completed", "delayed"]),
  })).default([]),
  fundReleases: z.array(z.object({
    id: z.string(),
    releaseDate: z.string(),
    amount: z.number(),
    remarks: z.string().optional(),
  })).default([]),
});

export const MilestoneSummarySchema = z.object({
  id: z.string(),
  projectId: z.string(),
  projectName: z.string(),
  title: z.string(),
  dueDate: z.string(),
  completedDate: z.string().optional(),
  status: z.enum(["pending", "completed", "delayed"]),
  remarks: z.string().optional(),
});
export const MilestoneSummaryListSchema = z.array(MilestoneSummarySchema);

export const FundReleaseSummarySchema = z.object({
  id: z.string(),
  releaseNo: z.string(),
  projectId: z.string(),
  projectName: z.string(),
  amount: z.number(),
  releaseDate: z.string(),
  releasedBy: z.string().optional(),
  installmentNo: z.number().optional(),
  remarks: z.string().optional(),
  status: z.enum(["sanctioned", "released", "utilized"]),
});
export const FundReleaseSummaryListSchema = z.array(FundReleaseSummarySchema);

export const SchemeSummarySchema = z.object({
  id: z.string(),
  schemeCode: z.string(),
  name: z.string(),
  ministry: z.string().optional(),
  department: z.string().optional(),
  fundingType: z.enum(["central", "state", "centrally_sponsored", "external"]),
  totalAllocation: z.number(),
  releasedAmount: z.number().default(0),
  projectCount: z.number().default(0),
  status: z.enum(["active", "completed", "discontinued"]),
});
export const SchemeSummaryListSchema = z.array(SchemeSummarySchema);

// Grants schemas
export const GrantsDashboardSchema = z.object({
  totalGrants: z.number().default(0),
  disbursedAmount: z.number().default(0),
  pendingUCs: z.number().default(0),
  totalGrantees: z.number().default(0),
});

export const GrantSummarySchema = z.object({
  id: z.string(),
  grantNo: z.string(),
  title: z.string(),
  grantor: z.string().optional(),
  granteeId: z.string().optional(),
  granteeName: z.string().optional(),
  totalAmount: z.number(),
  disbursedAmount: z.number().default(0),
  pendingAmount: z.number().default(0),
  sanctionDate: z.string(),
  purpose: z.string().optional(),
  status: z.enum(["active", "completed", "suspended", "cancelled"]),
});
export const GrantSummaryListSchema = z.array(GrantSummarySchema);

export const GrantDetailSchema = GrantSummarySchema.extend({
  conditions: z.string().optional(),
  installments: z.array(z.object({
    id: z.string(),
    installmentNo: z.number(),
    amount: z.number(),
    scheduledDate: z.string(),
    releasedDate: z.string().optional(),
    status: z.enum(["pending", "released", "utilized"]),
  })).default([]),
  ucs: z.array(z.object({
    id: z.string(),
    ucNo: z.string(),
    amount: z.number(),
    period: z.string(),
    status: z.string(),
  })).default([]),
});

export const GranteeSummarySchema = z.object({
  id: z.string(),
  granteeCode: z.string(),
  name: z.string(),
  type: z.enum(["ngo", "government", "institution", "individual"]),
  registrationNo: z.string().optional(),
  panNo: z.string().optional(),
  contactPerson: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  activeGrants: z.number().default(0),
  totalGrantsReceived: z.number().default(0),
  ucCompliancePct: z.number().default(0),
});
export const GranteeSummaryListSchema = z.array(GranteeSummarySchema);

export const GrantInstallmentSummarySchema = z.object({
  id: z.string(),
  grantId: z.string(),
  grantNo: z.string(),
  granteeName: z.string(),
  installmentNo: z.number(),
  amount: z.number(),
  scheduledDate: z.string(),
  releasedDate: z.string().optional(),
  status: z.enum(["pending", "released", "utilized"]),
});
export const GrantInstallmentSummaryListSchema = z.array(GrantInstallmentSummarySchema);

export const GrantReleaseSchema = z.object({
  id: z.string(),
  releaseNo: z.string(),
  grantId: z.string(),
  grantNo: z.string(),
  granteeName: z.string(),
  amount: z.number(),
  releaseDate: z.string(),
  bankRef: z.string().optional(),
  status: z.enum(["pending", "processed", "credited"]),
});
export const GrantReleaseListSchema = z.array(GrantReleaseSchema);

export const GrantUtilizationSchema = z.object({
  id: z.string(),
  ucNo: z.string(),
  grantId: z.string(),
  grantNo: z.string(),
  granteeName: z.string(),
  amount: z.number(),
  periodFrom: z.string(),
  periodTo: z.string(),
  submittedDate: z.string().optional(),
  verifiedDate: z.string().optional(),
  status: z.enum(["pending", "submitted", "verified", "rejected"]),
});
export const GrantUtilizationListSchema = z.array(GrantUtilizationSchema);
```

## Step 3 — Add types to `packages/types/src/index.ts`

Append:

```typescript
export type MilestoneSummary = {
  id: string;
  projectId: string;
  projectName: string;
  title: string;
  dueDate: string;
  completedDate?: string;
  status: "pending" | "completed" | "delayed";
  remarks?: string;
};

export type FundReleaseSummary = {
  id: string;
  releaseNo: string;
  projectId: string;
  projectName: string;
  amount: number;
  releaseDate: string;
  releasedBy?: string;
  installmentNo?: number;
  remarks?: string;
  status: "sanctioned" | "released" | "utilized";
};

export type SchemeSummary = {
  id: string;
  schemeCode: string;
  name: string;
  ministry?: string;
  department?: string;
  fundingType: "central" | "state" | "centrally_sponsored" | "external";
  totalAllocation: number;
  releasedAmount: number;
  projectCount: number;
  status: "active" | "completed" | "discontinued";
};

export type GrantSummary = {
  id: string;
  grantNo: string;
  title: string;
  grantor?: string;
  granteeId?: string;
  granteeName?: string;
  totalAmount: number;
  disbursedAmount: number;
  pendingAmount: number;
  sanctionDate: string;
  purpose?: string;
  status: "active" | "completed" | "suspended" | "cancelled";
};

export type GranteeSummary = {
  id: string;
  granteeCode: string;
  name: string;
  type: "ngo" | "government" | "institution" | "individual";
  registrationNo?: string;
  panNo?: string;
  contactPerson?: string;
  email?: string;
  phone?: string;
  activeGrants: number;
  totalGrantsReceived: number;
  ucCompliancePct: number;
};

export type GrantInstallmentSummary = {
  id: string;
  grantId: string;
  grantNo: string;
  granteeName: string;
  installmentNo: number;
  amount: number;
  scheduledDate: string;
  releasedDate?: string;
  status: "pending" | "released" | "utilized";
};
```

## Step 4 — Add loaders

Append to `apps/web/src/app/_data/loaders.ts`:

```typescript
export async function getProjectsDashboard() {
  return fetchJson("/api/v1/project/projects", {} as ProjectsDashboardSchema, {
    revalidateSeconds: 120, telemetryKey: "projects.dashboard", responseSchema: ProjectsDashboardSchema,
  });
}

export async function getProjects() {
  return fetchJson("/api/v1/project/projects", [] as ProjectSummary[], {
    revalidateSeconds: 120, telemetryKey: "projects.list", responseSchema: ProjectSummaryListSchema,
  });
}

export async function getProjectById(id: string) {
  return fetchJson(`/api/v1/project/projects/${id}`, null, {
    revalidateSeconds: 60, telemetryKey: "projects.detail", responseSchema: ProjectDetailSchema,
  });
}

export async function getMilestones() {
  return fetchJson("/api/v1/project/milestones", [] as MilestoneSummary[], {
    revalidateSeconds: 120, telemetryKey: "projects.milestones", responseSchema: MilestoneSummaryListSchema,
  });
}

export async function getProjectFundReleases() {
  return fetchJson("/api/v1/project/fund-releases", [] as FundReleaseSummary[], {
    revalidateSeconds: 120, telemetryKey: "projects.fund-releases", responseSchema: FundReleaseSummaryListSchema,
  });
}

export async function getSchemes() {
  return fetchJson("/api/v1/project/schemes", [] as SchemeSummary[], {
    revalidateSeconds: 300, telemetryKey: "projects.schemes", responseSchema: SchemeSummaryListSchema,
  });
}

export async function getGrantsDashboard() {
  return fetchJson("/api/v1/grants/grants", {} as GrantsDashboardSchema, {
    revalidateSeconds: 120, telemetryKey: "grants.dashboard", responseSchema: GrantsDashboardSchema,
  });
}

export async function getGrants() {
  return fetchJson("/api/v1/grants/grants", [] as GrantSummary[], {
    revalidateSeconds: 120, telemetryKey: "grants.list", responseSchema: GrantSummaryListSchema,
  });
}

export async function getGrantById(id: string) {
  return fetchJson(`/api/v1/grants/grants/${id}`, null, {
    revalidateSeconds: 60, telemetryKey: "grants.detail", responseSchema: GrantDetailSchema,
  });
}

export async function getGrantees() {
  return fetchJson("/api/v1/grants/grantees", [] as GranteeSummary[], {
    revalidateSeconds: 300, telemetryKey: "grants.grantees", responseSchema: GranteeSummaryListSchema,
  });
}

export async function getGrantReleases() {
  return fetchJson("/api/v1/grants/releases", [] as GrantReleaseSchema[], {
    revalidateSeconds: 120, telemetryKey: "grants.releases", responseSchema: GrantReleaseListSchema,
  });
}

export async function getGrantInstallments() {
  return fetchJson("/api/v1/grants/installments", [] as GrantInstallmentSummary[], {
    revalidateSeconds: 120, telemetryKey: "grants.installments", responseSchema: GrantInstallmentSummaryListSchema,
  });
}

export async function getGrantUtilization() {
  return fetchJson("/api/v1/grants/utilization-certs", [] as GrantUtilizationSchema[], {
    revalidateSeconds: 120, telemetryKey: "grants.utilization", responseSchema: GrantUtilizationListSchema,
  });
}
```

## Step 5 — Build each page

### Projects pages

#### 5.1 `/projects/dashboard/page.tsx`
- 4 stats: Total Projects, On Track %, Delayed, Total Outlay (₹)
- Quick links to all sub-pages
- API: `getProjectsDashboard()`

#### 5.2 Enhance `/projects/list/page.tsx`
- Table: Project Code, Name, Scheme, Department, Start Date, Budget (₹), Expenditure (₹), Completion %, Status
- Status pills: planning=gray, active=green, on_hold=yellow, completed=blue, cancelled=red, delayed=orange (amber)
- Stats: Total, Active, Delayed, Completed
- Link from each row to `/projects/[id]`

#### 5.3 `/projects/[id]/page.tsx`
- Header: Project Code, Name, Status, Scheme, Budget, Expenditure, Completion %
- Milestones table: Title, Due Date, Completed Date, Status
- Fund Releases table: Release Date, Amount, Remarks
- API: `getProjectById(params.id)`

#### 5.4 `/projects/milestones/page.tsx`
- Table: Project Name, Milestone Title, Due Date, Completed Date, Status
- Status pills: pending=yellow, completed=green, delayed=red
- Stats: Total, Pending, Completed, Delayed

#### 5.5 `/projects/fund-releases/page.tsx`
- Table: Release No, Project Name, Amount (₹), Release Date, Released By, Installment No, Status
- Status pills: sanctioned=yellow, released=blue, utilized=green
- Stats: Total, Sanctioned (₹), Released (₹), Utilized (₹)

#### 5.6 `/projects/schemes/page.tsx`
- Table: Scheme Code, Name, Ministry, Department, Funding Type, Allocation (₹), Released (₹), Projects, Status
- Funding type pills: central=blue, state=green, centrally_sponsored=purple, external=orange
- Status pills: active=green, completed=gray, discontinued=red
- Stats: Total, Active, Projects Count, Total Allocation (₹)

### Grants pages

#### 5.7 `/grants/dashboard/page.tsx`
- 4 stats: Total Grants, Disbursed Amount (₹), Pending UCs, Total Grantees
- Quick links to Grants List, Grantees, Releases, Installments, UC Management

#### 5.8 Enhance `/grants/list/page.tsx`
- Table: Grant No, Title, Grantee, Total Amount (₹), Disbursed (₹), Pending (₹), Sanction Date, Status
- Status pills: active=green, completed=blue, suspended=yellow, cancelled=red
- Stats: Total, Active, Total Disbursed (₹), Pending (₹)
- Link from each row to `/grants/[id]`

#### 5.9 `/grants/[id]/page.tsx`
- Grant header: Grant No, Title, Grantee, Total Amount, Status, Purpose
- Installments table: Installment No, Amount, Scheduled Date, Released Date, Status
- UCs table: UC No, Amount, Period, Status
- API: `getGrantById(params.id)`

#### 5.10 `/grants/grantees/page.tsx`
- Table: Grantee Code, Name, Type, Registration No, Active Grants, Total Received (₹), UC Compliance %
- Type pills: ngo=purple, government=blue, institution=green, individual=gray
- UC compliance: show % as text with color (≥80% green, 50-79% yellow, <50% red)
- Stats: Total Grantees, NGOs, Government, Institutions

#### 5.11 `/grants/releases/page.tsx`
- Table: Release No, Grant No, Grantee, Amount (₹), Release Date, Bank Ref, Status
- Status pills: pending=yellow, processed=blue, credited=green
- Stats: Total Releases, Total Amount Released (₹), Pending, Processed

#### 5.12 Enhance `/grants/installments/page.tsx`
- Read existing and update columns: Grant No, Grantee, Installment No, Amount (₹), Scheduled Date, Released Date, Status
- Status pills: pending=yellow, released=blue, utilized=green

#### 5.13 `/grants/utilization/page.tsx`
- Table: UC No, Grant No, Grantee, Amount (₹), Period From, Period To, Submitted Date, Status
- Status pills: pending=yellow, submitted=blue, verified=green, rejected=red
- Stats: Total, Pending, Verified, Rejected

## Step 6 — Update hub pages

Update `/projects/page.tsx` with tiles: Dashboard, Projects List, Milestones, Fund Releases, Schemes
Update `/grants/page.tsx` with tiles: Dashboard, Grants, Grantees, Releases, Installments, UC Management

## Step 7 — Verification

```bash
cd ~/CivitasOne/civitasone-suite
pnpm --filter @civitasone/schemas typecheck
pnpm --filter @civitasone/web typecheck
```
