import { PageHeader, StatGrid, StatCard, DataTable } from "../../../_components/ds";

type Row = {
  id: string;
  employee: string;
  eventType: string;
  fromPosting: string;
  toPosting: string;
  effectiveDate: string;
  orderNo: string;
  status: string;
} & Record<string, unknown>;

const items: Row[] = [
  { id: "1", employee: "Rajesh Verma", eventType: "Transfer", fromPosting: "Finance, Delhi", toPosting: "Accounts, Lucknow", effectiveDate: "15/03/2024", orderNo: "TR/2024/0341", status: "completed" },
  { id: "2", employee: "Priya Sharma", eventType: "Promotion", fromPosting: "Level 7, HR", toPosting: "Level 8, HR", effectiveDate: "01/04/2024", orderNo: "PR/2024/0112", status: "active" },
  { id: "3", employee: "Amit Patel", eventType: "Deputation", fromPosting: "IT, Mumbai", toPosting: "NIC, Delhi", effectiveDate: "10/01/2024", orderNo: "DP/2024/0045", status: "active" },
  { id: "4", employee: "Sunita Rao", eventType: "Transfer", fromPosting: "Legal, Hyderabad", toPosting: "Legal, Chennai", effectiveDate: "20/06/2023", orderNo: "TR/2023/0891", status: "completed" },
  { id: "5", employee: "Vikram Singh", eventType: "Posting", fromPosting: "Probation", toPosting: "Admin, Jaipur", effectiveDate: "05/07/2024", orderNo: "PS/2024/0067", status: "active" },
  { id: "6", employee: "Meera Iyer", eventType: "Reversion", fromPosting: "Level 10, Finance", toPosting: "Level 9, Finance", effectiveDate: "01/02/2024", orderNo: "RV/2024/0008", status: "completed" },
];

export default function ServiceBookPage() {
  const transfers = items.filter((i) => i.eventType === "Transfer").length;
  const promotions = items.filter((i) => i.eventType === "Promotion").length;
  const deputations = items.filter((i) => i.eventType === "Deputation").length;

  const columns: { key: keyof Row & string; label: string; cellType?: "status" }[] = [
    { key: "employee", label: "Employee" },
    { key: "eventType", label: "Event" },
    { key: "fromPosting", label: "From" },
    { key: "toPosting", label: "To" },
    { key: "effectiveDate", label: "Effective Date" },
    { key: "orderNo", label: "Order No." },
    { key: "status", label: "Status", cellType: "status" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Service Book" subtitle="Service history, postings timeline — transfers, promotions, and actions." back="/hr" />
      <StatGrid>
        <StatCard icon="📖" iconBg="#e6f0ff" label="Total Entries" value={items.length} />
        <StatCard icon="🔄" iconBg="#fffbe6" label="Transfers" value={transfers} />
        <StatCard icon="⬆️" iconBg="#e6f7f0" label="Promotions" value={promotions} />
        <StatCard icon="🏛️" iconBg="#f5f5f5" label="Deputations" value={deputations} />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>Service History</h3></div>
        <DataTable<Row> columns={columns} rows={items} sortable filterable filterPlaceholder="Filter by employee, event type or order no…" pageSize={15} />
      </div>
    </main>
  );
}
