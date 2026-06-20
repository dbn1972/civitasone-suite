# 33-web-crm-helpdesk — Build CRM + Helpdesk + Citizen Screens

## Context

CivitasOne government ERP — building Next.js screens for CRM, Helpdesk, and Citizen modules.

### Pattern every screen MUST follow

1. **Server Component** — async function, calls a loader, renders JSX with Tailwind
2. **Loader** in `apps/web/src/app/_data/loaders.ts` using `fetchJson`
3. **Zod schema** in `packages/schemas/src/web.ts`
4. **Type** in `packages/types/src/index.ts`
5. **Components**: `PageShell`, `DataSourceBadge` from `@civitasone/ui-kit`
6. **Breadcrumb**, **Stats row** (4 cards), **Table** (`<table class="tbl">`), **Status pills**, **Error handling**

### Gateway API prefixes
- crm: `/api/v1/crm`
- citizen: `/api/v1/citizen`
- helpdesk: `/api/v1/helpdesk`

## Step 1 — Read existing files

```
apps/web/src/app/(app)/crm/contacts/page.tsx
apps/web/src/app/(app)/crm/deals/page.tsx
apps/web/src/app/(app)/crm/activities/page.tsx
apps/web/src/app/(app)/helpdesk/tickets/page.tsx
apps/web/src/app/_data/loaders.ts
packages/schemas/src/web.ts
packages/types/src/index.ts
apps/web/src/app/(app)/crm/page.tsx
apps/web/src/app/(app)/helpdesk/page.tsx
```

Also read HTML prototypes:
- `~/CivitasOne/erpnext-develop/civitasone-screens/web/crm.html`
- `~/CivitasOne/erpnext-develop/civitasone-screens/web/crm-detail.html`
- `~/CivitasOne/erpnext-develop/civitasone-screens/web/helpdesk.html`
- `~/CivitasOne/erpnext-develop/civitasone-screens/web/helpdesk-detail.html`
- `~/CivitasOne/erpnext-develop/citizen-module/web/dashboard.html`
- `~/CivitasOne/erpnext-develop/citizen-module/web/requests.html`
- `~/CivitasOne/erpnext-develop/citizen-module/web/request-detail.html`
- `~/CivitasOne/erpnext-develop/citizen-module/web/rti.html`
- `~/CivitasOne/erpnext-develop/citizen-module/web/rti-detail.html`
- `~/CivitasOne/erpnext-develop/citizen-module/web/feedback.html`

## Step 2 — Add Zod schemas

Append to `packages/schemas/src/web.ts`:

```typescript
// CRM schemas
export const CRMDashboardSchema = z.object({
  totalContacts: z.number().default(0),
  openDeals: z.number().default(0),
  activitiesToday: z.number().default(0),
  pipelineValue: z.number().default(0),
});

export const DealSummarySchema = z.object({
  id: z.string(),
  dealName: z.string(),
  contactId: z.string().optional(),
  contactName: z.string().optional(),
  stage: z.enum(["prospecting", "qualification", "proposal", "negotiation", "closed_won", "closed_lost"]),
  amount: z.number(),
  owner: z.string(),
  closeDate: z.string().optional(),
  probability: z.number().min(0).max(100).default(0),
  status: z.enum(["open", "won", "lost"]),
});
export const DealSummaryListSchema = z.array(DealSummarySchema);

export const ContactDetailSchema = z.object({
  id: z.string(),
  name: z.string(),
  organization: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  designation: z.string().optional(),
  city: z.string().optional(),
  lastActivityDate: z.string().optional(),
  tags: z.array(z.string()).default([]),
  deals: z.array(z.object({
    id: z.string(),
    dealName: z.string(),
    stage: z.string(),
    amount: z.number(),
  })).default([]),
  activityTimeline: z.array(z.object({
    id: z.string(),
    type: z.string(),
    subject: z.string(),
    dueDate: z.string().optional(),
    completedAt: z.string().optional(),
    status: z.string(),
  })).default([]),
});

export const ActivitySummarySchema = z.object({
  id: z.string(),
  type: z.enum(["call", "meeting", "email", "task", "note"]),
  subject: z.string(),
  relatedTo: z.string().optional(),
  relatedType: z.enum(["contact", "deal", "other"]).optional(),
  dueDate: z.string().optional(),
  completedAt: z.string().optional(),
  owner: z.string(),
  status: z.enum(["open", "overdue", "completed", "cancelled"]),
});
export const ActivitySummaryListSchema = z.array(ActivitySummarySchema);

// Helpdesk schemas
export const TicketDetailSchema = z.object({
  id: z.string(),
  ticketNo: z.string(),
  subject: z.string(),
  description: z.string().optional(),
  requesterName: z.string(),
  requesterEmail: z.string().optional(),
  assignedTo: z.string().optional(),
  priority: z.enum(["low", "medium", "high", "critical"]),
  slaStatus: z.enum(["within_sla", "due_soon", "breached"]),
  status: z.enum(["open", "in_progress", "pending", "resolved", "closed"]),
  channel: z.enum(["web", "email", "phone", "walk_in"]).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  resolvedAt: z.string().optional(),
  comments: z.array(z.object({
    id: z.string(),
    author: z.string(),
    content: z.string(),
    createdAt: z.string(),
    isInternal: z.boolean().default(false),
  })).default([]),
});
export const TicketDetailListSchema = z.array(TicketDetailSchema);

// Citizen schemas
export const CitizenRequestSummarySchema = z.object({
  id: z.string(),
  requestNo: z.string(),
  serviceType: z.string(),
  citizenName: z.string(),
  citizenPhone: z.string().optional(),
  submittedAt: z.string(),
  expectedResolutionDate: z.string().optional(),
  status: z.enum(["submitted", "under_review", "in_progress", "resolved", "rejected"]),
  remarks: z.string().optional(),
});
export const CitizenRequestSummaryListSchema = z.array(CitizenRequestSummarySchema);

export const RTISummarySchema = z.object({
  id: z.string(),
  rtiNo: z.string(),
  applicantName: z.string(),
  subject: z.string(),
  publicAuthority: z.string().optional(),
  filedDate: z.string(),
  deadlineDate: z.string().optional(),
  transferredTo: z.string().optional(),
  status: z.enum(["received", "forwarded", "under_review", "replied", "appeal", "closed"]),
  isFirstAppeal: z.boolean().default(false),
});
export const RTISummaryListSchema = z.array(RTISummarySchema);

export const TicketAnalyticsSchema = z.object({
  totalTickets: z.number().default(0),
  openTickets: z.number().default(0),
  resolvedThisMonth: z.number().default(0),
  slaBreachedCount: z.number().default(0),
  avgResolutionHours: z.number().default(0),
  byPriority: z.array(z.object({
    priority: z.string(),
    count: z.number(),
    pct: z.number(),
  })).default([]),
  byChannel: z.array(z.object({
    channel: z.string(),
    count: z.number(),
    pct: z.number(),
  })).default([]),
});
```

## Step 3 — Add types to `packages/types/src/index.ts`

Append:

```typescript
export type DealSummary = {
  id: string;
  dealName: string;
  contactId?: string;
  contactName?: string;
  stage: "prospecting" | "qualification" | "proposal" | "negotiation" | "closed_won" | "closed_lost";
  amount: number;
  owner: string;
  closeDate?: string;
  probability: number;
  status: "open" | "won" | "lost";
};

export type ActivitySummary = {
  id: string;
  type: "call" | "meeting" | "email" | "task" | "note";
  subject: string;
  relatedTo?: string;
  relatedType?: "contact" | "deal" | "other";
  dueDate?: string;
  completedAt?: string;
  owner: string;
  status: "open" | "overdue" | "completed" | "cancelled";
};

export type TicketDetail = {
  id: string;
  ticketNo: string;
  subject: string;
  description?: string;
  requesterName: string;
  requesterEmail?: string;
  assignedTo?: string;
  priority: "low" | "medium" | "high" | "critical";
  slaStatus: "within_sla" | "due_soon" | "breached";
  status: "open" | "in_progress" | "pending" | "resolved" | "closed";
  channel?: "web" | "email" | "phone" | "walk_in";
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
};

export type CitizenRequestSummary = {
  id: string;
  requestNo: string;
  serviceType: string;
  citizenName: string;
  citizenPhone?: string;
  submittedAt: string;
  expectedResolutionDate?: string;
  status: "submitted" | "under_review" | "in_progress" | "resolved" | "rejected";
  remarks?: string;
};

export type RTISummary = {
  id: string;
  rtiNo: string;
  applicantName: string;
  subject: string;
  publicAuthority?: string;
  filedDate: string;
  deadlineDate?: string;
  transferredTo?: string;
  status: "received" | "forwarded" | "under_review" | "replied" | "appeal" | "closed";
  isFirstAppeal: boolean;
};
```

## Step 4 — Add loaders

Append to `apps/web/src/app/_data/loaders.ts`:

```typescript
export async function getCRMDashboard() {
  return fetchJson("/api/v1/crm/contacts", {} as CRMDashboardSchema, {
    revalidateSeconds: 60, telemetryKey: "crm.dashboard", responseSchema: CRMDashboardSchema,
  });
}

export async function getDeals() {
  return fetchJson("/api/v1/crm/deals", [] as DealSummary[], {
    revalidateSeconds: 60, telemetryKey: "crm.deals", responseSchema: DealSummaryListSchema,
  });
}

export async function getDealById(id: string) {
  return fetchJson(`/api/v1/crm/deals/${id}`, null, {
    revalidateSeconds: 30, telemetryKey: "crm.deal.detail", responseSchema: DealSummarySchema,
  });
}

export async function getContactById(id: string) {
  return fetchJson(`/api/v1/crm/contacts/${id}`, null, {
    revalidateSeconds: 60, telemetryKey: "crm.contact.detail", responseSchema: ContactDetailSchema,
  });
}

export async function getActivities() {
  return fetchJson("/api/v1/crm/activities", [] as ActivitySummary[], {
    revalidateSeconds: 60, telemetryKey: "crm.activities", responseSchema: ActivitySummaryListSchema,
  });
}

export async function getHelpdeskTickets() {
  return fetchJson("/api/v1/citizen/tickets", [] as TicketDetail[], {
    revalidateSeconds: 60, telemetryKey: "helpdesk.tickets", responseSchema: TicketDetailListSchema,
  });
}

export async function getHelpdeskTicketById(id: string) {
  return fetchJson(`/api/v1/citizen/tickets/${id}`, null, {
    revalidateSeconds: 30, telemetryKey: "helpdesk.ticket.detail", responseSchema: TicketDetailSchema,
  });
}

export async function getBreachedSLATickets() {
  return fetchJson("/api/v1/citizen/tickets", [] as TicketDetail[], {
    revalidateSeconds: 60, telemetryKey: "helpdesk.sla.breached", responseSchema: TicketDetailListSchema,
  });
}

export async function getInternalHelpdeskTickets() {
  return fetchJson("/api/v1/helpdesk/tickets", [] as TicketDetail[], {
    revalidateSeconds: 60, telemetryKey: "helpdesk.internal", responseSchema: TicketDetailListSchema,
  });
}

export async function getTicketAnalytics() {
  return fetchJson("/api/v1/citizen/tickets/analytics", {} as TicketAnalyticsSchema, {
    revalidateSeconds: 300, telemetryKey: "helpdesk.analytics", responseSchema: TicketAnalyticsSchema,
  });
}

export async function getCitizenRequests() {
  return fetchJson("/api/v1/citizen/requests", [] as CitizenRequestSummary[], {
    revalidateSeconds: 60, telemetryKey: "citizen.requests", responseSchema: CitizenRequestSummaryListSchema,
  });
}

export async function getRTIApplications() {
  return fetchJson("/api/v1/citizen/rti", [] as RTISummary[], {
    revalidateSeconds: 120, telemetryKey: "citizen.rti", responseSchema: RTISummaryListSchema,
  });
}
```

## Step 5 — Build each page

### 5.1 `/crm/dashboard/page.tsx`

- 4 stats: Total Contacts, Open Deals, Activities Due Today, Pipeline Value (₹)
- Quick links to Contacts, Deals, Activities
- API: `getCRMDashboard()`

### 5.2 Enhance `/crm/contacts/page.tsx`

Read existing and add:
- Table columns: Name, Organization, Phone, Email, Last Activity Date, Tags
- Link from each row to `/crm/contacts/[id]`

### 5.3 `/crm/contacts/[id]/page.tsx`

- Profile header: Name, Organization, Designation, Phone, Email, City, Tags
- Related Deals section: table of deal name, stage, amount
- Activity Timeline: type, subject, due date, status
- API: `getContactById(params.id)`

### 5.4 Enhance `/crm/deals/page.tsx`

Read existing and add:
- Table columns: Deal Name, Contact, Stage, Amount (₹), Probability %, Owner, Close Date, Status
- Stage pills: prospecting=gray, qualification=blue, proposal=yellow, negotiation=orange, closed_won=green, closed_lost=red
- Status pills: open=blue, won=green, lost=red
- Link from each row to `/crm/deals/[id]`
- 4 stats: Total Deals, Open, Pipeline Value, Won Value

### 5.5 `/crm/deals/[id]/page.tsx`

- Deal header: Deal Name, Contact, Stage, Amount, Probability, Owner, Close Date, Status
- Activity log section
- API: `getDealById(params.id)`

### 5.6 Enhance `/crm/activities/page.tsx`

Read existing and add:
- Table columns: Type, Subject, Related To, Due Date, Completed At, Owner, Status
- Type pills: call=blue, meeting=purple, email=gray, task=yellow, note=green
- Status pills: open=blue, overdue=red, completed=green, cancelled=gray
- 4 stats: Total, Due Today, Overdue, Completed

### 5.7 Enhance `/helpdesk/tickets/page.tsx`

Read existing and add:
- Table columns: Ticket No, Subject, Requester, Priority, SLA Status, Status, Created, Channel
- Priority pills: low=gray, medium=blue, high=orange, critical=red
- SLA status pills: within_sla=green, due_soon=yellow, breached=red
- Status pills: open=blue, in_progress=yellow, pending=orange, resolved=green, closed=gray
- Stats: Total, Open, SLA Breached, Resolved Today

### 5.8 `/helpdesk/tickets/[id]/page.tsx`

Create `apps/web/src/app/(app)/helpdesk/tickets/[id]/page.tsx`:
- Ticket header: Ticket No, Subject, Status, Priority, SLA, Requester, Assigned To
- Description section
- Comments/Timeline section: list of comments (internal ones marked differently)
- API: `getHelpdeskTicketById(params.id)`

### 5.9 `/helpdesk/slas/page.tsx`

Create `apps/web/src/app/(app)/helpdesk/slas/page.tsx`:
- Shows tickets where slaStatus = "breached" (filter from full list)
- Title: "SLA Queue — Breached Tickets"
- Table same as tickets but sorted by age
- API: `getBreachedSLATickets()`

### 5.10 `/helpdesk/internal/page.tsx`

Create `apps/web/src/app/(app)/helpdesk/internal/page.tsx`:
- Same structure as tickets page but from internal helpdesk API
- Title: "Internal Helpdesk Tickets"
- API: `getInternalHelpdeskTickets()`

### 5.11 `/helpdesk/reports/page.tsx`

Create `apps/web/src/app/(app)/helpdesk/reports/page.tsx`:
- 5 stat cards: Total, Open, Resolved This Month, SLA Breached, Avg Resolution Hours
- By Priority breakdown table: Priority, Count, % of Total (CSS bar width % in a `<div>` element)
- By Channel breakdown table: Channel, Count, %
- API: `getTicketAnalytics()`

### 5.12 `/citizen/requests/page.tsx`

Create `apps/web/src/app/(app)/citizen/requests/page.tsx`:
- Table: Request No, Service Type, Citizen Name, Phone, Submitted At, Expected Resolution, Status
- Status pills: submitted=blue, under_review=yellow, in_progress=orange, resolved=green, rejected=red
- 4 stats: Total, Under Review, Resolved, Rejected
- API: `getCitizenRequests()`

### 5.13 `/citizen/rti/page.tsx`

Create `apps/web/src/app/(app)/citizen/rti/page.tsx`:
- Table: RTI No, Applicant Name, Subject, Public Authority, Filed Date, Deadline, Status, First Appeal?
- Status pills: received=blue, forwarded=yellow, under_review=orange, replied=green, appeal=red, closed=gray
- 4 stats: Total, Pending Reply, Overdue (where deadlineDate < today), Replied
- API: `getRTIApplications()`

## Step 6 — Update hub pages

Update `/crm/page.tsx` to include tiles for: Dashboard, Contacts, Deals, Activities
Update `/helpdesk/page.tsx` to include tiles for: Tickets, SLA Queue, Internal, Reports
Create or update `/citizen/page.tsx` to include tiles for: Requests, RTI Applications, Feedback

## Step 7 — Verification

```bash
cd ~/CivitasOne/civitasone-suite
pnpm --filter @civitasone/schemas typecheck
pnpm --filter @civitasone/web typecheck
```
