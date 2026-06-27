import { PageHeader, Card, StatusPill } from "@/app/_components/ds";
import { Breadcrumb } from "../../Breadcrumb";

type BreakglassDetail = {
  id: string;
  initiatedBy: string;
  initiatorEmail: string;
  reason: string;
  timestamp: string;
  duration: string;
  expiresAt: string;
  resourcesAccessed: string[];
  approvalChain: { name: string; role: string; decision: string; timestamp: string }[];
  status: string;
};

const breakglassEvent: BreakglassDetail = {
  id: "bg-20250115-001",
  initiatedBy: "Vikram Singh (SRE)",
  initiatorEmail: "vikram.singh@civitas.gov.in",
  reason: "Production database connection pool exhaustion — emergency investigation required to restore Finance module availability.",
  timestamp: "2025-01-15T02:30:00Z",
  duration: "4 hours",
  expiresAt: "2025-01-15T06:30:00Z",
  resourcesAccessed: [
    "pg-primary:finance_db (read-only)",
    "redis-cluster:session-store",
    "k8s:civitas-prod/finance-service (pod logs)",
    "vault:secrets/finance/db-credentials (read)",
  ],
  approvalChain: [
    { name: "Vikram Singh", role: "SRE Lead", decision: "Initiated", timestamp: "2025-01-15T02:30:00Z" },
    { name: "Priya Sharma", role: "Platform Admin", decision: "Approved", timestamp: "2025-01-15T02:32:00Z" },
    { name: "Rajesh Verma", role: "CISO", decision: "Acknowledged", timestamp: "2025-01-15T02:35:00Z" },
  ],
  status: "expired",
};

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, padding: "10px 0", borderBottom: "1px solid var(--border, #e2e8f0)" }}>
      <dt style={{ fontSize: 12, color: "var(--ink2)", fontWeight: 500 }}>{label}</dt>
      <dd style={{ margin: 0, fontSize: 14, fontWeight: 400 }}>{value}</dd>
    </div>
  );
}

export default function BreakglassDetailPage({ params }: { params: { id: string } }) {
  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <Breadcrumb items={[{ label: "Tenant Admin", href: "/tenant-admin" }, { label: "Break-Glass", href: "/tenant-admin/breakglass" }, { label: `Event ${params.id}` }]} />
      <PageHeader
        back="/tenant-admin/breakglass"
        title="Break-Glass Event Detail"
        subtitle={`Emergency access event initiated by ${breakglassEvent.initiatedBy}`}
        actions={<StatusPill status={breakglassEvent.status} />}
      />

      <div className="grid g-2" style={{ marginTop: 18 }}>
        <Card title="Event Information" padding>
          <dl style={{ margin: 0 }}>
            <Field label="Initiated By" value={breakglassEvent.initiatedBy} />
            <Field label="Email" value={breakglassEvent.initiatorEmail} />
            <Field label="Status" value={<StatusPill status={breakglassEvent.status} />} />
            <Field label="Timestamp" value={new Date(breakglassEvent.timestamp).toLocaleString("en-IN", { dateStyle: "full", timeStyle: "medium" })} />
            <Field label="Duration" value={breakglassEvent.duration} />
            <Field label="Expires At" value={new Date(breakglassEvent.expiresAt).toLocaleString("en-IN", { dateStyle: "full", timeStyle: "medium" })} />
          </dl>
        </Card>
        <Card title="Reason" padding>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6 }}>{breakglassEvent.reason}</p>
        </Card>
      </div>
      <Card title="Resources Accessed" padding>
        <ul aria-label="Resources accessed during break-glass" style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {breakglassEvent.resourcesAccessed.map((resource, i) => (
            <li key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", borderBottom: "1px solid var(--border, #e2e8f0)" }}>
              <span aria-hidden="true">🔓</span>
              <span className="mono" style={{ fontSize: 13 }}>{resource}</span>
            </li>
          ))}
        </ul>
      </Card>
      <Card title="Approval Chain" padding>
        <ol aria-label="Approval chain" style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {breakglassEvent.approvalChain.map((step, i) => (
            <li key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: "1px solid var(--border, #e2e8f0)" }}>
              <span style={{ width: 24, height: 24, borderRadius: "50%", background: "var(--primary-l, #eff6ff)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 600, flexShrink: 0 }}>
                {i + 1}
              </span>
              <div style={{ flex: 1 }}>
                <p style={{ margin: 0, fontWeight: 500, fontSize: 14 }}>{step.name} <span style={{ fontWeight: 400, color: "var(--ink2)" }}>({step.role})</span></p>
                <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--ink2)" }}>
                  {new Date(step.timestamp).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
                </p>
              </div>
              <StatusPill status={step.decision.toLowerCase() === "approved" ? "approved" : step.decision.toLowerCase() === "initiated" ? "active" : "completed"} label={step.decision} />
            </li>
          ))}
        </ol>
      </Card>
    </main>
  );
}
