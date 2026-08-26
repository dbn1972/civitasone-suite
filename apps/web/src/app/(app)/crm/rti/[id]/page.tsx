import { fetchJson } from "../../../../_data/apiClient";
import { PageHeader, StatusPill, Card } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { RtiActions } from "./RtiActions";

interface RtiDetail {
  id: string;
  referenceNo: string;
  section: string;
  departmentRef: string;
  applicantName: string;
  applicantContact?: string;
  subject: string;
  description: string;
  status: string;
  feePaid: boolean;
  feeAmount?: number;
  receivedAt?: string;
  dueAt?: string;
  firstAppealDueAt?: string;
  respondedAt?: string;
  responseText?: string;
  createdAt: string;
  updatedAt: string;
}

function fmt(dt?: string) {
  if (!dt) return "—";
  return new Date(dt).toLocaleString("en-IN", {
    dateStyle: "medium", timeStyle: "short",
  });
}

const SECTION_LABEL: Record<string, string> = {
  "s.6": "§6 — Information Request",
  "s.11": "§11 — Third-party Information",
};

export default async function RtiDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const { data: r, source } = await fetchJson<unknown, RtiDetail | null>(
    `/api/v1/crm/rti/${params.id}`,
    null,
    { revalidateSeconds: 0, telemetryKey: "crm.rti.detail",
      mapResponse: (p) => {
        if (p && typeof p === "object" && "data" in (p as object)) {
          return (p as { data: RtiDetail }).data;
        }
        return null;
      },
    },
  );

  if (!r) {
    return (
      <>
        <PageHeader title="RTI Request Not Found" back="/crm/rti" backLabel="RTI Applications" />
        {source === "error" && <DataSourceBadge source={source} />}
        <p style={{ color: "var(--ink2)", padding: "24px 0" }}>
          The RTI request could not be loaded.
        </p>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={r.referenceNo ?? "RTI Request"}
        subtitle={r.subject}
        back="/crm/rti"
        backLabel="RTI Applications"
        actions={<RtiActions id={r.id} status={r.status} />}
      />
      {source === "error" && <DataSourceBadge source={source} />}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 20 }}>
        {/* Main column */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Card title="RTI Request Details">
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
              <dd><code style={{ fontSize: 13 }}>{r.referenceNo ?? "—"}</code></dd>
              <dt style={{ color: "var(--ink2)" }}>Section</dt>
              <dd>{SECTION_LABEL[r.section] ?? r.section}</dd>
              <dt style={{ color: "var(--ink2)" }}>Status</dt>
              <dd><StatusPill status={r.status} /></dd>
              <dt style={{ color: "var(--ink2)" }}>Department</dt>
              <dd>{r.departmentRef}</dd>
              <dt style={{ color: "var(--ink2)" }}>Fee</dt>
              <dd>{r.feePaid ? `Paid${r.feeAmount ? ` — ₹${r.feeAmount}` : ""}` : "Not paid"}</dd>
              <dt style={{ color: "var(--ink2)" }}>Received</dt>
              <dd>{fmt(r.receivedAt ?? r.createdAt)}</dd>
              <dt style={{ color: "var(--ink2)" }}>Response Due</dt>
              <dd>{fmt(r.dueAt)}</dd>
              <dt style={{ color: "var(--ink2)" }}>First-Appeal Due</dt>
              <dd>{fmt(r.firstAppealDueAt)}</dd>
              <dt style={{ color: "var(--ink2)" }}>Last Updated</dt>
              <dd>{fmt(r.updatedAt)}</dd>
            </dl>
          </Card>

          <Card title="Information Requested">
            <p
              style={{
                margin: "12px 16px",
                fontSize: 14,
                color: "var(--ink)",
                lineHeight: 1.6,
                whiteSpace: "pre-wrap",
              }}
            >
              {r.description}
            </p>
          </Card>

          {r.responseText && (
            <Card title="Response">
              <p
                style={{
                  margin: "12px 16px 4px",
                  fontSize: 14,
                  color: "var(--ink)",
                  lineHeight: 1.6,
                  whiteSpace: "pre-wrap",
                }}
              >
                {r.responseText}
              </p>
              {r.respondedAt && (
                <p style={{ margin: "0 16px 12px", fontSize: 12, color: "var(--ink2)" }}>
                  Responded {fmt(r.respondedAt)}
                </p>
              )}
            </Card>
          )}
        </div>

        {/* Sidebar */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Card title="Applicant">
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
              <dd style={{ fontWeight: 600 }}>{r.applicantName}</dd>
              <dt style={{ color: "var(--ink2)" }}>Contact</dt>
              <dd style={{ wordBreak: "break-all" }}>{r.applicantContact ?? "—"}</dd>
            </dl>
          </Card>
        </div>
      </div>
    </>
  );
}
