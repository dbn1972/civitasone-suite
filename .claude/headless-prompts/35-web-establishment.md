# 35-web-establishment — Build Establishment Module Web Screens

## Context

CivitasOne government ERP — Next.js screens for the Establishment module (file management, meetings, vehicles, guesthouse, compliance).

### Pattern every screen MUST follow

1. Server Component — async function, loader, JSX with Tailwind
2. Loader in `apps/web/src/app/_data/loaders.ts` using `fetchJson`
3. Zod schema in `packages/schemas/src/web.ts`
4. Type in `packages/types/src/index.ts`
5. `PageShell`, `DataSourceBadge` from `@civitasone/ui-kit`
6. Breadcrumb, 4 Stats cards, `<table class="tbl">`, status pills, error badge

### Gateway API prefix
- estab: `/api/v1/estab`

## Step 1 — Read existing files

```
apps/web/src/app/(app)/estab/list/page.tsx
apps/web/src/app/_data/loaders.ts
packages/schemas/src/web.ts
packages/types/src/index.ts
apps/web/src/app/(app)/estab/page.tsx
```

Also read ALL HTML prototypes from `~/CivitasOne/erpnext-develop/establishment-module/web/` — list the directory first and read all .html files found.

## Step 2 — Add Zod schemas to `packages/schemas/src/web.ts`

Append:

```typescript
// Establishment schemas
export const EstabDashboardSchema = z.object({
  filesPending: z.number().default(0),
  meetingsToday: z.number().default(0),
  vehiclesInUse: z.number().default(0),
  complianceItemsDue: z.number().default(0),
});

export const EstabFileSummarySchema = z.object({
  id: z.string(),
  fileNo: z.string(),
  subject: z.string(),
  classification: z.enum(["top_secret", "secret", "confidential", "restricted", "unclassified"]),
  department: z.string().optional(),
  createdBy: z.string(),
  createdDate: z.string(),
  currentHolder: z.string().optional(),
  status: z.enum(["active", "pending", "archived", "disposed"]),
  tags: z.array(z.string()).default([]),
});
export const EstabFileSummaryListSchema = z.array(EstabFileSummarySchema);

export const EstabFileDetailSchema = EstabFileSummarySchema.extend({
  noteSheets: z.array(z.object({
    id: z.string(),
    author: z.string(),
    content: z.string(),
    timestamp: z.string(),
    type: z.enum(["note", "order", "remark"]),
  })).default([]),
  dispatchHistory: z.array(z.object({
    id: z.string(),
    dispatchedTo: z.string(),
    dispatchedBy: z.string(),
    timestamp: z.string(),
    remarks: z.string().optional(),
  })).default([]),
  attachments: z.array(z.object({
    id: z.string(),
    fileName: z.string(),
    fileType: z.string(),
    size: z.number(),
    uploadedAt: z.string(),
  })).default([]),
});

export const MeetingSummarySchema = z.object({
  id: z.string(),
  meetingNo: z.string(),
  title: z.string(),
  type: z.enum(["cabinet", "committee", "department", "review", "external"]),
  scheduledDate: z.string(),
  scheduledTime: z.string().optional(),
  venue: z.string().optional(),
  chairperson: z.string().optional(),
  attendeesCount: z.number().default(0),
  agendaItemsCount: z.number().default(0),
  status: z.enum(["scheduled", "in_progress", "completed", "cancelled", "postponed"]),
});
export const MeetingSummaryListSchema = z.array(MeetingSummarySchema);

export const MeetingDetailSchema = MeetingSummarySchema.extend({
  agenda: z.array(z.object({
    id: z.string(),
    itemNo: z.number(),
    title: z.string(),
    description: z.string().optional(),
    decision: z.string().optional(),
  })).default([]),
  minutes: z.string().optional(),
  attendees: z.array(z.object({
    name: z.string(),
    designation: z.string().optional(),
    present: z.boolean().default(true),
  })).default([]),
  actionPoints: z.array(z.object({
    id: z.string(),
    description: z.string(),
    assignedTo: z.string(),
    dueDate: z.string().optional(),
    status: z.enum(["pending", "completed"]),
  })).default([]),
});

export const VehicleSummarySchema = z.object({
  id: z.string(),
  vehicleNo: z.string(),
  make: z.string(),
  model: z.string(),
  type: z.enum(["sedan", "suv", "bus", "van", "truck", "ambulance", "other"]),
  assignedTo: z.string().optional(),
  driverName: z.string().optional(),
  fuelType: z.enum(["petrol", "diesel", "cng", "electric"]),
  status: z.enum(["available", "in_use", "maintenance", "reserved", "disposed"]),
  lastServiceDate: z.string().optional(),
  nextServiceDue: z.string().optional(),
  odometerKm: z.number().default(0),
});
export const VehicleSummaryListSchema = z.array(VehicleSummarySchema);

export const GuesthouseBookingSummarySchema = z.object({
  id: z.string(),
  bookingNo: z.string(),
  guestName: z.string(),
  designation: z.string().optional(),
  department: z.string().optional(),
  checkInDate: z.string(),
  checkOutDate: z.string(),
  roomType: z.string().optional(),
  roomNo: z.string().optional(),
  purposeOfVisit: z.string().optional(),
  status: z.enum(["pending", "confirmed", "checked_in", "checked_out", "cancelled"]),
});
export const GuesthouseBookingSummaryListSchema = z.array(GuesthouseBookingSummarySchema);

export const ComplianceSummarySchema = z.object({
  id: z.string(),
  complianceCode: z.string(),
  title: z.string(),
  category: z.string(),
  frequency: z.enum(["daily", "weekly", "monthly", "quarterly", "annual", "one_time"]),
  dueDate: z.string(),
  assignedTo: z.string().optional(),
  status: z.enum(["pending", "complied", "overdue", "not_applicable"]),
  lastCompliedDate: z.string().optional(),
  remarks: z.string().optional(),
});
export const ComplianceSummaryListSchema = z.array(ComplianceSummarySchema);
```

## Step 3 — Add types to `packages/types/src/index.ts`

Append:

```typescript
export type EstabFileSummary = {
  id: string;
  fileNo: string;
  subject: string;
  classification: "top_secret" | "secret" | "confidential" | "restricted" | "unclassified";
  department?: string;
  createdBy: string;
  createdDate: string;
  currentHolder?: string;
  status: "active" | "pending" | "archived" | "disposed";
  tags: string[];
};

export type MeetingSummary = {
  id: string;
  meetingNo: string;
  title: string;
  type: "cabinet" | "committee" | "department" | "review" | "external";
  scheduledDate: string;
  scheduledTime?: string;
  venue?: string;
  chairperson?: string;
  attendeesCount: number;
  agendaItemsCount: number;
  status: "scheduled" | "in_progress" | "completed" | "cancelled" | "postponed";
};

export type VehicleSummary = {
  id: string;
  vehicleNo: string;
  make: string;
  model: string;
  type: "sedan" | "suv" | "bus" | "van" | "truck" | "ambulance" | "other";
  assignedTo?: string;
  driverName?: string;
  fuelType: "petrol" | "diesel" | "cng" | "electric";
  status: "available" | "in_use" | "maintenance" | "reserved" | "disposed";
  lastServiceDate?: string;
  nextServiceDue?: string;
  odometerKm: number;
};

export type GuesthouseBookingSummary = {
  id: string;
  bookingNo: string;
  guestName: string;
  designation?: string;
  department?: string;
  checkInDate: string;
  checkOutDate: string;
  roomType?: string;
  roomNo?: string;
  purposeOfVisit?: string;
  status: "pending" | "confirmed" | "checked_in" | "checked_out" | "cancelled";
};
```

## Step 4 — Add loaders

Append to `apps/web/src/app/_data/loaders.ts`:

```typescript
export async function getEstabDashboard() {
  return fetchJson("/api/v1/estab/files", {} as EstabDashboardSchema, {
    revalidateSeconds: 60, telemetryKey: "estab.dashboard", responseSchema: EstabDashboardSchema,
  });
}

export async function getEstabFiles() {
  return fetchJson("/api/v1/estab/files", [] as EstabFileSummary[], {
    revalidateSeconds: 60, telemetryKey: "estab.files", responseSchema: EstabFileSummaryListSchema,
  });
}

export async function getEstabFileById(id: string) {
  return fetchJson(`/api/v1/estab/files/${id}`, null, {
    revalidateSeconds: 30, telemetryKey: "estab.file.detail", responseSchema: EstabFileDetailSchema,
  });
}

export async function getMeetings() {
  return fetchJson("/api/v1/estab/meetings", [] as MeetingSummary[], {
    revalidateSeconds: 60, telemetryKey: "estab.meetings", responseSchema: MeetingSummaryListSchema,
  });
}

export async function getMeetingById(id: string) {
  return fetchJson(`/api/v1/estab/meetings/${id}`, null, {
    revalidateSeconds: 30, telemetryKey: "estab.meeting.detail", responseSchema: MeetingDetailSchema,
  });
}

export async function getVehicles() {
  return fetchJson("/api/v1/estab/vehicles", [] as VehicleSummary[], {
    revalidateSeconds: 120, telemetryKey: "estab.vehicles", responseSchema: VehicleSummaryListSchema,
  });
}

export async function getGuesthouseBookings() {
  return fetchJson("/api/v1/estab/guesthouse-bookings", [] as GuesthouseBookingSummary[], {
    revalidateSeconds: 60, telemetryKey: "estab.guesthouse", responseSchema: GuesthouseBookingSummaryListSchema,
  });
}

export async function getEstabCompliance() {
  return fetchJson("/api/v1/estab/compliance", [] as ComplianceSummarySchema[], {
    revalidateSeconds: 120, telemetryKey: "estab.compliance", responseSchema: ComplianceSummaryListSchema,
  });
}
```

## Step 5 — Build each page

### 5.1 `/estab/dashboard/page.tsx`

- 4 stats: Files Pending, Meetings Today, Vehicles In Use, Compliance Items Due
- Quick links to Files, Meetings, Vehicles, Guesthouse, Compliance
- API: `getEstabDashboard()`

### 5.2 Enhance `/estab/list/page.tsx`

Read existing and update:
- Table columns: File No, Subject, Classification, Department, Created By, Created Date, Current Holder, Status
- Classification pills: top_secret=red, secret=orange, confidential=yellow, restricted=blue, unclassified=gray
- Status pills: active=green, pending=yellow, archived=gray, disposed=red
- Search/filter bar (file number search, classification filter, status filter)
- Add New File button linking to `/estab/files/new`
- Link from each row to `/estab/files/[id]`

### 5.3 `/estab/files/[id]/page.tsx`

Create `apps/web/src/app/(app)/estab/files/[id]/page.tsx`:
- Header: File No, Subject, Classification badge, Department, Status, Current Holder
- Note Sheets section: timeline of notes/orders/remarks with author, timestamp, content, type badge
  - type pills: note=blue, order=green, remark=gray
- Dispatch History section: table of dispatched to, from, timestamp, remarks
- Attachments section: list of attachments with file name, type, size, upload date
- API: `getEstabFileById(params.id)`

### 5.4 `/estab/files/new/page.tsx` — CLIENT COMPONENT

Create `apps/web/src/app/(app)/estab/files/new/page.tsx` as `"use client"`:
- Form fields:
  - Subject (text input, required)
  - Classification (select: unclassified/restricted/confidential/secret/top_secret)
  - Department (text input)
  - Tags (text input, comma-separated)
  - Initial Note (textarea)
- Submit: `fetch("/api/proxy/v1/estab/files", { method: "POST", body: ... })`
- Success toast with file number from response
- Cancel links back to `/estab/list`

### 5.5 `/estab/meetings/page.tsx`

Create `apps/web/src/app/(app)/estab/meetings/page.tsx`:
- Table: Meeting No, Title, Type, Scheduled Date, Time, Venue, Chairperson, Attendees, Status
- Type pills: cabinet=red, committee=blue, department=green, review=yellow, external=gray
- Status pills: scheduled=blue, in_progress=green, completed=gray, cancelled=red, postponed=yellow
- 4 stats: Total, Scheduled (today+future), Completed, Cancelled
- New Meeting button

### 5.6 `/estab/meetings/[id]/page.tsx`

Create `apps/web/src/app/(app)/estab/meetings/[id]/page.tsx`:
- Header: Meeting No, Title, Date/Time, Venue, Chairperson, Status
- Attendees section: table of name, designation, present (yes/no)
- Agenda section: numbered list of agenda items with title, description, decision
- Minutes section: pre-formatted text block
- Action Points section: table of description, assigned to, due date, status
  - status pills: pending=yellow, completed=green
- API: `getMeetingById(params.id)`

### 5.7 `/estab/vehicles/page.tsx`

Create `apps/web/src/app/(app)/estab/vehicles/page.tsx`:
- Table: Vehicle No, Make, Model, Type, Assigned To, Driver, Fuel Type, Odometer (km), Next Service Due, Status
- Status pills: available=green, in_use=blue, maintenance=yellow, reserved=purple, disposed=gray
- Type pills: sedan/suv/bus/van = simple text with capitalize
- Fuel type: petrol=gray, diesel=gray, cng=green, electric=blue
- 4 stats: Total, Available, In Use, Under Maintenance

### 5.8 `/estab/guesthouse/page.tsx`

Create `apps/web/src/app/(app)/estab/guesthouse/page.tsx`:
- Table: Booking No, Guest Name, Designation, Dept, Check-in, Check-out, Room Type, Room No, Status
- Status pills: pending=yellow, confirmed=blue, checked_in=green, checked_out=gray, cancelled=red
- 4 stats: Total, Currently Occupied, Upcoming, Cancelled

### 5.9 `/estab/compliance/page.tsx`

Create `apps/web/src/app/(app)/estab/compliance/page.tsx`:
- Table: Code, Title, Category, Frequency, Due Date, Assigned To, Last Complied, Status
- Status pills: pending=yellow, complied=green, overdue=red, not_applicable=gray
- Frequency pills: daily/weekly/monthly/quarterly/annual/one_time = small text label
- 4 stats: Total, Pending, Overdue, Complied This Month

## Step 6 — Update `/estab/page.tsx`

Add tiles for all sub-modules:
- Dashboard, Files List, New File, Meetings, Vehicles, Guesthouse, Compliance

## Step 7 — Verification

```bash
cd ~/CivitasOne/civitasone-suite
pnpm --filter @civitasone/schemas typecheck
pnpm --filter @civitasone/web typecheck
```
