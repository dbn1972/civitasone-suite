import { PageHeader, StatGrid, StatCard, DataTable } from "../../../_components/ds";

type Row = {
  id: string;
  vendor: string;
  department: string;
  headcount: string;
  service: string;
  contractValue: string;
  contractEnd: string;
  status: string;
} & Record<string, unknown>;

const items: Row[] = [
  { id: "1", vendor: "Sodexo India", department: "Admin", headcount: "45", service: "Housekeeping & Pantry", contractValue: "₹1,85,00,000", contractEnd: "31/03/2025", status: "active" },
  { id: "2", vendor: "G4S Security", department: "Admin", headcount: "30", service: "Security Services", contractValue: "₹1,20,00,000", contractEnd: "31/03/2025", status: "active" },
  { id: "3", vendor: "TCS iON", department: "IT", headcount: "15", service: "Application Support", contractValue: "₹2,50,00,000", contractEnd: "30/09/2024", status: "active" },
  { id: "4", vendor: "Wipro Ltd", department: "IT", headcount: "8", service: "Network Management", contractValue: "₹95,00,000", contractEnd: "31/12/2024", status: "active" },
  { id: "5", vendor: "Randstad India", department: "HR", headcount: "5", service: "Recruitment Support", contractValue: "₹35,00,000", contractEnd: "30/06/2024", status: "completed" },
  { id: "6", vendor: "KPMG Advisory", department: "Finance", headcount: "3", service: "Audit Support", contractValue: "₹48,00,000", contractEnd: "31/08/2024", status: "active" },
];

export default function OutsourcedPage() {
  const active = items.filter((i) => i.status === "active").length;
  const totalHeadcount = items.filter((i) => i.status === "active").reduce((s, i) => s + parseInt(i.headcount), 0);
  const vendors = new Set(items.map((i) => i.vendor)).size;

  const columns: { key: keyof Row & string; label: string; cellType?: "status"; align?: "left" | "right" }[] = [
    { key: "vendor", label: "Vendor" },
    { key: "department", label: "Department" },
    { key: "headcount", label: "Headcount", align: "right" },
    { key: "service", label: "Service" },
    { key: "contractValue", label: "Contract Value" },
    { key: "contractEnd", label: "Contract End" },
    { key: "status", label: "Status", cellType: "status" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Outsourced Workforce" subtitle="Vendor-wise outsourced staff, headcount, and contract details." back="/hr" />
      <StatGrid>
        <StatCard icon="🏭" iconBg="#e6f0ff" label="Total Contracts" value={items.length} />
        <StatCard icon="✅" iconBg="#e6f7f0" label="Active" value={active} />
        <StatCard icon="👥" iconBg="#fffbe6" label="Total Headcount" value={totalHeadcount} />
        <StatCard icon="🏢" iconBg="#f5f5f5" label="Vendors" value={vendors} />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>Outsourced Contracts</h3></div>
        <DataTable<Row> columns={columns} rows={items} sortable filterable filterPlaceholder="Filter by vendor, department or service…" pageSize={15} />
      </div>
    </main>
  );
}
