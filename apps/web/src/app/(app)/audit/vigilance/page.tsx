import { PageHeader, StatGrid, StatCard, DataTable } from "@/app/_components/ds";

export default function VigilancePage() {
  type Row = { caseNo: string; officer: string; charges: string; inquiryStatus: string; outcome: string };

  const rows: Row[] = [
    { caseNo: "VIG/2024/001", officer: "Sh. Rajesh Kumar, EE (PWD)", charges: "Irregularity in tender process", inquiryStatus: "Inquiry Complete", outcome: "Major Penalty" },
    { caseNo: "VIG/2024/002", officer: "Smt. Priya Sharma, AO (Finance)", charges: "Misappropriation of funds", inquiryStatus: "Under Investigation", outcome: "Pending" },
    { caseNo: "VIG/2024/003", officer: "Sh. Amit Singh, SDO (Irrigation)", charges: "Disproportionate assets", inquiryStatus: "Charge Sheet Issued", outcome: "Pending" },
    { caseNo: "VIG/2023/018", officer: "Sh. Vikram Patel, XEN (Electricity)", charges: "Favouritism in empanelment", inquiryStatus: "Inquiry Complete", outcome: "Exonerated" },
    { caseNo: "VIG/2023/022", officer: "Dr. Neha Gupta, CMO (Health)", charges: "Procurement irregularity", inquiryStatus: "Inquiry Complete", outcome: "Minor Penalty" },
    { caseNo: "VIG/2024/004", officer: "Sh. Suresh Yadav, BDO (Rural Dev)", charges: "Ghost beneficiaries in MGNREGA", inquiryStatus: "Preliminary Enquiry", outcome: "Pending" },
    { caseNo: "VIG/2024/005", officer: "Smt. Kavita Reddy, Dy. Dir (Education)", charges: "Recruitment irregularity", inquiryStatus: "Under Investigation", outcome: "Pending" },
  ];

  const columns = [
    { key: "caseNo" as const, label: "Case No." },
    { key: "officer" as const, label: "Officer" },
    { key: "charges" as const, label: "Charges" },
    { key: "inquiryStatus" as const, label: "Inquiry Status", cellType: "status" as const },
    { key: "outcome" as const, label: "Outcome", cellType: "status" as const },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Vigilance Cases" subtitle="Departmental vigilance proceedings and inquiry outcomes." back="/audit" />
      <StatGrid>
        <StatCard icon="🔍" iconBg="#eef2ff" label="Total Cases" value={7} />
        <StatCard icon="⏳" iconBg="#ecfdf3" label="Under Investigation" value={3} />
        <StatCard icon="📋" iconBg="#fffaeb" label="Inquiry Complete" value={3} />
        <StatCard icon="⚠️" iconBg="#fce7ee" label="Penalties Imposed" value={2} />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>Vigilance Register</h3></div>
        <DataTable columns={columns} rows={rows} sortable filterable />
      </div>
    </main>
  );
}
