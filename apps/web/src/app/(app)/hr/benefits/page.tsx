import { PageHeader, StatGrid, StatCard, DataTable } from "../../../_components/ds";

type Row = {
  id: string;
  employee: string;
  department: string;
  benefitType: string;
  eligibility: string;
  enrolled: string;
  amount: string;
  status: string;
} & Record<string, unknown>;

const items: Row[] = [
  { id: "1", employee: "Rajesh Verma", department: "Finance", benefitType: "HRA", eligibility: "Eligible", enrolled: "Yes", amount: "₹24,000/month", status: "active" },
  { id: "2", employee: "Priya Sharma", department: "HR", benefitType: "LTC", eligibility: "Eligible", enrolled: "Yes", amount: "₹1,20,000", status: "active" },
  { id: "3", employee: "Amit Patel", department: "IT", benefitType: "Medical", eligibility: "Eligible", enrolled: "Yes", amount: "₹5,00,000/year", status: "active" },
  { id: "4", employee: "Sunita Rao", department: "Legal", benefitType: "Conveyance", eligibility: "Eligible", enrolled: "No", amount: "—", status: "pending" },
  { id: "5", employee: "Vikram Singh", department: "Admin", benefitType: "HRA", eligibility: "Not Eligible", enrolled: "No", amount: "—", status: "rejected" },
  { id: "6", employee: "Meera Iyer", department: "Accounts", benefitType: "LTC", eligibility: "Eligible", enrolled: "Yes", amount: "₹85,000", status: "active" },
  { id: "7", employee: "Deepak Kumar", department: "IT", benefitType: "Medical", eligibility: "Eligible", enrolled: "Yes", amount: "₹5,00,000/year", status: "active" },
];

export default function BenefitsPage() {
  const active = items.filter((i) => i.status === "active").length;
  const pending = items.filter((i) => i.status === "pending").length;
  const eligible = items.filter((i) => i.eligibility === "Eligible").length;

  const columns: { key: keyof Row & string; label: string; cellType?: "status" }[] = [
    { key: "employee", label: "Employee" },
    { key: "department", label: "Department" },
    { key: "benefitType", label: "Benefit" },
    { key: "eligibility", label: "Eligibility" },
    { key: "enrolled", label: "Enrolled" },
    { key: "amount", label: "Amount" },
    { key: "status", label: "Status", cellType: "status" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Benefits Enrollment" subtitle="HRA, LTC, medical, and conveyance benefit eligibility and enrollment." back="/hr" />
      <StatGrid>
        <StatCard icon="🎁" iconBg="#e6f0ff" label="Total Records" value={items.length} />
        <StatCard icon="✅" iconBg="#e6f7f0" label="Active" value={active} />
        <StatCard icon="⏳" iconBg="#fffbe6" label="Pending" value={pending} />
        <StatCard icon="👥" iconBg="#f5f5f5" label="Eligible" value={eligible} />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>Benefits Register</h3></div>
        <DataTable<Row> columns={columns} rows={items} sortable filterable filterPlaceholder="Filter by employee, benefit or department…" pageSize={15} />
      </div>
    </main>
  );
}
