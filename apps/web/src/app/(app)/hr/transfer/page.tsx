import { PageHeader, StatGrid, StatCard, Card, DataTable } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { TransferWithApproval } from "./TransferWithApproval";
import { TransferOrderCard, type TransferRow } from "./_components/TransferOrderCard";
import { TransferListFilters } from "./_components/TransferListFilters";

async function getData(): Promise<LoaderResult<TransferRow[]>> {
  // NOTE: this used to fall back to GET /api/v1/hrms/transfers whenever the
  // lifecycle endpoint's array came back empty -- but that fallback path
  // does not exist as a backend route at all, so it always failed. Net
  // effect: a genuinely-empty (successful, zero-transfers) result from the
  // real endpoint was silently overwritten by a guaranteed error, turning a
  // true "no transfers" empty state into a false "couldn't load" one. Call
  // the one real endpoint directly.
  return fetchJson<unknown, TransferRow[]>("/api/v1/hrms/lifecycle/transfers", [], {
    telemetryKey: "hr.transfer",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: TransferRow[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

export default async function TransferPage() {
  const { data: raw, source } = await getData();
  // The raw backend row only carries employeeId/fromDeptId/toDeptId (no
  // joined names yet) -- degrade to the id rather than rendering a blank
  // DataTable cell, matching the fallback TransferOrderCard already uses.
  const items: TransferRow[] = raw.map((i) => ({
    ...i,
    employee: i.employee ?? i.employeeId ?? "Unknown",
    fromOffice: i.fromOffice ?? i.fromDeptId ?? "—",
    toOffice: i.toOffice ?? i.toDeptId ?? "—",
  }));

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
      <DataSourceBadge source={source} message="Couldn't load transfer orders — showing nothing" />

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
          emptyMessage="Transfer orders appear here once issued. Use '+ Transfer with approval' to move an employee to another office."
        />
      </Card>
    </main>
  );
}
