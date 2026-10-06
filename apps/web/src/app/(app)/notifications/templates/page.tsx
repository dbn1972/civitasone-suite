"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { PageHeader, StatCard, StatGrid, DataTable, Segmented, EmptyState, ErrorState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import type { DataProvenance } from "@/lib/sync/resource";
import { useOfflineResource } from "@/lib/sync/resource";
import { toHumanError } from "@/lib/messages";
import { StatusBadge } from "../_components/StatusBadge";
import { channelLabel } from "../_components/channelLabel";

/**
 * Notification templates — list backed by GET /notification/templates
 * (TemplateView[]). Rows link to the template detail route. Channel is shown
 * via channelLabel(); template status (active / superseded) uses the text+icon
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

/**
 * GAP-NOTIFICATIONS-TEMPLATES-02: collapse to the latest version per logical
 * template (group by name+channel, keep the highest version) by default, so a
 * superseded v2 and its active v3 are not two rows that double-count the
 * "Templates" total. A "Show all versions" toggle reveals every row.
 */
function latestPerName(views: TemplateView[]): TemplateView[] {
  const byKey = new Map<string, TemplateView>();
  for (const t of views) {
    const key = `${t.name}\u0000${t.channel}`;
    const existing = byKey.get(key);
    if (!existing || t.version > existing.version) byKey.set(key, t);
  }
  return [...byKey.values()];
}

export default function NotificationTemplatesPage() {
  const { data: templates, source, offline, cachedAt, loading, error, refresh } = useOfflineResource<unknown, TemplateView[]>(
    "notifications.templates",
    "/notification/templates",
    { map: toArray, initialData: [] },
  );

  const [tab, setTab] = useState<string>("All");
  const [showAllVersions, setShowAllVersions] = useState(false);

  // TEMPLATES-02: default to latest-per-name; the toggle shows every version.
  const visibleTemplates = useMemo(
    () => (showAllVersions ? templates : latestPerName(templates)),
    [templates, showAllVersions],
  );

  const grouped = latestPerName(templates);
  const templateCount = grouped.length;
  const active = grouped.filter((t) => !t.supersededBy && t.status === "active").length;
  const superseded = templates.filter((t) => t.supersededBy || t.status === "superseded").length;

  // TEMPLATES-04: show '—' not a fabricated 0 while loading / on error.
  const unknown = loading || Boolean(error);
  const stat = (n: number) => (unknown ? "—" : n.toLocaleString("en-IN"));

  // TEMPLATES-04 / LIST-04: single provenance value from the same hook call.
  const provenance: DataProvenance = error && templates.length === 0 // ux-001-ok: this IS the error branch (error is checked first); length only distinguishes error-no-data from error-with-stale-rows, never renders an empty state
    ? "error-no-data"
    : offline || source === "cache"
      ? "cached"
      : "live";

  const rows: TemplateRow[] = visibleTemplates.map((t) => ({
    id: t.id,
    name: t.name,
    channel: channelLabel(t.channel),
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
        actions={
          <>
            <Link className="btn ghost" href="/notifications/templates/new">New template</Link>
            <Link className="btn primary" href="/notifications/compose">Send notification</Link>
          </>
        }
      />
      {!error ? <DataSourceBadge provenance={provenance} cachedAt={cachedAt} offline={offline} /> : null}
      <StatGrid>
        <StatCard icon="📝" iconBg="#eef2ff" label="Templates" value={stat(templateCount)} />
        <StatCard icon="✅" iconBg="#ecfdf5" label="Active" value={stat(active)} />
        <StatCard icon="🗂" iconBg="#f8fafc" label="Superseded" value={stat(superseded)} />
      </StatGrid>
      <div className="card">
        <div className="card-h">
          <h3>Templates</h3>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <label style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 12 }}>
              <input
                type="checkbox"
                checked={showAllVersions}
                onChange={(e) => setShowAllVersions(e.target.checked)}
              />
              Show all versions
            </label>
            <div role="group" aria-label="Filter templates by status">
              <Segmented options={[...TABS]} value={tab} onChange={setTab} />
            </div>
          </div>
        </div>
        {error ? (
          <ErrorState error={toHumanError("load", { area: "templates" })} onRetry={refresh} />
        ) : templates.length === 0 ? (
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
