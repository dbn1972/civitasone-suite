import { PageHeader, StatGrid, StatCard, DataTable } from "@/app/_components/ds";

export default function NoticesPage() {
  type Row = { noticeNo: string; subject: string; department: string; published: string; expiry: string; type: string };

  const rows: Row[] = [
    { noticeNo: "PN/2025/REV/001", subject: "Revision of water tariff rates w.e.f. 01-04-2025", department: "Revenue", published: "2025-02-10", expiry: "2025-03-10", type: "Statutory" },
    { noticeNo: "PN/2025/PWD/012", subject: "Invitation for public objection – Road widening Sector 22", department: "PWD", published: "2025-02-08", expiry: "2025-03-08", type: "Public Hearing" },
    { noticeNo: "PN/2025/ULB/003", subject: "Ward delimitation draft notification", department: "Urban Local Bodies", published: "2025-02-05", expiry: "2025-04-05", type: "Statutory" },
    { noticeNo: "PN/2025/EDU/007", subject: "School admission schedule 2025-26", department: "Education", published: "2025-02-01", expiry: "2025-03-31", type: "Information" },
    { noticeNo: "PN/2025/HLT/002", subject: "Empanelment of private hospitals under PMJAY", department: "Health", published: "2025-01-25", expiry: "2025-02-25", type: "Tender" },
    { noticeNo: "PN/2025/FIN/009", subject: "Annual financial statement FY 2023-24", department: "Finance", published: "2025-01-20", expiry: "2025-07-20", type: "Statutory" },
    { noticeNo: "PN/2025/ENV/004", subject: "Environmental clearance – Industrial Zone Phase II", department: "Environment", published: "2025-01-15", expiry: "2025-02-15", type: "Public Hearing" },
  ];

  const columns = [
    { key: "noticeNo" as const, label: "Notice No." },
    { key: "subject" as const, label: "Subject" },
    { key: "department" as const, label: "Department" },
    { key: "published" as const, label: "Published" },
    { key: "expiry" as const, label: "Expiry" },
    { key: "type" as const, label: "Type", cellType: "status" as const },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Public Notices" subtitle="Statutory and informational notices published by departments." back="/citizen" />
      <StatGrid>
        <StatCard icon="📰" iconBg="#eef2ff" label="Active Notices" value={5} />
        <StatCard icon="⚖️" iconBg="#ecfdf3" label="Statutory" value={3} />
        <StatCard icon="🏛️" iconBg="#fffaeb" label="Public Hearings" value={2} />
        <StatCard icon="⏰" iconBg="#fce7ee" label="Expiring This Week" value={1} />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>Notice Board</h3></div>
        <DataTable columns={columns} rows={rows} sortable filterable />
      </div>
    </main>
  );
}
