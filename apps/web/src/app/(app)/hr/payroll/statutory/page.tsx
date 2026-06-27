import { PageHeader, StatGrid, StatCard, DataTable } from "../../../../_components/ds";

type Row = {
  id: string;
  employee: string;
  department: string;
  pfEmployee: string;
  pfEmployer: string;
  esi: string;
  professionalTax: string;
  nps: string;
  total: string;
} & Record<string, unknown>;

const items: Row[] = [
  { id: "1", employee: "Rajesh Verma", department: "Finance", pfEmployee: "₹21,600", pfEmployer: "₹21,600", esi: "—", professionalTax: "₹2,500", nps: "₹15,400", total: "₹61,100" },
  { id: "2", employee: "Priya Sharma", department: "HR", pfEmployee: "₹21,600", pfEmployer: "₹21,600", esi: "—", professionalTax: "₹2,500", nps: "₹12,800", total: "₹58,500" },
  { id: "3", employee: "Amit Patel", department: "IT", pfEmployee: "₹21,600", pfEmployer: "₹21,600", esi: "—", professionalTax: "₹2,500", nps: "₹14,200", total: "₹59,900" },
  { id: "4", employee: "Sunita Rao", department: "Legal", pfEmployee: "₹21,600", pfEmployer: "₹21,600", esi: "—", professionalTax: "₹2,500", nps: "₹13,500", total: "₹59,200" },
  { id: "5", employee: "Vikram Singh", department: "Admin", pfEmployee: "₹18,000", pfEmployer: "₹18,000", esi: "—", professionalTax: "₹2,500", nps: "₹10,800", total: "₹49,300" },
  { id: "6", employee: "Deepak Kumar", department: "IT", pfEmployee: "₹15,600", pfEmployer: "₹15,600", esi: "₹1,890", professionalTax: "₹2,400", nps: "₹9,200", total: "₹44,690" },
  { id: "7", employee: "Kavita Nair", department: "Procurement", pfEmployee: "₹14,400", pfEmployer: "₹14,400", esi: "₹1,750", professionalTax: "₹2,000", nps: "₹8,600", total: "₹41,150" },
];

export default function StatutoryPage() {
  const withNPS = items.filter((i) => i.nps !== "—").length;
  const withESI = items.filter((i) => i.esi !== "—").length;

  const columns: { key: keyof Row & string; label: string; align?: "left" | "right" }[] = [
    { key: "employee", label: "Employee" },
    { key: "pfEmployee", label: "PF (Emp)" },
    { key: "pfEmployer", label: "PF (Empr)" },
    { key: "esi", label: "ESI" },
    { key: "professionalTax", label: "Prof. Tax" },
    { key: "nps", label: "NPS" },
    { key: "total", label: "Total Statutory", align: "right" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Statutory Deductions" subtitle="PF, ESI, Professional Tax, and NPS contribution breakdown." back="/hr" />
      <StatGrid>
        <StatCard icon="🏛️" iconBg="#e6f0ff" label="Employees" value={items.length} />
        <StatCard icon="🏦" iconBg="#e6f7f0" label="PF Contributors" value={items.length} />
        <StatCard icon="🏥" iconBg="#fffbe6" label="ESI Applicable" value={withESI} />
        <StatCard icon="💼" iconBg="#f5f5f5" label="NPS Subscribers" value={withNPS} />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>Statutory Deductions — Monthly</h3></div>
        <DataTable<Row> columns={columns} rows={items} sortable filterable filterPlaceholder="Filter by employee or department…" pageSize={15} />
      </div>
    </main>
  );
}
