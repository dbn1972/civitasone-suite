# 37-web-audit-legal — Build Audit + Legal Module Web Screens

## Context

CivitasOne government ERP — Next.js screens for Audit (event log, observations, risk, compliance) and Legal (cases, hearings, court orders, opinions) modules.

### Pattern every screen MUST follow

1. Server Component — async function, loader, JSX with Tailwind
2. Loader in `apps/web/src/app/_data/loaders.ts` using `fetchJson`
3. Zod schema in `packages/schemas/src/web.ts`
4. Type in `packages/types/src/index.ts`
5. `PageShell`, `DataSourceBadge` from `@civitasone/ui-kit`
6. Breadcrumb, 4 Stats cards, `<table class="tbl">`, status pills, error badge

### Gateway API prefixes
- audit: `/api/v1/audit`
- legal: `/api/v1/legal`

## Step 1 — Read existing files

```
apps/web/src/app/(app)/audit/page.tsx
apps/web/src/app/(app)/legal/list/page.tsx
apps/web/src/app/_data/loaders.ts
packages/schemas/src/web.ts
packages/types/src/index.ts
apps/web/src/app/(app)/legal/page.tsx
```

Also read ALL HTML prototypes:
- From `~/CivitasOne/erpnext-develop/audit-module/web/` — list the directory and read all .html files
- From `~/CivitasOne/erpnext-develop/legal-module/web/` — list the directory and read all .html files

## Step 2 — Add Zod schemas to `packages/schemas/src/web.ts`

Append:

```typescript
// Audit schemas
export const AuditDashboardSchema = z.object({
  openObservations: z.number().default(0),
  riskRegisterItems: z.number().default(0),
  cagParas: z.number().default(0),
  compliancePct: z.number().default(0),
});

export const AuditObservationSummarySchema = z.object({
  id: z.string(),
  observationNo: z.string(),
  title: z.string(),
  type: z.enum(["internal", "cag", "statutory", "concurrent"]),
  severity: z.enum(["critical", "major", "minor", "observation"]),
  department: z.string().optional(),
  auditPeriod: z.string().optional(),
  raisedDate: z.string(),
  dueDate: z.string().optional(),
  status: z.enum(["open", "replied", "partially_closed", "closed", "compliance_pending"]),
  para: z.string().optional(),
});
export const AuditObservationSummaryListSchema = z.array(AuditObservationSummarySchema);

export const AuditObservationDetailSchema = AuditObservationSummarySchema.extend({
  description: z.string().optional(),
  amount: z.number().optional(),
  recommendations: z.string().optional(),
  replies: z.array(z.object({
    id: z.string(),
    repliedBy: z.string(),
    content: z.string(),
    repliedAt: z.string(),
    acceptedByAuditor: z.boolean().optional(),
  })).default([]),
  closureDetails: z.string().optional(),
});

export const RiskSummarySchema = z.object({
  id: z.string(),
  riskCode: z.string(),
  title: z.string(),
  category: z.enum(["financial", "operational", "compliance", "reputational", "strategic", "it"]),
  likelihood: z.enum(["rare", "unlikely", "possible", "likely", "almost_certain"]),
  impact: z.enum(["negligible", "minor", "moderate", "major", "catastrophic"]),
  riskScore: z.number(),
  owner: z.string().optional(),
  mitigationStatus: z.enum(["not_started", "in_progress", "implemented", "accepted"]),
  reviewDate: z.string().optional(),
  status: z.enum(["open", "mitigated", "closed", "escalated"]),
});
export const RiskSummaryListSchema = z.array(RiskSummarySchema);

export const AuditPlanItemSchema = z.object({
  id: z.string(),
  auditUnit: z.string(),
  department: z.string(),
  type: z.enum(["routine", "special", "compliance", "performance"]),
  plannedFrom: z.string(),
  plannedTo: z.string(),
  auditorTeam: z.string().optional(),
  status: z.enum(["planned", "in_progress", "completed", "deferred"]),
});
export const AuditPlanListSchema = z.array(AuditPlanItemSchema);

export const AuditComplianceItemSchema = z.object({
  id: z.string(),
  lawOrRule: z.string(),
  section: z.string().optional(),
  requirement: z.string(),
  frequency: z.string(),
  dueDate: z.string(),
  department: z.string().optional(),
  status: z.enum(["complied", "pending", "overdue", "na"]),
  evidence: z.string().optional(),
});
export const AuditComplianceListSchema = z.array(AuditComplianceItemSchema);

export const AuditExportJobSchema = z.object({
  id: z.string(),
  jobType: z.string(),
  requestedBy: z.string(),
  requestedAt: z.string(),
  completedAt: z.string().optional(),
  format: z.enum(["pdf", "xlsx", "csv"]),
  status: z.enum(["queued", "processing", "completed", "failed"]),
  downloadUrl: z.string().optional(),
});
export const AuditExportJobListSchema = z.array(AuditExportJobSchema);

// Legal schemas
export const LegalDashboardSchema = z.object({
  activeCases: z.number().default(0),
  hearingsThisWeek: z.number().default(0),
  ordersPending: z.number().default(0),
  opinionsDue: z.number().default(0),
});

export const LegalCaseSummarySchema = z.object({
  id: z.string(),
  caseNo: z.string(),
  title: z.string(),
  court: z.string(),
  type: z.enum(["civil", "criminal", "arbitration", "tribunal", "writ", "appeal", "other"]),
  filedDate: z.string(),
  department: z.string().optional(),
  petitioner: z.string().optional(),
  respondent: z.string().optional(),
  advocateName: z.string().optional(),
  nextHearingDate: z.string().optional(),
  status: z.enum(["active", "disposed", "stayed", "transferred", "dismissed", "settled"]),
});
export const LegalCaseSummaryListSchema = z.array(LegalCaseSummarySchema);

export const LegalCaseDetailSchema = LegalCaseSummarySchema.extend({
  description: z.string().optional(),
  hearings: z.array(z.object({
    id: z.string(),
    date: z.string(),
    court: z.string(),
    purpose: z.string().optional(),
    outcome: z.string().optional(),
    nextDate: z.string().optional(),
  })).default([]),
  orders: z.array(z.object({
    id: z.string(),
    date: z.string(),
    orderNo: z.string().optional(),
    summary: z.string(),
    complianceRequired: z.boolean().default(false),
    complianceDeadline: z.string().optional(),
    status: z.enum(["pending", "complied", "appealed"]),
  })).default([]),
});

export const HearingSummarySchema = z.object({
  id: z.string(),
  caseId: z.string(),
  caseNo: z.string(),
  caseTitle: z.string(),
  court: z.string(),
  date: z.string(),
  time: z.string().optional(),
  purpose: z.string().optional(),
  outcome: z.string().optional(),
  nextDate: z.string().optional(),
  status: z.enum(["scheduled", "completed", "adjourned", "cancelled"]),
});
export const HearingSummaryListSchema = z.array(HearingSummarySchema);

export const CourtOrderSummarySchema = z.object({
  id: z.string(),
  caseId: z.string(),
  caseNo: z.string(),
  court: z.string(),
  orderDate: z.string(),
  orderNo: z.string().optional(),
  summary: z.string(),
  complianceRequired: z.boolean().default(false),
  complianceDeadline: z.string().optional(),
  department: z.string().optional(),
  status: z.enum(["pending", "complied", "appealed", "stayed"]),
});
export const CourtOrderSummaryListSchema = z.array(CourtOrderSummarySchema);

export const LegalOpinionSummarySchema = z.object({
  id: z.string(),
  opinionNo: z.string(),
  subject: z.string(),
  requestedBy: z.string(),
  requestDate: z.string(),
  dueDate: z.string().optional(),
  advisorName: z.string().optional(),
  status: z.enum(["pending", "draft", "issued", "revised"]),
  issuedDate: z.string().optional(),
});
export const LegalOpinionSummaryListSchema = z.array(LegalOpinionSummarySchema);
```

## Step 3 — Add types to `packages/types/src/index.ts`

Append:

```typescript
export type AuditObservationSummary = {
  id: string;
  observationNo: string;
  title: string;
  type: "internal" | "cag" | "statutory" | "concurrent";
  severity: "critical" | "major" | "minor" | "observation";
  department?: string;
  auditPeriod?: string;
  raisedDate: string;
  dueDate?: string;
  status: "open" | "replied" | "partially_closed" | "closed" | "compliance_pending";
  para?: string;
};

export type RiskSummary = {
  id: string;
  riskCode: string;
  title: string;
  category: "financial" | "operational" | "compliance" | "reputational" | "strategic" | "it";
  likelihood: "rare" | "unlikely" | "possible" | "likely" | "almost_certain";
  impact: "negligible" | "minor" | "moderate" | "major" | "catastrophic";
  riskScore: number;
  owner?: string;
  mitigationStatus: "not_started" | "in_progress" | "implemented" | "accepted";
  reviewDate?: string;
  status: "open" | "mitigated" | "closed" | "escalated";
};

export type LegalCaseSummary = {
  id: string;
  caseNo: string;
  title: string;
  court: string;
  type: "civil" | "criminal" | "arbitration" | "tribunal" | "writ" | "appeal" | "other";
  filedDate: string;
  department?: string;
  petitioner?: string;
  respondent?: string;
  advocateName?: string;
  nextHearingDate?: string;
  status: "active" | "disposed" | "stayed" | "transferred" | "dismissed" | "settled";
};

export type HearingSummary = {
  id: string;
  caseId: string;
  caseNo: string;
  caseTitle: string;
  court: string;
  date: string;
  time?: string;
  purpose?: string;
  outcome?: string;
  nextDate?: string;
  status: "scheduled" | "completed" | "adjourned" | "cancelled";
};

export type CourtOrderSummary = {
  id: string;
  caseId: string;
  caseNo: string;
  court: string;
  orderDate: string;
  orderNo?: string;
  summary: string;
  complianceRequired: boolean;
  complianceDeadline?: string;
  department?: string;
  status: "pending" | "complied" | "appealed" | "stayed";
};

export type LegalOpinionSummary = {
  id: string;
  opinionNo: string;
  subject: string;
  requestedBy: string;
  requestDate: string;
  dueDate?: string;
  advisorName?: string;
  status: "pending" | "draft" | "issued" | "revised";
  issuedDate?: string;
};
```

## Step 4 — Add loaders

Append to `apps/web/src/app/_data/loaders.ts`:

```typescript
export async function getAuditDashboard() {
  return fetchJson("/api/v1/audit/events", {} as AuditDashboardSchema, {
    revalidateSeconds: 60, telemetryKey: "audit.dashboard", responseSchema: AuditDashboardSchema,
  });
}

export async function getAuditObservations() {
  return fetchJson("/api/v1/audit/observations", [] as AuditObservationSummary[], {
    revalidateSeconds: 60, telemetryKey: "audit.observations", responseSchema: AuditObservationSummaryListSchema,
  });
}

export async function getAuditObservationById(id: string) {
  return fetchJson(`/api/v1/audit/observations/${id}`, null, {
    revalidateSeconds: 30, telemetryKey: "audit.observation.detail", responseSchema: AuditObservationDetailSchema,
  });
}

export async function getRiskRegister() {
  return fetchJson("/api/v1/audit/risks", [] as RiskSummary[], {
    revalidateSeconds: 120, telemetryKey: "audit.risks", responseSchema: RiskSummaryListSchema,
  });
}

export async function getAuditPlan() {
  return fetchJson("/api/v1/audit/plan", [] as AuditPlanItemSchema[], {
    revalidateSeconds: 300, telemetryKey: "audit.plan", responseSchema: AuditPlanListSchema,
  });
}

export async function getAuditCompliance() {
  return fetchJson("/api/v1/audit/compliance", [] as AuditComplianceItemSchema[], {
    revalidateSeconds: 120, telemetryKey: "audit.compliance", responseSchema: AuditComplianceListSchema,
  });
}

export async function getAuditExports() {
  return fetchJson("/api/v1/audit/exports", [] as AuditExportJobSchema[], {
    revalidateSeconds: 30, telemetryKey: "audit.exports", responseSchema: AuditExportJobListSchema,
  });
}

export async function getLegalDashboard() {
  return fetchJson("/api/v1/legal/cases", {} as LegalDashboardSchema, {
    revalidateSeconds: 60, telemetryKey: "legal.dashboard", responseSchema: LegalDashboardSchema,
  });
}

export async function getLegalCases() {
  return fetchJson("/api/v1/legal/cases", [] as LegalCaseSummary[], {
    revalidateSeconds: 60, telemetryKey: "legal.cases", responseSchema: LegalCaseSummaryListSchema,
  });
}

export async function getLegalCaseById(id: string) {
  return fetchJson(`/api/v1/legal/cases/${id}`, null, {
    revalidateSeconds: 30, telemetryKey: "legal.case.detail", responseSchema: LegalCaseDetailSchema,
  });
}

export async function getLegalHearings() {
  return fetchJson("/api/v1/legal/hearings", [] as HearingSummary[], {
    revalidateSeconds: 60, telemetryKey: "legal.hearings", responseSchema: HearingSummaryListSchema,
  });
}

export async function getCourtOrders() {
  return fetchJson("/api/v1/legal/court-orders", [] as CourtOrderSummary[], {
    revalidateSeconds: 60, telemetryKey: "legal.court-orders", responseSchema: CourtOrderSummaryListSchema,
  });
}

export async function getLegalOpinions() {
  return fetchJson("/api/v1/legal/opinions", [] as LegalOpinionSummary[], {
    revalidateSeconds: 120, telemetryKey: "legal.opinions", responseSchema: LegalOpinionSummaryListSchema,
  });
}
```

## Step 5 — Build each page

### Audit pages

#### 5.1 `/audit/dashboard/page.tsx`
- 4 stats: Open Observations, Risk Register Items, CAG Paras, Compliance %
- Quick links: Observations, Risk Register, Audit Plan, Compliance, Event Log, Exports
- API: `getAuditDashboard()`

#### 5.2 Enhance `/audit/page.tsx`
Read existing and add/update:
- Event log section with actor, action, outcome, timestamp columns
- Change audit event API call to `GET /api/v1/audit/events`
- If page already has a table, enhance it with proper columns
- Add DataSourceBadge on error
- Add link to `/audit/dashboard`

#### 5.3 `/audit/observations/page.tsx`
Create `apps/web/src/app/(app)/audit/observations/page.tsx`:
- Table: Observation No, Title, Type, Severity, Department, Raised Date, Due Date, Status
- Type pills: internal=blue, cag=red, statutory=orange, concurrent=purple
- Severity pills: critical=red, major=orange, minor=yellow, observation=gray
- Status pills: open=red, replied=yellow, partially_closed=orange, closed=green, compliance_pending=purple
- 4 stats: Total, Open, Overdue (dueDate < today), Closed
- Link from each row to `/audit/observations/[id]`

#### 5.4 `/audit/observations/[id]/page.tsx`
Create `apps/web/src/app/(app)/audit/observations/[id]/page.tsx`:
- Header: Observation No, Title, Type, Severity, Status
- Details card: Department, Audit Period, Raised Date, Due Date, Amount, Para
- Description block
- Recommendations block
- Replies section: list of replies with replier, content, date, accepted/rejected badge
- Closure details (if closed)
- API: `getAuditObservationById(params.id)`

#### 5.5 `/audit/risk-register/page.tsx`
Create `apps/web/src/app/(app)/audit/risk-register/page.tsx`:
- Table: Risk Code, Title, Category, Likelihood, Impact, Risk Score, Owner, Mitigation Status, Review Date, Status
- Category pills: financial=blue, operational=yellow, compliance=purple, reputational=orange, strategic=green, it=gray
- Risk Score: show as number with color (0-5 green, 6-14 yellow, 15-25 red)
- Status pills: open=red, mitigated=yellow, closed=green, escalated=red
- 4 stats: Total Risks, Open, High Risk (score ≥15), Mitigated

#### 5.6 `/audit/plan/page.tsx`
Create `apps/web/src/app/(app)/audit/plan/page.tsx`:
- Table: Audit Unit, Department, Type, Planned From, Planned To, Auditor Team, Status
- Type pills: routine=blue, special=orange, compliance=purple, performance=green
- Status pills: planned=blue, in_progress=yellow, completed=green, deferred=gray
- 4 stats: Total, Planned, In Progress, Completed

#### 5.7 `/audit/compliance/page.tsx`
Create `apps/web/src/app/(app)/audit/compliance/page.tsx`:
- Table: Law/Rule, Section, Requirement, Frequency, Due Date, Department, Status
- Status pills: complied=green, pending=yellow, overdue=red, na=gray
- 4 stats: Total, Complied, Pending, Overdue

#### 5.8 `/audit/exports/page.tsx`
Create `apps/web/src/app/(app)/audit/exports/page.tsx`:
- Table: Job Type, Requested By, Requested At, Completed At, Format, Status, Download
- Status pills: queued=gray, processing=yellow, completed=green, failed=red
- Format pills: pdf=red, xlsx=green, csv=blue
- Download link if status=completed and downloadUrl exists

### Legal pages

#### 5.9 `/legal/dashboard/page.tsx`
- 4 stats: Active Cases, Hearings This Week, Orders Pending, Opinions Due
- Quick links: Cases List, Hearings, Court Orders, Legal Opinions

#### 5.10 Enhance `/legal/list/page.tsx`
Read existing and update:
- Table columns: Case No, Title, Court, Type, Filed Date, Department, Petitioner, Respondent, Advocate, Next Hearing, Status
- Type pills: civil=blue, criminal=red, arbitration=orange, tribunal=purple, writ=yellow, appeal=gray, other=gray
- Status pills: active=green, disposed=gray, stayed=yellow, transferred=blue, dismissed=red, settled=teal
- Stats: Total, Active, Next Week Hearings, Disposed
- Link from each row to `/legal/cases/[id]`

#### 5.11 `/legal/cases/[id]/page.tsx`
Create `apps/web/src/app/(app)/legal/cases/[id]/page.tsx`:
- Header: Case No, Title, Court, Type, Status, Advocate
- Details: Filed Date, Department, Petitioner, Respondent, Next Hearing Date
- Hearings table: Date, Purpose, Outcome, Next Date, Status
- Court Orders table: Order Date, Order No, Summary, Compliance Required (yes/no), Deadline, Status
- API: `getLegalCaseById(params.id)`

#### 5.12 `/legal/hearings/page.tsx`
Create `apps/web/src/app/(app)/legal/hearings/page.tsx`:
- Table: Case No, Case Title, Court, Date, Time, Purpose, Outcome, Next Date, Status
- Status pills: scheduled=blue, completed=green, adjourned=yellow, cancelled=red
- 4 stats: Total, Scheduled (future), This Week, Completed
- Sort by date (upcoming first)

#### 5.13 `/legal/court-orders/page.tsx`
Create `apps/web/src/app/(app)/legal/court-orders/page.tsx`:
- Table: Case No, Court, Order Date, Order No, Summary (truncated), Compliance Required, Compliance Deadline, Status
- Compliance Required: show as "Yes" (red badge if deadline approaching) or "No"
- Status pills: pending=yellow, complied=green, appealed=blue, stayed=gray
- 4 stats: Total, Pending Compliance, Complied, Orders Requiring Action

#### 5.14 `/legal/opinions/page.tsx`
Create `apps/web/src/app/(app)/legal/opinions/page.tsx`:
- Table: Opinion No, Subject, Requested By, Request Date, Due Date, Advisor, Status, Issued Date
- Status pills: pending=yellow, draft=blue, issued=green, revised=orange
- 4 stats: Total, Pending, Issued, Overdue (dueDate < today and status != issued)

## Step 6 — Update hub pages

Read existing `/audit/page.tsx` and update with navigation tiles:
- Dashboard, Event Log, Observations, Risk Register, Audit Plan, Compliance, Exports

Read existing `/legal/page.tsx` and update with navigation tiles:
- Dashboard, Cases List, Hearings, Court Orders, Legal Opinions

## Step 7 — Verification

```bash
cd ~/CivitasOne/civitasone-suite
pnpm --filter @civitasone/schemas typecheck
pnpm --filter @civitasone/web typecheck
```

Fix TypeScript errors. Note: schema types like `AuditPlanItemSchema` and `AuditComplianceItemSchema` are Zod schema objects — the inferred types should be extracted with `z.infer<typeof AuditPlanItemSchema>` if used as TS types in loaders.
