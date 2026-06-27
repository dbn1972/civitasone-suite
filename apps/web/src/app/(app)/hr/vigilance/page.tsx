import { PageHeader, StatGrid, StatCard, DataTable } from "../../../_components/ds";

type Row = {
  id: string;
  employee: string;
  department: string;
  charges: string;
  filedDate: string;
  inquiryOfficer: string;
  nextHearing: string;
  status: string;
} & Record<string, unknown>;

const items: Row[] = [
  { id: "VIG-2024-001", employee: "S.K. Malhotra", department: "Procurement", charges: "Irregularity in tender process", filedDate: "10/01/2024", inquiryOfficer: "R.P. Sinha (Retd.)", nextHearing: "25/08/2024", status: "active" },
  { id: "VIG-2024-002", employee: "B.R. Tiwari", department: "Admin", charges: "Misuse of official vehicle", filedDate: "15/03/2024", inquiryOfficer: "Committee", nextHearing: "10/08/2024", status: "active" },
  { id: "VIG-2024-003", employee: "N.K. Dubey", department: "Finance", charges: "Unauthorized expenditure", filedDate: "20/04/2024", inquiryOfficer: "K.S. Rao (Retd.)", nextHearing: "—", status: "completed" },
  { id: "VIG-2024-004", employee: "G.L. Meena", department: "Accounts", charges: "Non-disclosure of assets", filedDate: "05/06/2024", inquiryOfficer: "CVO", nextHearing: "15/09/2024", status: "pending" },
  { id: "VIG-2024-005", employee: "P. Rajan", department: "IT", charges: "Data privacy breach", filedDate: "22/06/2024", inquiryOfficer: "CISO", nextHearing: "01/09/2024", status: "active" },
];

export default function VigilancePage() {
  const active = items.filter((i) => i.status === "active").length;
  const pending = items.filter((i) => i.status === "pending").length;
  const completed = items.filter((i) => i.status === "completed").length;

  const columns: { key: keyof Row & string; label: string; cellType?: "status" }[] = [
    { key: "id", label: "Case No." },
    { key: "employee", label: "Employee" },
    { key: "department", label: "Department" },
    { key: "charges", label: "Charges" },
    { key: "inquiryOfficer", label: "Inquiry Officer" },
    { key: "nextHearing", label: "Next Hearing" },
    { key: "status", label: "Status", cellType: "status" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Vigilance & Disciplinary" subtitle="Vigilance cases and disciplinary proceedings." back="/hr" />
      <StatGrid>
        <StatCard icon="⚖️" iconBg="#e6f0ff" label="Total Cases" value={items.length} />
        <StatCard icon="▶️" iconBg="#fffbe6" label="Under Inquiry" value={active} />
        <StatCard icon="⏳" iconBg="#fff0f0" label="Pending" value={pending} />
        <StatCard icon="✅" iconBg="#e6f7f0" label="Concluded" value={completed} />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>Vigilance Cases</h3></div>
        <DataTable<Row> columns={columns} rows={items} sortable filterable filterPlaceholder="Filter by employee, charges or case no…" pageSize={15} />
      </div>
    </main>
  );
}
