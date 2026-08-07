import { PageHeader, Card, StatusPill } from "@/app/_components/ds";
import { PlaceholderButton } from "@/app/_components/PlaceholderButton";
import { Breadcrumb } from "../../Breadcrumb";

type SessionDetail = {
  id: string;
  userEmail: string;
  userName: string;
  device: string;
  browser: string;
  ipAddress: string;
  location: string;
  loginAt: string;
  lastActivity: string;
  userAgent: string;
  status: string;
  mfaVerified: boolean;
  os: string;
};

const session: SessionDetail = {
  id: "sess-a1b2c3d4",
  userEmail: "rajesh.verma@gov.in",
  userName: "Rajesh Verma",
  device: "MacBook Pro 14″",
  browser: "Chrome 121",
  ipAddress: "10.0.2.45",
  location: "New Delhi, India",
  loginAt: "2025-01-15T09:12:00Z",
  lastActivity: "2025-01-15T14:48:00Z",
  userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  status: "active",
  mfaVerified: true,
  os: "macOS Sonoma 14.3",
};

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, padding: "10px 0", borderBottom: "1px solid var(--border, #e2e8f0)" }}>
      <dt style={{ fontSize: 12, color: "var(--ink2)", fontWeight: 500 }}>{label}</dt>
      <dd style={{ margin: 0, fontSize: 14, fontWeight: 400 }}>{value}</dd>
    </div>
  );
}

export default function SessionDetailPage({ params }: { params: { id: string } }) {
  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <Breadcrumb items={[{ label: "Tenant Admin", href: "/tenant-admin" }, { label: "Sessions", href: "/tenant-admin/sessions" }, { label: `Session ${params.id}` }]} />
      <PageHeader
        back="/tenant-admin/sessions"
        title="Session Detail"
        subtitle={`Session for ${session.userName} (${session.userEmail})`}
        actions={
          <PlaceholderButton label="Revoke Session" aria-label="Revoke this session" style={{ minHeight: 44, minWidth: 44 }} />
        }
      />

      <div className="grid g-2" style={{ marginTop: 18 }}>
        <Card title="User & Authentication" padding>
          <dl style={{ margin: 0 }}>
            <Field label="User" value={session.userName} />
            <Field label="Email" value={session.userEmail} />
            <Field label="MFA Verified" value={session.mfaVerified ? "Yes ✅" : "No ❌"} />
            <Field label="Status" value={<StatusPill status={session.status} />} />
          </dl>
        </Card>
        <Card title="Device & Network" padding>
          <dl style={{ margin: 0 }}>
            <Field label="Device" value={session.device} />
            <Field label="Operating System" value={session.os} />
            <Field label="Browser" value={session.browser} />
            <Field label="IP Address" value={<span className="mono">{session.ipAddress}</span>} />
            <Field label="Location" value={session.location} />
          </dl>
        </Card>
      </div>
      <Card title="Timing" padding>
        <dl style={{ margin: 0 }}>
          <Field label="Login Timestamp" value={new Date(session.loginAt).toLocaleString("en-IN", { dateStyle: "full", timeStyle: "medium" })} />
          <Field label="Last Activity" value={new Date(session.lastActivity).toLocaleString("en-IN", { dateStyle: "full", timeStyle: "medium" })} />
        </dl>
      </Card>
      <Card title="User Agent" padding>
        <p className="mono" style={{ fontSize: 12, margin: 0, wordBreak: "break-all" }}>{session.userAgent}</p>
      </Card>
    </main>
  );
}
