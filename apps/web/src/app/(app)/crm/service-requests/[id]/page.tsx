import { fetchJson } from "../../../../_data/apiClient";
import { PageHeader, StatusPill, Card } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { ServiceRequestActions } from "./ServiceRequestActions";

interface ServiceRequestDetail {
  id: string;
  referenceNo: string;
  citizenName: string;
  citizenPhone?: string;
  citizenEmail?: string;
  serviceType: string;
  subject: string;
  description?: string;
  priority: string;
  status: string;
  assignedTo?: string;
  resolution?: string;
  dueAt?: string;
  resolvedAt?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

function fmt(dt?: string) {
  if (!dt) return "—";
  return new Date(dt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

function PriorityBadge({ priority }: { priority: string }) {
  const color = priority === "urgent" ? "var(--bad)" : priority === "high" ? "var(--warn)" : "var(--ink2)";
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <dt style={{ fontSize: 12, color: "var(--ink2)" }}>{label}</dt>
      <dd style={{ margin: 0, fontSize: 14, color: "var(--ink)" }}>{children}</dd>
    </div>
  );
}

export default async function ServiceRequestDetailPage({ params }: { params: { id: string } }) {
  const { data: r, source } = await fetchJson<{ data?: ServiceRequestDetail } | ServiceRequestDetail, ServiceRequestDetail | null>(
    `/api/v1/crm/service-requests/${params.id}`,
    null,
    {
      revalidateSeconds: 0,
      telemetryKey: "crm.service-request.detail",
      mapResponse: (p) => {
        if (!p || typeof p !== "object") return null;
        const rec = p as Record<string, unknown>;
        return (rec.data ?? rec) as ServiceRequestDetail;
      },
    },
  );

  if (!r) {
    return (
      <>
        <PageHeader
          title="Service request not found"
          subtitle="This request may have been removed, or you may not have access to it."
          back="/crm/service-requests"
          backLabel="Service Requests"
        />
        {source === "error" && <DataSourceBadge source={source} />}
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={r.referenceNo ?? "Service Request"}
        subtitle={r.subject}
        back="/crm/service-requests"
        backLabel="Service Requests"
        actions={<ServiceRequestActions id={r.id} status={r.status} />}
      />
      {source === "error" && <DataSourceBadge source={source} />}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 20 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Card title="Request Details">
            <dl
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                gap: 16,
                padding: "4px 0",
                margin: 0,
              }}
            >
              <Field label="Service Type">{r.serviceType ?? "—"}</Field>
              <Field label="Priority"><PriorityBadge priority={r.priority ?? "normal"} /></Field>
              <Field label="Status"><StatusPill status={r.status ?? "open"} /></Field>
              <Field label="Due">{fmt(r.dueAt)}</Field>
            </dl>
            {r.description ? (
              <p style={{ marginTop: 16, fontSize: 14, color: "var(--ink)", whiteSpace: "pre-wrap" }}>
                {r.description}
              </p>
            ) : null}
          </Card>

          {r.resolution ? (
            <Card title="Resolution">
              <p style={{ fontSize: 14, color: "var(--ink)", whiteSpace: "pre-wrap", margin: 0 }}>
                {r.resolution}
              </p>
              <p style={{ fontSize: 12, color: "var(--ink2)", marginTop: 8, marginBottom: 0 }}>
                Resolved {fmt(r.resolvedAt)}
              </p>
            </Card>
          ) : null}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Card title="Citizen">
            <dl style={{ display: "flex", flexDirection: "column", gap: 12, margin: 0 }}>
              <Field label="Name">{r.citizenName ?? "—"}</Field>
              <Field label="Phone">{r.citizenPhone ?? "—"}</Field>
              <Field label="Email">{r.citizenEmail ?? "—"}</Field>
            </dl>
          </Card>
          <Card title="Audit">
            <dl style={{ display: "flex", flexDirection: "column", gap: 12, margin: 0 }}>
              <Field label="Logged">{fmt(r.createdAt)}</Field>
              <Field label="Last updated">{fmt(r.updatedAt)}</Field>
            </dl>
          </Card>
        </div>
      </div>
    </>
  );
}
