import { PageHeader, StatCard, StatGrid, Card, DataTable } from "@/app/_components/ds";
import { Breadcrumb } from "../Breadcrumb";

type SecurityEvent = {
  id: string;
  timestamp: string;
  type: string;
  actor: string;
  ipAddress: string;
  outcome: string;
};

const securityEvents: SecurityEvent[] = [
  { id: "sec-001", timestamp: "2025-01-15T14:32:00Z", type: "Failed login", actor: "unknown@example.com", ipAddress: "203.0.113.42", outcome: "blocked" },
  { id: "sec-002", timestamp: "2025-01-15T13:18:00Z", type: "MFA bypass attempt", actor: "ravi.kumar@gov.in", ipAddress: "198.51.100.7", outcome: "blocked" },
  { id: "sec-003", timestamp: "2025-01-15T12:45:00Z", type: "Suspicious login location", actor: "priya.sharma@gov.in", ipAddress: "192.0.2.15", outcome: "flagged" },
  { id: "sec-004", timestamp: "2025-01-15T11:02:00Z", type: "Password reset", actor: "admin@civitas.gov.in", ipAddress: "10.0.1.50", outcome: "success" },
  { id: "sec-005", timestamp: "2025-01-15T09:55:00Z", type: "Role escalation attempt", actor: "guest.user@example.com", ipAddress: "203.0.113.99", outcome: "blocked" },
  { id: "sec-006", timestamp: "2025-01-15T08:30:00Z", type: "New device login", actor: "anjali.desai@gov.in", ipAddress: "10.0.2.12", outcome: "success" },
];

export default function SecurityCenterPage() {
  const activeSessions = 47;
  const failedLogins24h = 12;
  const mfaAdoptionRate = 84;
  const trustedDevices = 132;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <Breadcrumb items={[{ label: "Tenant Admin", href: "/tenant-admin" }, { label: "Security Center" }]} />
      <PageHeader
        back="/tenant-admin"
        title="Security Center"
        subtitle="Overview of security posture — sessions, MFA adoption, device trust, and recent security events."
      />

      <StatGrid>
        <StatCard icon="🖥️" iconBg="#eff6ff" label="Active Sessions" value={activeSessions} />
        <StatCard icon="🚫" iconBg="#fef3f2" label="Failed Logins (24h)" value={failedLogins24h} />
        <StatCard icon="🔐" iconBg="#ecfdf3" label="MFA Adoption" value={`${mfaAdoptionRate}%`} />
        <StatCard icon="📱" iconBg="#f1f5f9" label="Trusted Devices" value={trustedDevices} />
      </StatGrid>
      <Card title="Recent Security Events" link={<a href="/tenant-admin/audit" className="lnk">View full audit log →</a>}>
        <DataTable<SecurityEvent & Record<string, unknown>>
          columns={[
            { key: "timestamp", label: "Time", render: (row) => new Date(row.timestamp as string).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) },
            { key: "type", label: "Event" },
            { key: "actor", label: "Actor" },
            { key: "ipAddress", label: "IP Address" },
            { key: "outcome", label: "Outcome", render: (row) => <span className={`pill ${row.outcome === "success" ? "good" : row.outcome === "flagged" ? "warn" : "bad"}`}>{row.outcome as string}</span> },
          ]}
          rows={securityEvents as (SecurityEvent & Record<string, unknown>)[]}
        />
      </Card>
    </main>
  );
}
