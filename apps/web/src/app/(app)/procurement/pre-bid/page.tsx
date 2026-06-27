import { PageHeader, StatGrid, StatCard, DataTable } from "@/app/_components/ds";

export default function PreBidPage() {
  type Row = { tender: string; date: string; queriesRaised: number; responses: number; attendees: number; status: string };

  const rows: Row[] = [
    { tender: "NIT/2024/PWD/0142 – Highway Widening", date: "2025-01-10", queriesRaised: 24, responses: 22, attendees: 15, status: "Completed" },
    { tender: "NIT/2024/IT/0098 – ERP Implementation", date: "2025-01-18", queriesRaised: 32, responses: 30, attendees: 22, status: "Completed" },
    { tender: "NIT/2024/MED/0056 – Hospital Equipment", date: "2025-02-05", queriesRaised: 18, responses: 18, attendees: 11, status: "Completed" },
    { tender: "NIT/2024/ELEC/0201 – Substation Upgrade", date: "2025-02-14", queriesRaised: 12, responses: 8, attendees: 9, status: "Responses Pending" },
    { tender: "NIT/2025/WS/0012 – Water Supply Pipeline", date: "2025-02-20", queriesRaised: 0, responses: 0, attendees: 0, status: "Scheduled" },
    { tender: "NIT/2025/EDU/0034 – Smart Classrooms", date: "2025-02-28", queriesRaised: 0, responses: 0, attendees: 0, status: "Scheduled" },
    { tender: "NIT/2024/TRANS/0178 – Bus Fleet", date: "2024-12-20", queriesRaised: 28, responses: 28, attendees: 18, status: "Completed" },
  ];

  const columns = [
    { key: "tender" as const, label: "Tender" },
    { key: "date" as const, label: "Conference Date" },
    { key: "queriesRaised" as const, label: "Queries Raised", align: "center" as const },
    { key: "responses" as const, label: "Responses", align: "center" as const },
    { key: "attendees" as const, label: "Attendees", align: "center" as const },
    { key: "status" as const, label: "Status", cellType: "status" as const },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Pre-Bid Conferences" subtitle="Pre-bid meetings, queries and response tracking for open tenders." back="/procurement" />
      <StatGrid>
        <StatCard icon="🎤" iconBg="#eef2ff" label="Conferences Held" value={4} />
        <StatCard icon="❓" iconBg="#ecfdf3" label="Total Queries" value={114} />
        <StatCard icon="✅" iconBg="#fffaeb" label="Responded" value={106} />
        <StatCard icon="📅" iconBg="#fce7ee" label="Scheduled" value={2} />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>Conference Log</h3></div>
        <DataTable columns={columns} rows={rows} sortable filterable />
      </div>
    </main>
  );
}
