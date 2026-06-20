# 39-web-analytics-knowledge — Build Analytics + Knowledge/DMS Screens

## Context

CivitasOne government ERP — Next.js screens for Analytics/Reports and Knowledge Management/DMS modules.

### Pattern every screen MUST follow

1. Server Component — async function, loader, JSX with Tailwind
2. Loader in `apps/web/src/app/_data/loaders.ts` using `fetchJson`
3. Zod schema in `packages/schemas/src/web.ts`
4. Type in `packages/types/src/index.ts`
5. `PageShell`, `DataSourceBadge` from `@civitasone/ui-kit`
6. Breadcrumb, 4 Stats cards, `<table class="tbl">`, status pills, error badge

### IMPORTANT: No external charting libraries
For analytics/chart screens, use pure CSS bar charts:
- A container div with `width: {pct}%` background fill using Tailwind inline styles
- Example: `<div className="bg-blue-500 h-4 rounded" style={{ width: \`${pct}%\` }} />`
- Show labels and values alongside the bars

### Gateway API prefixes
- reports: `/api/v1/reports`
- knowledge: `/api/v1/knowledge`
- notification: `/api/notification`

## Step 1 — Read existing files

```
apps/web/src/app/(app)/reports/list/page.tsx
apps/web/src/app/(app)/notifications/list/page.tsx
apps/web/src/app/(app)/notifications/deliveries/page.tsx
apps/web/src/app/_data/loaders.ts
packages/schemas/src/web.ts
packages/types/src/index.ts
apps/web/src/app/(app)/reports/page.tsx
```

Also read ALL HTML prototypes:
- ALL files from `~/CivitasOne/erpnext-develop/analytics-module/web/`
- ALL files from `~/CivitasOne/erpnext-develop/knowledge-module/web/`

## Step 2 — Add Zod schemas to `packages/schemas/src/web.ts`

Append:

```typescript
// Analytics / Reports schemas
export const ReportDashboardItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  module: z.string(),
  value: z.number().optional(),
  unit: z.string().optional(),
  changePct: z.number().optional(),
  changeDirection: z.enum(["up", "down", "neutral"]).optional(),
});
export const ReportDashboardSchema = z.object({
  kpis: z.array(ReportDashboardItemSchema).default([]),
  summary: z.string().optional(),
});

export const ReportJobSummarySchema = z.object({
  id: z.string(),
  reportName: z.string(),
  module: z.string(),
  requestedBy: z.string(),
  requestedAt: z.string(),
  completedAt: z.string().optional(),
  format: z.enum(["pdf", "xlsx", "csv", "html"]),
  status: z.enum(["queued", "running", "completed", "failed"]),
  downloadUrl: z.string().optional(),
  rowCount: z.number().optional(),
});
export const ReportJobSummaryListSchema = z.array(ReportJobSummarySchema);

export const ReportJobDetailSchema = ReportJobSummarySchema.extend({
  parameters: z.record(z.string()).optional(),
  columns: z.array(z.string()).default([]),
  rows: z.array(z.record(z.string())).default([]),
  totalCount: z.number().default(0),
});

export const KPISummarySchema = z.object({
  id: z.string(),
  kpiName: z.string(),
  module: z.string(),
  targetValue: z.number(),
  currentValue: z.number(),
  unit: z.string(),
  achievementPct: z.number(),
  period: z.string(),
  trend: z.enum(["up", "down", "stable"]),
  status: z.enum(["on_track", "at_risk", "off_track"]),
});
export const KPISummaryListSchema = z.array(KPISummarySchema);

export const MISSummarySchema = z.object({
  module: z.string(),
  metrics: z.array(z.object({
    label: z.string(),
    value: z.string(),
    unit: z.string().optional(),
    change: z.string().optional(),
  })),
});
export const MISSummaryListSchema = z.array(MISSummarySchema);

// Knowledge / DMS schemas
export const KnowledgeDocSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  category: z.string(),
  author: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string().optional(),
  tags: z.array(z.string()).default([]),
  status: z.enum(["draft", "under_review", "approved", "archived"]),
  accessLevel: z.enum(["public", "internal", "restricted", "confidential"]),
  fileType: z.string().optional(),
  fileSize: z.number().optional(),
  version: z.string().default("1.0"),
});
export const KnowledgeDocSummaryListSchema = z.array(KnowledgeDocSummarySchema);

export const KnowledgeRecordSchema = z.object({
  id: z.string(),
  recordNo: z.string(),
  title: z.string(),
  type: z.enum(["file", "correspondence", "register", "other"]),
  department: z.string().optional(),
  createdDate: z.string(),
  retentionPeriod: z.string().optional(),
  disposalDueDate: z.string().optional(),
  status: z.enum(["active", "inactive", "disposed", "transferred"]),
});
export const KnowledgeRecordListSchema = z.array(KnowledgeRecordSchema);

export const KnowledgeSearchResultSchema = z.object({
  id: z.string(),
  title: z.string(),
  category: z.string(),
  excerpt: z.string().optional(),
  relevanceScore: z.number().optional(),
  documentType: z.string().optional(),
  createdAt: z.string(),
  url: z.string().optional(),
});
export const KnowledgeSearchResultListSchema = z.array(KnowledgeSearchResultSchema);

// Notification schemas (enhance existing)
export const NotificationItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  message: z.string(),
  module: z.string(),
  eventType: z.string(),
  recipient: z.string(),
  channel: z.enum(["email", "sms", "in_app", "webhook"]),
  status: z.enum(["sent", "pending", "failed", "read"]),
  createdAt: z.string(),
  readAt: z.string().optional(),
});
export const NotificationItemListSchema = z.array(NotificationItemSchema);

export const NotificationDeliverySchema = z.object({
  id: z.string(),
  notificationId: z.string(),
  notificationTitle: z.string(),
  recipient: z.string(),
  channel: z.enum(["email", "sms", "in_app", "webhook"]),
  attemptCount: z.number().default(1),
  deliveredAt: z.string().optional(),
  failureReason: z.string().optional(),
  status: z.enum(["pending", "delivered", "failed", "bounced"]),
});
export const NotificationDeliveryListSchema = z.array(NotificationDeliverySchema);
```

## Step 3 — Add types to `packages/types/src/index.ts`

Append:

```typescript
export type ReportJobSummary = {
  id: string;
  reportName: string;
  module: string;
  requestedBy: string;
  requestedAt: string;
  completedAt?: string;
  format: "pdf" | "xlsx" | "csv" | "html";
  status: "queued" | "running" | "completed" | "failed";
  downloadUrl?: string;
  rowCount?: number;
};

export type KPISummary = {
  id: string;
  kpiName: string;
  module: string;
  targetValue: number;
  currentValue: number;
  unit: string;
  achievementPct: number;
  period: string;
  trend: "up" | "down" | "stable";
  status: "on_track" | "at_risk" | "off_track";
};

export type MISSummary = {
  module: string;
  metrics: Array<{
    label: string;
    value: string;
    unit?: string;
    change?: string;
  }>;
};

export type KnowledgeDocSummary = {
  id: string;
  title: string;
  category: string;
  author?: string;
  createdAt: string;
  updatedAt?: string;
  tags: string[];
  status: "draft" | "under_review" | "approved" | "archived";
  accessLevel: "public" | "internal" | "restricted" | "confidential";
  fileType?: string;
  fileSize?: number;
  version: string;
};
```

## Step 4 — Add loaders

Append to `apps/web/src/app/_data/loaders.ts`:

```typescript
export async function getReportsDashboard() {
  return fetchJson("/api/v1/reports/dashboards", {} as ReportDashboardSchema, {
    revalidateSeconds: 60, telemetryKey: "reports.dashboard", responseSchema: ReportDashboardSchema,
  });
}

export async function getReportJobs() {
  return fetchJson("/api/v1/reports/report-jobs", [] as ReportJobSummary[], {
    revalidateSeconds: 60, telemetryKey: "reports.jobs", responseSchema: ReportJobSummaryListSchema,
  });
}

export async function getReportJobById(id: string) {
  return fetchJson(`/api/v1/reports/report-jobs/${id}`, null, {
    revalidateSeconds: 30, telemetryKey: "reports.job.detail", responseSchema: ReportJobDetailSchema,
  });
}

export async function getKPIs() {
  return fetchJson("/api/v1/reports/kpis", [] as KPISummary[], {
    revalidateSeconds: 120, telemetryKey: "reports.kpis", responseSchema: KPISummaryListSchema,
  });
}

export async function getMISSummary() {
  return fetchJson("/api/v1/reports/mis", [] as MISSummary[], {
    revalidateSeconds: 120, telemetryKey: "reports.mis", responseSchema: MISSummaryListSchema,
  });
}

export async function getKnowledgeDocs() {
  return fetchJson("/api/v1/knowledge/documents", [] as KnowledgeDocSummary[], {
    revalidateSeconds: 120, telemetryKey: "knowledge.docs", responseSchema: KnowledgeDocSummaryListSchema,
  });
}

export async function getKnowledgeRecords() {
  return fetchJson("/api/v1/knowledge/records", [] as KnowledgeRecordSchema[], {
    revalidateSeconds: 120, telemetryKey: "knowledge.records", responseSchema: KnowledgeRecordListSchema,
  });
}

export async function getNotifications() {
  return fetchJson("/api/notification/notifications", [] as NotificationItemSchema[], {
    revalidateSeconds: 30, telemetryKey: "notifications.list", responseSchema: NotificationItemListSchema,
  });
}

export async function getNotificationDeliveries() {
  return fetchJson("/api/notification/deliveries", [] as NotificationDeliverySchema[], {
    revalidateSeconds: 30, telemetryKey: "notifications.deliveries", responseSchema: NotificationDeliveryListSchema,
  });
}
```

## Step 5 — Build each page

### 5.1 `/reports/dashboard/page.tsx`

Create `apps/web/src/app/(app)/reports/dashboard/page.tsx`:
- Fetches `getReportsDashboard()`
- KPI tiles section: grid of tiles showing KPI name, value, unit, change % (up=green arrow, down=red arrow)
- Pure CSS bar chart section: "Module Activity" — show each module's metrics as horizontal bars
  ```tsx
  {/* CSS bar chart example */}
  <div className="space-y-2">
    {items.map(item => (
      <div key={item.id} className="flex items-center gap-3">
        <span className="w-32 text-xs text-gray-600 text-right">{item.label}</span>
        <div className="flex-1 bg-gray-100 rounded h-4">
          <div 
            className="bg-blue-500 h-4 rounded transition-all" 
            style={{ width: `${Math.min(item.pct, 100)}%` }} 
          />
        </div>
        <span className="text-xs font-medium w-12 text-right">{item.value}</span>
      </div>
    ))}
  </div>
  ```
- Quick links: Reports List, KPI Tracker, MIS Dashboard

### 5.2 Enhance `/reports/list/page.tsx`

Read existing and update:
- Table columns: Report Name, Module, Requested By, Requested At, Completed At, Format, Rows, Status, Download
- Format pills: pdf=red, xlsx=green, csv=blue, html=gray
- Status pills: queued=gray, running=yellow, completed=green, failed=red
- Download link (if status=completed and downloadUrl exists)
- Stats: Total, Completed, Running, Failed

### 5.3 `/reports/[id]/page.tsx`

Create `apps/web/src/app/(app)/reports/[id]/page.tsx`:
- Header: Report Name, Module, Status, Format, Requested By, Requested At
- Parameters section (if any): show as key-value list
- Data table: render `columns` as thead and `rows` (up to 100 shown) as tbody
  - Note: columns/rows are dynamic — use `Object.keys(rows[0] ?? {})` for column names if columns array is empty
- Row count info: "Showing X of Y rows"
- Download button if available
- API: `getReportJobById(params.id)`

### 5.4 `/reports/kpi/page.tsx`

Create `apps/web/src/app/(app)/reports/kpi/page.tsx`:
- Table: KPI Name, Module, Target, Current, Unit, Achievement %, Period, Trend, Status
- Achievement %: color-coded: ≥100% green, 75-99% yellow, <75% red
- Trend arrows: up=green ↑, down=red ↓, stable=gray →
- Status pills: on_track=green, at_risk=yellow, off_track=red
- CSS bar chart: show achievement % as horizontal bar per KPI
- Stats: Total KPIs, On Track, At Risk, Off Track

### 5.5 `/reports/mis/page.tsx`

Create `apps/web/src/app/(app)/reports/mis/page.tsx`:
- Title: "Management Information System — Dashboard"
- For each module in the MIS data: show a card with module name and its metrics as a mini table (label | value | change)
- Layout: 2-column grid of module cards
- Change value: show as green if positive, red if negative
- API: `getMISSummary()`
- Empty fallback: "MIS data is being compiled. Please check back shortly."

### 5.6 `/knowledge/dashboard/page.tsx`

Create `apps/web/src/app/(app)/knowledge/dashboard/page.tsx`:
- Fetch `getKnowledgeDocs()` — if API returns empty or errors, show graceful empty state
- 4 stats computed from doc list: Total Documents, Recent (last 30 days), Pending Approval (under_review), Categories count
- Quick links: Repository, Records Management, Search
- Empty state if no documents: "No documents in the repository yet."

### 5.7 `/knowledge/repository/page.tsx`

Create `apps/web/src/app/(app)/knowledge/repository/page.tsx`:
- Table: Title, Category, Author, Created At, Updated At, Version, Tags, Access Level, Status
- Status pills: draft=gray, under_review=yellow, approved=green, archived=gray
- Access level pills: public=green, internal=blue, restricted=yellow, confidential=red
- Tags: show as small rounded badges
- If API call returns empty/error: show empty state "No documents found in the repository." with DataSourceBadge
- Stats: Total, Approved, Pending Review, Archived

### 5.8 `/knowledge/records/page.tsx`

Create `apps/web/src/app/(app)/knowledge/records/page.tsx`:
- Table: Record No, Title, Type, Department, Created Date, Retention Period, Disposal Due, Status
- Type pills: file=blue, correspondence=green, register=yellow, other=gray
- Status pills: active=green, inactive=gray, disposed=red, transferred=blue
- Stats: Total, Active, Due for Disposal (disposalDueDate < 30 days from now), Disposed

### 5.9 `/knowledge/search/page.tsx` — CLIENT COMPONENT

Create `apps/web/src/app/(app)/knowledge/search/page.tsx` as `"use client"`:
- Search input with search button
- On submit: `POST /api/proxy/v1/knowledge/search` with `{ query: searchTerm }`
- Show loading state while fetching
- Results list: Title, Category, Excerpt (with search term highlighted if possible), Created At, Document Type, Relevance Score
- If no results: "No documents found matching your search."
- If error: "Search service is unavailable."
- Empty initial state: show a search icon and "Enter keywords to search the knowledge repository."

```tsx
"use client";
import { useState } from "react";
import Link from "next/link";

type SearchResult = {
  id: string;
  title: string;
  category: string;
  excerpt?: string;
  relevanceScore?: number;
  documentType?: string;
  createdAt: string;
};

export default function KnowledgeSearchPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    setSearched(true);

    try {
      const res = await fetch("/api/proxy/v1/knowledge/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: query.trim() }),
      });
      if (!res.ok) throw new Error(`Search failed: ${res.status}`);
      const data = await res.json();
      setResults(Array.isArray(data) ? data : data.results ?? []);
    } catch (err) {
      setError("Search service is unavailable. Please try again.");
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <div className="mb-6">
        <nav className="text-sm text-gray-500 mb-1">
          <Link href="/knowledge" className="hover:underline">Knowledge</Link>
          {" / "}Search
        </nav>
        <h1 className="text-2xl font-semibold text-gray-900">Knowledge Search</h1>
      </div>

      <form onSubmit={handleSearch} className="flex gap-2 mb-6">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search documents, records, policies..."
          className="flex-1 border rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          type="submit"
          disabled={loading}
          className="px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? "Searching..." : "Search"}
        </button>
      </form>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700 mb-4">{error}</div>
      )}

      {!searched && !loading && (
        <div className="text-center py-16 text-gray-400">
          <div className="text-4xl mb-3">🔍</div>
          <p>Enter keywords to search the knowledge repository</p>
        </div>
      )}

      {searched && !loading && results.length === 0 && !error && (
        <div className="text-center py-12 text-gray-400">No documents found matching your search.</div>
      )}

      {results.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm text-gray-500">{results.length} result{results.length !== 1 ? "s" : ""} found</p>
          {results.map((r) => (
            <div key={r.id} className="bg-white border rounded-lg p-4 hover:border-blue-300 transition-colors">
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-medium text-gray-900">{r.title}</h3>
                {r.relevanceScore !== undefined && (
                  <span className="text-xs text-gray-400 flex-shrink-0">
                    Score: {(r.relevanceScore * 100).toFixed(0)}%
                  </span>
                )}
              </div>
              <div className="flex gap-2 mt-1">
                <span className="text-xs text-blue-600">{r.category}</span>
                {r.documentType && <span className="text-xs text-gray-400">· {r.documentType}</span>}
                <span className="text-xs text-gray-400">· {r.createdAt}</span>
              </div>
              {r.excerpt && <p className="text-sm text-gray-600 mt-2">{r.excerpt}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

### 5.10 Enhance `/notifications/list/page.tsx`

Read existing and update:
- Table columns: Title, Message (truncated), Module, Event Type, Recipient, Channel, Status, Created At, Read At
- Channel pills: email=blue, sms=green, in_app=purple, webhook=orange
- Status pills: sent=green, pending=yellow, failed=red, read=gray
- Stats: Total, Sent, Failed, Read

### 5.11 Enhance `/notifications/deliveries/page.tsx`

Read existing and update:
- Table columns: Notification Title, Recipient, Channel, Attempt Count, Delivered At, Failure Reason, Status
- Status pills: pending=yellow, delivered=green, failed=red, bounced=orange
- Failure reason: show only if status=failed or bounced
- Stats: Total, Delivered, Failed, Pending

## Step 6 — Update hub pages

Update `/reports/page.tsx` with tiles: Dashboard, Reports List, KPI Tracker, MIS Dashboard
Create `/knowledge/page.tsx` (if not exists) with tiles: Dashboard, Repository, Records, Search
Update `/notifications/page.tsx` (if exists) with links to List and Deliveries

## Step 7 — Verification

```bash
cd ~/CivitasOne/civitasone-suite
pnpm --filter @civitasone/schemas typecheck
pnpm --filter @civitasone/web typecheck
```

Common issues:
- `KnowledgeRecordSchema` and `AuditComplianceItemSchema` are Zod schemas, not TypeScript types — use `z.infer<typeof ...>` when needed as TS types
- The search page uses `"use client"` — ensure no server-only imports
- MIS summary page: `MISSummary[]` is the correct type for the data array
