import { PageHeader, StatGrid, StatCard, Card, DataTable } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { TransferWithApproval } from "./TransferWithApproval";
import { TransferOrderCard, type TransferRow } from "./_components/TransferOrderCard";
import { TransferListFilters } from "./_components/TransferListFilters";

async function getData(): Promise<LoaderResult<TransferRow[]>> {
  const r = await fetchJson<unknown, TransferRow[]>("/api/v1/hrms/lifecycle/transfers", [], {
    telemetryKey: "hr.transfer",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: TransferRow[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
  // Fallback to the non-lifecycle endpoint if the lifecycle endpoint returns nothing
  if (r.data.length === 0) {
    return fetchJson<unknown, TransferRow[]>("/api/v1/hrms/transfers", [], {
      telemetryKey: "hr.transfer.fallback",
      mapResponse: (p) => {
        const arr = Array.isArray(p) ? p : (p as { data?: TransferRow[] })?.data;
        return Array.isArray(arr) ? arr : null;
      },
    });
  }
  return r;
}

export default async function TransferPage() {
  const { data: items, source } = await getData();

  const completed = items.filter((i) => ["completed", "joined"].includes(i.status)).length;
  const pending   = items.filter((i) => ["pending", "initiated"].includes(i.status)).length;
  const approved  = items.filter((i) => ["approved", "order_issued"].includes(i.status)).length;
  const relieved  = items.filter((i) => i.status === "relieved").length;

  const tableColumns: { key: keyof TransferRow & string; label: string; cellType?: "status" }[] = [
    { key: "employee",     label: "Employee"      },
    { key: "fromOffice",   label: "From"          },
    { key: "toOffice",     label: "To"            },
    { key: "effectiveDate",label: "Effective Date"},
    { key: "orderNo",      label: "Order No."     },
    { key: "relievedDate", label: "Relieved Date" },
    { key: "status",       label: "Status", cellType: "status" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Transfer Orders"
        subtitle="Employee transfer orders — initiation to relieving and joining."
        back="/hr"
        actions={<TransferWithApproval />}
      />
      <DataSourceBadge source={source} />

      <StatGrid>
        <StatCard icon="🔄" iconBg="#e6f0ff" label="Total Transfers"    value={items.length} />
        <StatCard icon="✅" iconBg="#e6f7f0" label="Completed / Joined" value={completed} />
        <StatCard icon="⏳" iconBg="#fffbe6" label="Pending"            value={pending} />
        <StatCard icon="👍" iconBg="#f0f5ff" label="Order Issued"       value={approved} />
        {relieved > 0 && (
          <StatCard icon="📍" iconBg="#fef9c3" label="Relieved" value={relieved} />
        )}
      </StatGrid>

      {/* Card grid with filters + export — client island */}
      <TransferListFilters transfers={items} />

      {/* Table fallback for density view */}
      <Card title="Transfer Orders — Table View">
        <DataTable<TransferRow>
          columns={tableColumns}
          rows={items}
          sortable
          filterable
          filterPlaceholder="Filter by employee, office or order no…"
          pageSize={15}
          emptyIcon="📍"
          emptyTitle="No transfer orders"
          emptyMessage="Transfer orders appear here once issued. Use '+ Initiate Transfer' to move an employee to another office."
        />
      </Card>
    </main>
  );
}
