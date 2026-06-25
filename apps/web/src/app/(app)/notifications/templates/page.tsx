"use client";

import { useState } from "react";
import { PageHeader, StatCard, StatGrid, DataTable, Segmented, EmptyState } from "../../../_components/ds";
import { useOfflineResource } from "@/lib/sync/resource";
import { StatusBadge } from "../_components/StatusBadge";

/**
 * Notification templates — list backed by GET /notification/templates
 * (TemplateView[]). Rows link to the template detail route. Channel is shown as
 * plain text; template status (active / superseded) uses the text+icon
 * StatusBadge so state is never colour-only.
 */
type TemplateView = {
  id: string;
  channel: string;
  name: string;
  subject: string | null;
  body: string;
  status: string;
  version: number;
  supersededBy: string | null;
};

type TemplateRow = {
  id: string;
  name: string;
  channel: string;
  subject: string;
  version: number;
  status: string;
} & Record<string, unknown>;

function toArray(payload: unknown): TemplateView[] {
  if (Array.isArray(payload)) return payload as TemplateView[];
  if (payload && typeof payload === "object") {
    const rec = payload as Record<string, unknown>;
    if (Array.isArray(rec.data)) return rec.data as TemplateView[];
    if (Array.isArray(rec.items)) return rec.items as TemplateView[];
  }
  return [];
}

const TABS = ["All", "Active", "Superseded"] as const;

export default function NotificationTemplatesPage() {
  const { data: templates, source, offline, cachedAt, loading } = useOfflineResource<unknown, TemplateView[]>(
    "notifications.templates",
    "/notification/templates",
    { map: toArray, initialData: [] },
  );

  const [tab, setTab] = useState<string>("All");

  const active = templates.filter((t) => t.status === "active").length;
  const superseded = templates.filter((t) => t.supersededBy || t.status === "superseded").length;

  const cacheNote =
    offline || source === "cache"
      ? `Showing saved data${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — you're offline" : ""}.`
      : null;

  const rows: TemplateRow[] = templates.map((t) => ({
    id: t.id,
    name: t.name,
    channel: t.channel.replace(/_/g, " "),
    subject: t.subject ?? "—",
    version: t.version,
    status: t.supersededBy ? "superseded" : t.status,
  }));

  const filtered =
    tab === "Active"
      ? rows.filter((r) => r.status === "active")
      : tab === "Superseded"
        ? rows.filter((r) => r.status === "superseded")
        : rows;

  return (
    <>
      <PageHeader
        title="Notification Templates"
        subtitle="Message templates used to send notifications. Select a template to view its content and version history."
        back="/notifications/list"
        actions={<a className="btn primary" href="/notifications/compose">Send notification</a>}
      />
      {cacheNote ? (
        <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0 0 8px" }}>
          {cacheNote}
        </p>
      ) : null}
      <StatGrid>
        <StatCard icon="📝" iconBg="#eef2ff" label="Total" value={templates.length.toLocaleString("en-IN")} />
        <StatCard icon="✅" iconBg="#ecfdf5" label="Active" value={active.toLocaleString("en-IN")} />
        <StatCard icon="🗂" iconBg="#f8fafc" label="Superseded" value={superseded.toLocaleString("en-IN")} />
      </StatGrid>
      <div className="card">
        <div className="card-h">
          <h3>Templates</h3>
          <div role="group" aria-label="Filter templates by status">
            <Segmented options={[...TABS]} value={tab} onChange={setTab} />
          </div>
        </div>
        {templates.length === 0 ? (
          <EmptyState
            icon="📝"
            title={loading ? "Loading templates…" : "No templates yet"}
            message={loading ? "Fetching notification templates." : "Notification templates will appear here once they're created."}
          />
        ) : (
          <DataTable<TemplateRow>
            columns={[
              { key: "name", label: "Name" },
              { key: "channel", label: "Channel" },
              { key: "subject", label: "Subject" },
              { key: "version", label: "Version", align: "right" },
              { key: "status", label: "Status", render: (r) => <StatusBadge status={r.status} /> },
            ]}
            rows={filtered}
            rowHref={(r) => `/notifications/templates/${r.id}`}
            sortable
            filterable
            filterPlaceholder="Filter templates…"
            pageSize={15}
          />
        )}
      </div>
    </>
  );
}
