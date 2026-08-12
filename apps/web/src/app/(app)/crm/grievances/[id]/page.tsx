import { fetchJson } from "../../../../_data/apiClient";
import { PageHeader, StatusPill, Card } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import Link from "next/link";

interface GrievanceDetail {
  id: string;
  referenceNo: string;
  citizenName: string;
  citizenPhone?: string;
  citizenEmail?: string;
  category: string;
  subject: string;
  description?: string;
  priority: string;
  status: string;
  assignedTo?: string;
  resolution?: string;
  dueAt?: string;
  resolvedAt?: string;
  closedAt?: string;
  escalatedAt?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

function fmt(dt?: string) {
  if (!dt) return "—";
  return new Date(dt).toLocaleString("en-IN", {
    dateStyle: "medium", timeStyle: "short",
  });
}

function PriorityBadge({ priority }: { priority: string }) {
  const color =
    priority === "urgent" ? "var(--bad)"
    : priority === "high" ? "var(--warn)"
    : "var(--ink2)";
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 4,
        fontSize: 12,
        fontWeight: 600,
        color: "var(--bg)",
        background: color,
      }}
    >
      {priority.charAt(0).toUpperCase() + priority.slice(1)}
    </span>
  );
}

function TimelineItem({
  ts, label, done,
}: {
  ts?: string; label: string; done: boolean;
}) {
  return (
    <li
      style={{
        display: "flex",
        gap: 12,
        alignItems: "flex-start",
        paddingBottom: 16,
        opacity: done ? 1 : 0.4,
      }}
    >
      <div
        aria-hidden="true"
        style={{
          width: 20,
          height: 20,
          borderRadius: "50%",
          flexShrink: 0,
          marginTop: 2,
          background: done ? "var(--good)" : "var(--line)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 11,
          color: "var(--bg)",
          fontWeight: 700,
        }}
      >
        {done ? "✓" : "○"}
      </div>
      <div>
        <div style={{ fontWeight: 600, fontSize: 14, color: "var(--ink)" }}>{label}</div>
        {ts && <div style={{ fontSize: 12, color: "var(--ink2)", marginTop: 2 }}>{fmt(ts)}</div>}
      </div>
    </li>
  );
}

export default async function GrievanceDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const { data: g, source } = await fetchJson<unknown, GrievanceDetail | null>(
    `/api/v1/crm/grievances/${params.id}`,
    null,
    { revalidateSeconds: 30, telemetryKey: "crm.grievance.detail",
      mapResponse: (p) => {
        if (p && typeof p === "object" && "data" in (p as object)) {
          return (p as { data: GrievanceDetail }).data;
        }
        return null;
      },
    },
  );

  if (!g) {
    return (
      <>
        <PageHeader title="Grievance Not Found" back="/crm/grievances" backLabel="Grievances" />
        {source === "error" && <DataSourceBadge source={source} />}
        <p style={{ color: "var(--ink2)", padding: "24px 0" }}>
          The grievance could not be loaded.
        </p>
      </>
    );
  }

  const timelineSteps = [
    { label: "Logged",    ts: g.createdAt,    done: true },
    { label: "Assigned",  ts: undefined,       done: !!g.assignedTo },
    { label: "Escalated", ts: g.escalatedAt,  done: !!g.escalatedAt },
    { label: "Resolved",  ts: g.resolvedAt,   done: !!g.resolvedAt },
    { label: "Closed",    ts: g.closedAt,     done: !!g.closedAt },
  ];

  return (
    <>
      <PageHeader
        title={g.referenceNo ?? "Grievance"}
        subtitle={g.subject}
        back="/crm/grievances"
        backLabel="Grievances"
        actions={
          <div style={{ display: "flex", gap: 8 }}>
            <Link href={`/crm/grievances/${g.id}/assign`} className="btn">
              Assign
            </Link>
            <Link href={`/crm/grievances/${g.id}/resolve`} className="btn primary">
              Resolve
            </Link>
          </div>
        }
      />
      {source === "error" && <DataSourceBadge source={source} />}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 20 }}>
        {/* Main column */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Card title="Grievance Details">
            <dl
              style={{
                display: "grid",
                gridTemplateColumns: "140px 1fr",
                gap: "10px 16px",
                fontSize: 14,
                margin: "12px 16px",
              }}
            >
              <dt style={{ color: "var(--ink2)" }}>Reference</dt>
              <dd><code style={{ fontSize: 13 }}>{g.referenceNo ?? "—"}</code></dd>
              <dt style={{ color: "var(--ink2)" }}>Category</dt>
              <dd>{g.category}</dd>
              <dt style={{ color: "var(--ink2)" }}>Priority</dt>
              <dd><PriorityBadge priority={g.priority} /></dd>
              <dt style={{ color: "var(--ink2)" }}>Status</dt>
              <dd><StatusPill status={g.status} /></dd>
              <dt style={{ color: "var(--ink2)" }}>Assigned To</dt>
              <dd>{g.assignedTo ?? "Unassigned"}</dd>
              <dt style={{ color: "var(--ink2)" }}>Due By</dt>
              <dd>{fmt(g.dueAt)}</dd>
              <dt style={{ color: "var(--ink2)" }}>Logged</dt>
              <dd>{fmt(g.createdAt)}</dd>
              <dt style={{ color: "var(--ink2)" }}>Last Updated</dt>
              <dd>{fmt(g.updatedAt)}</dd>
            </dl>
          </Card>

          {g.description && (
            <Card title="Description">
              <p
                style={{
                  margin: "12px 16px",
                  fontSize: 14,
                  color: "var(--ink)",
                  lineHeight: 1.6,
                  whiteSpace: "pre-wrap",
                }}
              >
                {g.description}
              </p>
            </Card>
          )}

          {g.resolution && (
            <Card title="Resolution">
              <p
                style={{
                  margin: "12px 16px",
                  fontSize: 14,
                  color: "var(--ink)",
                  lineHeight: 1.6,
                  whiteSpace: "pre-wrap",
                }}
              >
                {g.resolution}
              </p>
            </Card>
          )}
        </div>

        {/* Sidebar */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Card title="Citizen">
            <dl
              style={{
                display: "grid",
                gridTemplateColumns: "80px 1fr",
                gap: "8px 12px",
                fontSize: 14,
                margin: "12px 16px",
              }}
            >
              <dt style={{ color: "var(--ink2)" }}>Name</dt>
              <dd style={{ fontWeight: 600 }}>{g.citizenName}</dd>
              <dt style={{ color: "var(--ink2)" }}>Phone</dt>
              <dd>{g.citizenPhone ?? "—"}</dd>
              <dt style={{ color: "var(--ink2)" }}>Email</dt>
              <dd style={{ wordBreak: "break-all" }}>{g.citizenEmail ?? "—"}</dd>
            </dl>
          </Card>

          <Card title="Status Timeline">
            <ol
              style={{ listStyle: "none", padding: "12px 16px", margin: 0 }}
              aria-label="Grievance lifecycle steps"
            >
              {timelineSteps.map((s) => (
                <TimelineItem key={s.label} {...s} />
              ))}
            </ol>
          </Card>
        </div>
      </div>
    </>
  );
}
