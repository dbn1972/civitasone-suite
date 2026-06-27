import { PageHeader, StatGrid, StatCard, DataTable } from "../../../_components/ds";

type Row = {
  id: string;
  name: string;
  grade: string;
  components: string;
  basicPay: string;
  effectiveDate: string;
  employees: string;
  status: string;
} & Record<string, unknown>;

const items: Row[] = [
  { id: "1", name: "Group A — Level 10+", grade: "Level 10–14", components: "Basic, DA, HRA, TA, NPS", basicPay: "₹56,100–₹2,25,000", effectiveDate: "01/01/2024", employees: "45", status: "active" },
  { id: "2", name: "Group B — Level 6–9", grade: "Level 6–9", components: "Basic, DA, HRA, TA, NPS", basicPay: "₹35,400–₹1,42,400", effectiveDate: "01/01/2024", employees: "120", status: "active" },
  { id: "3", name: "Group C — Level 1–5", grade: "Level 1–5", components: "Basic, DA, HRA, TA, NPS", basicPay: "₹18,000–₹1,12,400", effectiveDate: "01/01/2024", employees: "310", status: "active" },
  { id: "4", name: "Contractual Staff", grade: "Consolidated", components: "Consolidated Pay", basicPay: "₹25,000–₹75,000", effectiveDate: "01/04/2024", employees: "85", status: "active" },
  { id: "5", name: "Deputation — Level 12+", grade: "Level 12–14", components: "Basic, DA, Deputation Allowance", basicPay: "₹78,800–₹2,25,000", effectiveDate: "01/01/2024", employees: "12", status: "active" },
  { id: "6", name: "Pre-revision (6th CPC)", grade: "PB-2/PB-3", components: "Basic, DA, HRA, TA", basicPay: "₹9,300–₹34,800", effectiveDate: "01/01/2016", employees: "0", status: "completed" },
];

export default function SalaryStructurePage() {
  const active = items.filter((i) => i.status === "active").length;
  const totalEmployees = items.reduce((sum, i) => sum + parseInt(i.employees), 0);

  const columns: { key: keyof Row & string; label: string; cellType?: "status" }[] = [
    { key: "name", label: "Structure Name" },
    { key: "grade", label: "Grade/Level" },
    { key: "components", label: "Components" },
    { key: "basicPay", label: "Basic Pay Range" },
    { key: "effectiveDate", label: "Effective Date" },
    { key: "employees", label: "Employees" },
    { key: "status", label: "Status", cellType: "status" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Salary Structures" subtitle="Pay structure definitions by grade and level." back="/hr" />
      <StatGrid>
        <StatCard icon="📊" iconBg="#e6f0ff" label="Structures" value={items.length} />
        <StatCard icon="✅" iconBg="#e6f7f0" label="Active" value={active} />
        <StatCard icon="👥" iconBg="#fffbe6" label="Employees Covered" value={totalEmployees.toLocaleString("en-IN")} />
        <StatCard icon="📅" iconBg="#f5f5f5" label="Last Revision" value="Jan 2024" />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>Salary Structures</h3></div>
        <DataTable<Row> columns={columns} rows={items} sortable filterable filterPlaceholder="Filter by name, grade or status…" pageSize={15} />
      </div>
    </main>
  );
}
