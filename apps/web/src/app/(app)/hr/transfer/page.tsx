import { PageHeader, StatGrid, StatCard, DataTable } from "../../../_components/ds";
import { fetchJson } from "@/app/_data/apiClient";
import { TransferWithApproval } from "./TransferWithApproval";

type Row = {
  id: string;
  employee: string;
  fromOffice: string;
  toOffice: string;
  transferDate: string;
  orderNo: string;
  relievingDate: string;
  status: string;
} & Record<string, unknown>;

async function getData(): Promise<Row[]> {
  const r = await fetchJson<unknown, Row[]>("/api/v1/hrms/transfers", [], {
    telemetryKey: "hr.transfer",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: Row[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
  return r.data;
}

export default async function TransferPage() {
  const items = await getData();

  const completed = items.filter((i) => i.status === "completed").length;
  const pending = items.filter((i) => i.status === "pending").length;
  const approved = items.filter((i) => i.status === "approved").length;

  const columns: { key: keyof Row & string; label: string; cellType?: "status" }[] = [
    { key: "employee", label: "Employee" },
    { key: "fromOffice", label: "From" },
    { key: "toOffice", label: "To" },
    { key: "transferDate", label: "Transfer Date" },
    { key: "orderNo", label: "Order No." },
    { key: "relievingDate", label: "Relieving Date" },
    { key: "status", label: "Status", cellType: "status" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Transfer Orders" subtitle="Employee transfer orders and relieving status." back="/hr" actions={<TransferWithApproval />} />
      <StatGrid>
        <StatCard icon="🔄" iconBg="#e6f0ff" label="Total Transfers" value={items.length} />
        <StatCard icon="✅" iconBg="#e6f7f0" label="Completed" value={completed} />
        <StatCard icon="⏳" iconBg="#fffbe6" label="Pending" value={pending} />
        <StatCard icon="👍" iconBg="#f0f5ff" label="Approved" value={approved} />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>Transfer Orders</h3></div>
        <DataTable<Row> columns={columns} rows={items} sortable filterable filterPlaceholder="Filter by employee, office or order no…" pageSize={15} />
      </div>
    </main>
  );
}
