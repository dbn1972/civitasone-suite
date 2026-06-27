"use client";

import { PageHeader, StatCard, StatGrid, Card, DataTable } from "@/app/_components/ds";
import { Breadcrumb } from "../Breadcrumb";

type SecurityAlert = {
  id: string;
  timestamp: string;
  title: string;
  severity: "critical" | "high" | "medium" | "low";
  source: string;
  status: string;
};

const alerts: SecurityAlert[] = [
  { id: "alert-001", timestamp: "2025-01-15T14:45:00Z", title: "Brute force attack detected", severity: "critical", source: "WAF", status: "active" },
  { id: "alert-002", timestamp: "2025-01-15T13:20:00Z", title: "Unusual data exfiltration pattern", severity: "high", source: "DLP", status: "investigating" },
  { id: "alert-003", timestamp: "2025-01-15T11:00:00Z", title: "Privilege escalation attempt", severity: "high", source: "IAM", status: "mitigated" },
  { id: "alert-004", timestamp: "2025-01-15T09:30:00Z", title: "Suspicious API rate spike", severity: "medium", source: "API Gateway", status: "investigating" },
  { id: "alert-005", timestamp: "2025-01-14T22:15:00Z", title: "Expired certificate on staging", severity: "low", source: "Certificate Monitor", status: "resolved" },
  { id: "alert-006", timestamp: "2025-01-14T18:00:00Z", title: "Geo-blocked IP accessing endpoint", severity: "medium", source: "Firewall", status: "blocked" },
];

function severityColor(severity: string): string {
  if (severity === "critical") return "bad";
  if (severity === "high") return "bad";
  if (severity === "medium") return "warn";
  return "info";
}

export default function SiemPage() {
  const threatLevel = "Elevated";
  const blockedIPs = 23;
  const suspiciousActivity = 7;
  const criticalAlerts = alerts.filter((a) => a.severity === "critical").length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <Breadcrumb items={[{ label: "Tenant Admin", href: "/tenant-admin" }, { label: "SIEM & Threat Monitoring" }]} />
      <PageHeader
        back="/tenant-admin"
        title="SIEM & Threat Monitoring"
        subtitle="Real-time threat intelligence, blocked IPs, suspicious activity, and security alert management."
      />

      <StatGrid>
        <StatCard icon="🚨" iconBg="#fef3f2" label="Threat Level" value={threatLevel} />
        <StatCard icon="🚫" iconBg="#f1f5f9" label="Blocked IPs" value={blockedIPs} />
        <StatCard icon="👁️" iconBg="#fffaeb" label="Suspicious Activity" value={suspiciousActivity} />
        <StatCard icon="⚠️" iconBg="#fef3f2" label="Critical Alerts" value={criticalAlerts} />
      </StatGrid>
      <Card title="Security Alerts">
        <DataTable<SecurityAlert & Record<string, unknown>>
          columns={[
            { key: "timestamp", label: "Time", render: (row) => new Date(row.timestamp as string).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) },
            { key: "title", label: "Alert" },
            { key: "severity", label: "Severity", render: (row) => <span className={`pill ${severityColor(row.severity as string)}`}>{row.severity as string}</span> },
            { key: "source", label: "Source" },
            { key: "status", label: "Status", render: (row) => <span className={`pill ${row.status === "resolved" || row.status === "mitigated" || row.status === "blocked" ? "good" : row.status === "active" ? "bad" : "warn"}`}>{row.status as string}</span> },
          ]}
          rows={alerts as (SecurityAlert & Record<string, unknown>)[]}
        />
      </Card>
    </main>
  );
}
