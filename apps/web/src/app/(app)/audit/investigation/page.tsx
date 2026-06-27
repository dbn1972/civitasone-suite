import { PageHeader, StatGrid, StatCard, DataTable } from "@/app/_components/ds";

export default function InvestigationPage() {
  type Row = { caseId: string; subject: string; assignedTo: string; started: string; findings: string; status: string };

  const rows: Row[] = [
    { caseId: "INV/2024/GEN/001", subject: "Irregularity in GRN – Store Division", assignedTo: "Sh. R.K. Mehra, Dy. Dir (Audit)", started: "2024-11-15", findings: "Stock discrepancy of ₹12.4L", status: "In Progress" },
    { caseId: "INV/2024/FIN/002", subject: "Double payment to vendor – PO/2024/089", assignedTo: "Smt. Anjali Verma, Sr. Auditor", started: "2024-12-01", findings: "Confirmed – recovery initiated", status: "Findings Submitted" },
    { caseId: "INV/2025/HR/001", subject: "Fake attendance entries – Dept of Education", assignedTo: "Sh. Mohan Das, Vigilance Officer", started: "2025-01-10", findings: "Under verification", status: "In Progress" },
    { caseId: "INV/2024/PROC/003", subject: "Bid rigging allegation – NIT/2024/145", assignedTo: "Sh. K.P. Singh, CVO", started: "2024-10-20", findings: "Cartel identified, 3 vendors", status: "Findings Submitted" },
    { caseId: "INV/2025/REV/001", subject: "Revenue leakage – Property tax ward 8", assignedTo: "Smt. Deepa Nair, Tax Inspector", started: "2025-01-25", findings: "Preliminary – under-assessment", status: "In Progress" },
    { caseId: "INV/2024/IT/001", subject: "Unauthorized data access – HRMS module", assignedTo: "Sh. Arun Kumar, CISO", started: "2024-09-05", findings: "Privilege escalation confirmed", status: "Closed" },
    { caseId: "INV/2025/GRANT/001", subject: "UC submission discrepancy – CSS Grant", assignedTo: "Sh. Prakash Jha, Accounts Officer", started: "2025-02-01", findings: "Pending field verification", status: "In Progress" },
  ];

  const columns = [
    { key: "caseId" as const, label: "Case ID" },
    { key: "subject" as const, label: "Subject" },
    { key: "assignedTo" as const, label: "Assigned To" },
    { key: "started" as const, label: "Started" },
    { key: "findings" as const, label: "Findings" },
    { key: "status" as const, label: "Status", cellType: "status" as const },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Investigation Tracker" subtitle="Internal investigations with assignment, findings and resolution status." back="/audit" />
      <StatGrid>
        <StatCard icon="🕵️" iconBg="#eef2ff" label="Active Investigations" value={4} />
        <StatCard icon="📄" iconBg="#ecfdf3" label="Findings Submitted" value={2} />
        <StatCard icon="✅" iconBg="#fffaeb" label="Closed" value={1} />
        <StatCard icon="💰" iconBg="#fce7ee" label="Recovery Initiated" value="₹12.4L" />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>Investigation Cases</h3></div>
        <DataTable columns={columns} rows={rows} sortable filterable />
      </div>
    </main>
  );
}
