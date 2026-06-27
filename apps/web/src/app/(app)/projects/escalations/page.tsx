import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { EscalationsTable, type EscalationRow } from "./EscalationsTable";

const rows: EscalationRow[] = [
  { escalationId: "ESC-001", project: "NH-44 Bypass Construction", issue: "Land acquisition stalled for 6 months", severity: "blocked", escalatedTo: "Chief Secretary", raisedDate: "2024-04-10", status: "open" },
  { escalationId: "ESC-002", project: "District Hospital Upgradation - Lucknow", issue: "Contractor not mobilising equipment", severity: "overdue", escalatedTo: "Principal Secretary Health", raisedDate: "2024-04-15", status: "submitted" },
  { escalationId: "ESC-003", project: "Integrated Water Supply - Dehradun", issue: "Environmental clearance rejected twice", severity: "blocked", escalatedTo: "Secretary MoEFCC", raisedDate: "2024-03-28", status: "open" },
  { escalationId: "ESC-004", project: "Primary School Construction - Raipur", issue: "State fund release delayed beyond 90 days", severity: "overdue", escalatedTo: "Finance Secretary CG", raisedDate: "2024-05-01", status: "cleared" },
  { escalationId: "ESC-005", project: "State Highway Widening - Bhopal", issue: "Quality audit failure in base layer", severity: "pending", escalatedTo: "SE PWD Bhopal", raisedDate: "2024-05-12", status: "submitted" },
  { escalationId: "ESC-006", project: "Smart City Phase-II Varanasi", issue: "Vendor bankruptcy — ICT package at risk", severity: "blocked", escalatedTo: "CEO Smart City SPV", raisedDate: "2024-05-18", status: "open" },
  { escalationId: "ESC-007", project: "Solar Power Plant - Jaipur", issue: "Grid connectivity approval pending", severity: "pending", escalatedTo: "MD RRECL", raisedDate: "2024-04-25", status: "cleared" },
  { escalationId: "ESC-008", project: "Urban Metro Corridor - Patna", issue: "ROB design conflict with Railways", severity: "overdue", escalatedTo: "Joint Secretary MoR", raisedDate: "2024-05-20", status: "open" },
];

export default function EscalationsPage() {
  const active = rows.filter((r) => r.status !== "cleared").length;
  const critical = rows.filter((r) => r.severity === "blocked").length;
  const high = rows.filter((r) => r.severity === "overdue").length;
  const resolvedThisMonth = rows.filter((r) => r.status === "cleared").length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Escalations" subtitle="Project risk alerts, escalation queue and resolution tracking." back="/projects" />
      <StatGrid>
        <StatCard icon="🚨" iconBg="#fef3f2" label="Active Escalations" value={active} />
        <StatCard icon="🔴" iconBg="#fef3f2" label="Critical" value={critical} />
        <StatCard icon="🟠" iconBg="#fffaeb" label="High" value={high} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Resolved This Month" value={resolvedThisMonth} />
      </StatGrid>
      <Card title="Escalation Queue">
        <EscalationsTable rows={rows} />
      </Card>
    </main>
  );
}
