# 31-web-hr — Build HR/HRMS Module Web Screens

## Context

You are building Next.js web screens for the HR/HRMS module of CivitasOne, a government ERP platform.

### Pattern every screen MUST follow

1. **Server Component** — `apps/web/src/app/(app)/{module}/{screen}/page.tsx` — async function, calls a loader, renders JSX with Tailwind
2. **Loader** — added to `apps/web/src/app/_data/loaders.ts` — calls `fetchJson(apiPath, empty, { revalidateSeconds, telemetryKey, responseSchema, mapResponse })`
3. **Zod schema** — added to `packages/schemas/src/web.ts`
4. **Type** — summary types in `packages/types/src/index.ts`
5. **Components**: `PageShell`, `DataSourceBadge` from `@civitasone/ui-kit`
6. **Breadcrumb**: `<Link href="/hr">HR</Link> / ScreenName`
7. **Stats row**: 4 `<div class="stat">` cards
8. **Table**: `<table class="tbl">` with thead + tbody
9. **Status pills**: `<span class="rounded-full bg-{color}-50 px-2 py-1 text-xs ...">status</span>`
10. **Error handling**: `{source === "error" ? <DataSourceBadge source={source} /> : null}`

### Gateway API prefixes
- hrms: `/api/v1/hrms`
- payroll: `/api/v1/payroll`

## Step 1 — Read existing patterns

Read these files first:
```
apps/web/src/app/(app)/hr/employees/page.tsx
apps/web/src/app/(app)/hr/attendance/page.tsx
apps/web/src/app/(app)/hr/leave/page.tsx
apps/web/src/app/(app)/hr/payroll/page.tsx
apps/web/src/app/_data/loaders.ts
packages/schemas/src/web.ts
packages/types/src/index.ts
apps/web/src/app/(app)/hr/page.tsx
```

Also read HTML prototypes from `~/CivitasOne/erpnext-develop/hr-module/web/`:
- `dashboard.html`, `directory.html`, `attendance.html`, `leave.html`, `leave-form.html`
- `payroll.html`, `salary-slip.html`, `recruitment.html`, `appraisals.html`
- `training.html`, `service-book.html`, `orgchart.html`

## Step 2 — Add Zod schemas to `packages/schemas/src/web.ts`

Append (do not overwrite):

```typescript
// HR schemas
export const HRDashboardSchema = z.object({
  headcount: z.number().default(0),
  attendanceTodayPct: z.number().default(0),
  pendingLeaves: z.number().default(0),
  payrollDue: z.number().default(0),
});

export const AttendanceSummaryItemSchema = z.object({
  id: z.string(),
  employeeId: z.string(),
  employeeName: z.string(),
  department: z.string(),
  date: z.string(),
  checkIn: z.string().optional(),
  checkOut: z.string().optional(),
  status: z.enum(["present", "absent", "half_day", "on_leave", "holiday"]),
  hoursWorked: z.number().optional(),
});
export const AttendanceSummaryListSchema = z.array(AttendanceSummaryItemSchema);

export const AttendanceRegularisationSchema = z.object({
  id: z.string(),
  employeeId: z.string(),
  employeeName: z.string(),
  date: z.string(),
  reason: z.string(),
  requestedStatus: z.string(),
  status: z.enum(["pending", "approved", "rejected"]),
  requestedAt: z.string(),
});
export const AttendanceRegularisationListSchema = z.array(AttendanceRegularisationSchema);

export const LeaveRequestDetailSchema = z.object({
  id: z.string(),
  employeeId: z.string(),
  employeeName: z.string(),
  leaveType: z.string(),
  fromDate: z.string(),
  toDate: z.string(),
  days: z.number(),
  reason: z.string().optional(),
  approver: z.string().optional(),
  status: z.enum(["pending", "approved", "rejected", "cancelled"]),
  appliedAt: z.string(),
});
export const LeaveRequestDetailListSchema = z.array(LeaveRequestDetailSchema);

export const PayrollRunDetailSchema = z.object({
  id: z.string(),
  runDate: z.string(),
  payPeriod: z.string(),
  employeeCount: z.number(),
  grossAmount: z.number(),
  netAmount: z.number(),
  deductions: z.number(),
  status: z.enum(["draft", "processing", "completed", "paid"]),
});
export const PayrollRunDetailListSchema = z.array(PayrollRunDetailSchema);

export const PayrollRunFullDetailSchema = PayrollRunDetailSchema.extend({
  salarySlips: z.array(z.object({
    id: z.string(),
    employeeId: z.string(),
    employeeName: z.string(),
    gross: z.number(),
    deductions: z.number(),
    net: z.number(),
    status: z.string(),
  })).default([]),
});

export const SalarySlipSummarySchema = z.object({
  id: z.string(),
  employeeId: z.string(),
  employeeName: z.string(),
  department: z.string(),
  payPeriod: z.string(),
  gross: z.number(),
  deductions: z.number(),
  net: z.number(),
  status: z.enum(["draft", "finalized", "paid"]),
});
export const SalarySlipSummaryListSchema = z.array(SalarySlipSummarySchema);

export const JobOpeningSummarySchema = z.object({
  id: z.string(),
  jobTitle: z.string(),
  department: z.string(),
  vacancies: z.number(),
  applicationDeadline: z.string().optional(),
  status: z.enum(["open", "closed", "on_hold"]),
  applicationsReceived: z.number().default(0),
  postedDate: z.string(),
});
export const JobOpeningSummaryListSchema = z.array(JobOpeningSummarySchema);

export const AppraisalSummarySchema = z.object({
  id: z.string(),
  employeeId: z.string(),
  employeeName: z.string(),
  department: z.string(),
  appraisalPeriod: z.string(),
  rating: z.number().optional(),
  status: z.enum(["pending", "in_review", "completed"]),
  reviewerName: z.string().optional(),
});
export const AppraisalSummaryListSchema = z.array(AppraisalSummarySchema);

export const TrainingProgramSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  category: z.string(),
  trainerName: z.string().optional(),
  startDate: z.string(),
  endDate: z.string(),
  venue: z.string().optional(),
  enrolledCount: z.number().default(0),
  maxCapacity: z.number().optional(),
  status: z.enum(["upcoming", "ongoing", "completed", "cancelled"]),
});
export const TrainingProgramSummaryListSchema = z.array(TrainingProgramSummarySchema);

export const OrgChartNodeSchema: z.ZodType<{
  id: string;
  name: string;
  designation: string;
  department: string;
  reportsTo?: string | null;
  children?: OrgChartNode[];
}> = z.lazy(() => z.object({
  id: z.string(),
  name: z.string(),
  designation: z.string(),
  department: z.string(),
  reportsTo: z.string().nullable().optional(),
  children: z.array(OrgChartNodeSchema).optional(),
}));
export const OrgChartSchema = z.array(OrgChartNodeSchema);
```

## Step 3 — Add types to `packages/types/src/index.ts`

Append (check for duplicates first):

```typescript
export type AttendanceSummaryItem = {
  id: string;
  employeeId: string;
  employeeName: string;
  department: string;
  date: string;
  checkIn?: string;
  checkOut?: string;
  status: "present" | "absent" | "half_day" | "on_leave" | "holiday";
  hoursWorked?: number;
};

export type LeaveRequestDetail = {
  id: string;
  employeeId: string;
  employeeName: string;
  leaveType: string;
  fromDate: string;
  toDate: string;
  days: number;
  reason?: string;
  approver?: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  appliedAt: string;
};

export type PayrollRunDetail = {
  id: string;
  runDate: string;
  payPeriod: string;
  employeeCount: number;
  grossAmount: number;
  netAmount: number;
  deductions: number;
  status: "draft" | "processing" | "completed" | "paid";
};

export type SalarySlipSummary = {
  id: string;
  employeeId: string;
  employeeName: string;
  department: string;
  payPeriod: string;
  gross: number;
  deductions: number;
  net: number;
  status: "draft" | "finalized" | "paid";
};

export type JobOpeningSummary = {
  id: string;
  jobTitle: string;
  department: string;
  vacancies: number;
  applicationDeadline?: string;
  status: "open" | "closed" | "on_hold";
  applicationsReceived: number;
  postedDate: string;
};

export type AppraisalSummary = {
  id: string;
  employeeId: string;
  employeeName: string;
  department: string;
  appraisalPeriod: string;
  rating?: number;
  status: "pending" | "in_review" | "completed";
  reviewerName?: string;
};

export type TrainingProgramSummary = {
  id: string;
  title: string;
  category: string;
  trainerName?: string;
  startDate: string;
  endDate: string;
  venue?: string;
  enrolledCount: number;
  maxCapacity?: number;
  status: "upcoming" | "ongoing" | "completed" | "cancelled";
};

export type OrgChartNode = {
  id: string;
  name: string;
  designation: string;
  department: string;
  reportsTo?: string | null;
  children?: OrgChartNode[];
};
```

## Step 4 — Add loaders to `apps/web/src/app/_data/loaders.ts`

Append these loaders:

```typescript
export async function getHRDashboard() {
  return fetchJson("/api/v1/hrms/employees", {} as HRDashboardSchema, {
    revalidateSeconds: 60,
    telemetryKey: "hr.dashboard",
    responseSchema: HRDashboardSchema,
  });
}

export async function getAttendanceList() {
  return fetchJson("/api/v1/hrms/attendance", [] as AttendanceSummaryItem[], {
    revalidateSeconds: 60,
    telemetryKey: "hr.attendance",
    responseSchema: AttendanceSummaryListSchema,
  });
}

export async function getAttendanceRegularisations() {
  return fetchJson("/api/v1/hrms/attendance/regularisations", [] as AttendanceRegularisation[], {
    revalidateSeconds: 60,
    telemetryKey: "hr.attendance.regularisations",
    responseSchema: AttendanceRegularisationListSchema,
  });
}

export async function getLeaveRequests() {
  return fetchJson("/api/v1/hrms/leave-requests", [] as LeaveRequestDetail[], {
    revalidateSeconds: 60,
    telemetryKey: "hr.leave",
    responseSchema: LeaveRequestDetailListSchema,
  });
}

export async function getPayrollRuns() {
  return fetchJson("/api/v1/payroll/runs", [] as PayrollRunDetail[], {
    revalidateSeconds: 120,
    telemetryKey: "hr.payroll.runs",
    responseSchema: PayrollRunDetailListSchema,
  });
}

export async function getPayrollRunById(id: string) {
  return fetchJson(`/api/v1/payroll/runs/${id}`, null, {
    revalidateSeconds: 60,
    telemetryKey: "hr.payroll.run.detail",
    responseSchema: PayrollRunFullDetailSchema,
  });
}

export async function getSalarySlips() {
  return fetchJson("/api/v1/payroll/salary-slips", [] as SalarySlipSummary[], {
    revalidateSeconds: 120,
    telemetryKey: "hr.salary-slips",
    responseSchema: SalarySlipSummaryListSchema,
  });
}

export async function getJobOpenings() {
  return fetchJson("/api/v1/hrms/job-openings", [] as JobOpeningSummary[], {
    revalidateSeconds: 120,
    telemetryKey: "hr.recruitment",
    responseSchema: JobOpeningSummaryListSchema,
  });
}

export async function getAppraisals() {
  return fetchJson("/api/v1/hrms/appraisals", [] as AppraisalSummary[], {
    revalidateSeconds: 120,
    telemetryKey: "hr.appraisals",
    responseSchema: AppraisalSummaryListSchema,
  });
}

export async function getTrainingPrograms() {
  return fetchJson("/api/v1/hrms/training-programs", [] as TrainingProgramSummary[], {
    revalidateSeconds: 300,
    telemetryKey: "hr.training",
    responseSchema: TrainingProgramSummaryListSchema,
  });
}

export async function getOrgChart() {
  return fetchJson("/api/v1/hrms/org-chart", [] as OrgChartNode[], {
    revalidateSeconds: 600,
    telemetryKey: "hr.orgchart",
    responseSchema: OrgChartSchema,
  });
}
```

## Step 5 — Build each page

### 5.1 `/hr/dashboard/page.tsx`

Create `apps/web/src/app/(app)/hr/dashboard/page.tsx` with:
- Breadcrumb: HR / Dashboard
- 4 stat cards: Headcount, Attendance Today %, Pending Leaves, Payroll Due
- Quick links grid to all sub-modules
- API: uses `getHRDashboard()`

### 5.2 Enhance `/hr/employees/page.tsx`

Read the existing file and enhance it to add:
- Department filter (select dropdown, client component or use URL search params)
- Status filter (active/inactive/on_leave)
- Employee ID, Name, Department, Designation, Status columns
- Link from each row to `/hr/employees/[id]`

### 5.3 `/hr/employees/[id]/page.tsx`

Create `apps/web/src/app/(app)/hr/employees/[id]/page.tsx`:
- API: `GET /api/v1/hrms/employees/:id`
- Add a loader `getEmployeeById(id: string)` in loaders.ts with a basic employee detail schema
- Show: Personal info section, Designation/department, Service book highlights, Current posting
- Breadcrumb: HR / Employees / [employeeName]

For the employee detail schema, use:
```typescript
export const EmployeeDetailSchema = z.object({
  id: z.string(),
  employeeId: z.string(),
  name: z.string(),
  email: z.string().optional(),
  phone: z.string().optional(),
  department: z.string(),
  designation: z.string(),
  grade: z.string().optional(),
  joiningDate: z.string(),
  status: z.string(),
  reportingTo: z.string().optional(),
  postingLocation: z.string().optional(),
});
```

### 5.4 Enhance `/hr/attendance/page.tsx`

Read the existing file and enhance:
- Date filter (date input, use `searchParams`)
- Status filter (present/absent/half_day/on_leave/holiday)
- Table columns: Employee ID, Name, Department, Date, Check In, Check Out, Hours, Status
- Status pills: present=green, absent=red, half_day=yellow, on_leave=blue, holiday=gray

### 5.5 `/hr/attendance/regularisation/page.tsx`

Create `apps/web/src/app/(app)/hr/attendance/regularisation/page.tsx`:
- Breadcrumb: HR / Attendance / Regularisation
- 4 stats: Total Requests, Pending, Approved, Rejected
- Table: Employee, Date, Reason, Requested Status, Request Date, Status
- Status pills: pending=yellow, approved=green, rejected=red
- Uses `getAttendanceRegularisations()`

### 5.6 Enhance `/hr/leave/page.tsx`

Read existing and enhance:
- Table columns: Employee, Leave Type, From Date, To Date, Days, Approver, Applied At, Status
- Status pills: pending=yellow, approved=green, rejected=red, cancelled=gray
- Add New Leave button linking to `/hr/leave/apply`

### 5.7 `/hr/leave/apply/page.tsx` — CLIENT COMPONENT

Create `apps/web/src/app/(app)/hr/leave/apply/page.tsx` as `"use client"`:
- Form fields: Employee ID (text), Leave Type (select: casual/earned/medical/special), From Date, To Date, Reason (textarea)
- Auto-calculate days from date range
- Submit: `fetch("/api/proxy/v1/hrms/leave-requests", { method: "POST", body: ... })`
- Show success/error toast
- Breadcrumb: HR / Leave / Apply

### 5.8 Enhance `/hr/payroll/page.tsx`

Read existing and enhance:
- Table: Pay Period, Run Date, Employee Count, Gross Amount, Deductions, Net Amount, Status
- Status pills: draft=gray, processing=yellow, completed=blue, paid=green
- Link from each row to `/hr/payroll/[id]`
- Stats: Total Runs, Total Employees Paid, Total Net Disbursed, Last Run Date

### 5.9 `/hr/payroll/[id]/page.tsx`

Create `apps/web/src/app/(app)/hr/payroll/[id]/page.tsx`:
- API: uses `getPayrollRunById(params.id)`
- Header section with run summary (pay period, run date, total gross, net, deductions, status)
- Salary slips table: Employee ID, Name, Gross, Deductions, Net, Status
- Breadcrumb: HR / Payroll / [payPeriod]

### 5.10 `/hr/payroll/salary-slips/page.tsx`

Create `apps/web/src/app/(app)/hr/payroll/salary-slips/page.tsx`:
- Table: Employee ID, Name, Department, Pay Period, Gross, Deductions, Net, Status
- Status pills: draft=gray, finalized=blue, paid=green
- 4 stats: Total Slips, Total Gross, Total Net, Pending (draft count)

### 5.11 `/hr/recruitment/page.tsx`

Create `apps/web/src/app/(app)/hr/recruitment/page.tsx`:
- Table: Job Title, Department, Vacancies, Applications Received, Deadline, Posted Date, Status
- Status pills: open=green, closed=gray, on_hold=yellow
- 4 stats: Total Openings, Open Positions, Applications Received (sum), Closed

### 5.12 `/hr/appraisals/page.tsx`

Create `apps/web/src/app/(app)/hr/appraisals/page.tsx`:
- Table: Employee, Department, Appraisal Period, Rating (or "Pending"), Reviewer, Status
- Status pills: pending=yellow, in_review=blue, completed=green
- Stats: Total, Pending, In Review, Completed

### 5.13 `/hr/training/page.tsx`

Create `apps/web/src/app/(app)/hr/training/page.tsx`:
- Table: Title, Category, Trainer, Start Date, End Date, Venue, Enrolled/Capacity, Status
- Status pills: upcoming=blue, ongoing=green, completed=gray, cancelled=red
- Stats: Total Programs, Upcoming, Ongoing, Total Enrolled

### 5.14 `/hr/orgchart/page.tsx` — CLIENT COMPONENT for interactive tree

Create `apps/web/src/app/(app)/hr/orgchart/page.tsx` as `"use client"`:
- Fetch `/api/v1/hrms/org-chart` from client using `useEffect`
- Render a tree using CSS flexbox (no canvas, no external lib)
- Each node: name, designation, department as a card
- Children are indented below parent with a connecting line using CSS border
- Show loading state while fetching
- Show empty state if no org chart data

## Step 6 — Update `/hr/page.tsx`

Read the existing file and update it to include nav tiles for all sub-modules:
- Dashboard (`/hr/dashboard`)
- Employees (`/hr/employees`)
- Attendance (`/hr/attendance`)
- Attendance Regularisation (`/hr/attendance/regularisation`)
- Leave Management (`/hr/leave`)
- Apply Leave (`/hr/leave/apply`)
- Payroll Runs (`/hr/payroll`)
- Salary Slips (`/hr/payroll/salary-slips`)
- Recruitment (`/hr/recruitment`)
- Appraisals (`/hr/appraisals`)
- Training Programs (`/hr/training`)
- Org Chart (`/hr/orgchart`)

## Step 7 — Verification

```bash
cd ~/CivitasOne/civitasone-suite
pnpm --filter @civitasone/schemas typecheck
pnpm --filter @civitasone/web typecheck
```

Fix TypeScript errors before finishing. Watch for:
- `AttendanceRegularisation` type must be exported from `packages/types/src/index.ts`
- OrgChartNodeSchema uses `z.lazy()` — ensure the referenced type is correct
- `searchParams` in server components must have type `{ [key: string]: string | string[] | undefined }`
