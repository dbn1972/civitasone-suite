import { PageHeader, StatGrid, StatCard, DataTable } from "../../../_components/ds";

type Row = {
  id: string;
  employee: string;
  department: string;
  certification: string;
  issuingBody: string;
  issuedDate: string;
  expiryDate: string;
  status: string;
} & Record<string, unknown>;

const items: Row[] = [
  { id: "1", employee: "Amit Patel", department: "IT", certification: "AWS Solutions Architect", issuingBody: "Amazon Web Services", issuedDate: "15/01/2024", expiryDate: "14/01/2027", status: "active" },
  { id: "2", employee: "Deepak Kumar", department: "IT", certification: "CISSP", issuingBody: "ISC²", issuedDate: "01/06/2022", expiryDate: "31/05/2025", status: "active" },
  { id: "3", employee: "Rajesh Verma", department: "Finance", certification: "CA (Chartered Accountant)", issuingBody: "ICAI", issuedDate: "10/03/2015", expiryDate: "—", status: "active" },
  { id: "4", employee: "Meera Iyer", department: "Accounts", certification: "CMA (Cost & Mgmt Accountant)", issuingBody: "ICMAI", issuedDate: "22/08/2018", expiryDate: "—", status: "active" },
  { id: "5", employee: "Priya Sharma", department: "HR", certification: "SHRM-CP", issuingBody: "SHRM", issuedDate: "01/04/2022", expiryDate: "31/03/2025", status: "active" },
  { id: "6", employee: "Rahul Mehra", department: "IT", certification: "PMP", issuingBody: "PMI", issuedDate: "15/09/2021", expiryDate: "14/09/2024", status: "overdue" },
  { id: "7", employee: "Sunita Rao", department: "Legal", certification: "Mediation & Conciliation", issuingBody: "MCPC India", issuedDate: "05/11/2023", expiryDate: "04/11/2026", status: "active" },
];

export default function CertificationsPage() {
  const active = items.filter((i) => i.status === "active").length;
  const expiring = items.filter((i) => i.status === "overdue").length;

  const columns: { key: keyof Row & string; label: string; cellType?: "status" }[] = [
    { key: "employee", label: "Employee" },
    { key: "department", label: "Department" },
    { key: "certification", label: "Certification" },
    { key: "issuingBody", label: "Issuing Body" },
    { key: "issuedDate", label: "Issued" },
    { key: "expiryDate", label: "Expiry" },
    { key: "status", label: "Status", cellType: "status" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Certifications" subtitle="Employee professional certifications and validity tracking." back="/hr" />
      <StatGrid>
        <StatCard icon="🏅" iconBg="#e6f0ff" label="Total Certifications" value={items.length} />
        <StatCard icon="✅" iconBg="#e6f7f0" label="Active/Valid" value={active} />
        <StatCard icon="⚠️" iconBg="#fff0f0" label="Expired/Due" value={expiring} />
        <StatCard icon="👥" iconBg="#f5f5f5" label="Certified Staff" value={6} />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>Certifications Register</h3></div>
        <DataTable<Row> columns={columns} rows={items} sortable filterable filterPlaceholder="Filter by employee, certification or body…" pageSize={15} />
      </div>
    </main>
  );
}
