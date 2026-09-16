import Link from "next/link";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { PageHeader, StatCard, StatGrid, DataTable, EmptyState, RefreshErrorState } from "../../../../_components/ds";
import { getMyServiceRequests } from "../../../../_data/loaders";
import { formatIndianDate } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";

type Row = {
  id: string;
  status: string;
  stage: string;
  sla: string;
  raised: string;
};

const STATUS_LABEL: Record<string, string> = {
  pending_approval: "Pending approval",
  approved: "Approved",
  rejected: "Rejected",
  pending_fulfilment: "Pending fulfilment",
  in_fulfilment: "In fulfilment",
  fulfilled: "Fulfilled",
  cancelled: "Cancelled",
};

export default async function Page() {
  const { data: requests, source } = await getMyServiceRequests();
  const errored = source === "error";

  const open = errored ? 0 : requests.filter((r) => !["fulfilled", "rejected", "cancelled"].includes(r.status)).length;
  const breached = errored ? 0 : requests.filter((r) => r.slaStatus === "breached").length;
  const fulfilled = errored ? 0 : requests.filter((r) => r.status === "fulfilled").length;

  const rows: Row[] = requests.map((r) => ({
    id: r.id,
    status: STATUS_LABEL[r.status] ?? r.status,
    stage: r.currentStage ?? "—",
    sla: r.slaStatus.replace(/_/g, " "),
    raised: formatIndianDate(r.createdAt),
  }));

  return (
    <>
      <PageHeader
        title="My Requests"
        subtitle="Track the fulfilment and SLA status of your service requests."
        back="/helpdesk/catalogue"
        backLabel="Catalogue"
      />
      {source === "error" && <DataSourceBadge source={source} />}
      <StatGrid>
        <StatCard icon="📥" label="Open" value={errored ? "—" : open.toLocaleString("en-IN")} />
        <StatCard icon="🚨" label="SLA Breached" value={errored ? "—" : breached.toLocaleString("en-IN")} />
        <StatCard icon="✅" label="Fulfilled" value={errored ? "—" : fulfilled.toLocaleString("en-IN")} />
        <StatCard icon="🧾" label="Total" value={errored ? "—" : requests.length.toLocaleString("en-IN")} />
      </StatGrid>
      <div className="card">
        <div className="card-h"><h3>My service requests</h3></div>
        {errored ? (
          <RefreshErrorState error={toHumanError("load", { area: "your requests" })} backHref="/helpdesk/catalogue" />
        ) : rows.length === 0 ? (
          <EmptyState
            icon="🧾"
            title="No requests yet"
            message="Raise a request from the catalogue to get started."
          />
        ) : (
          <DataTable<Row>
            columns={[
              { key: "id", label: "Request" },
              { key: "status", label: "Status", cellType: "status" },
              { key: "stage", label: "Stage" },
              { key: "sla", label: "SLA", cellType: "status" },
              { key: "raised", label: "Raised" },
            ]}
            rows={rows}
            sortable
            filterable
            filterPlaceholder="Filter requests…"
            pageSize={15}
          />
        )}
      </div>
      <div style={{ marginTop: 12 }}>
        <Link href="/helpdesk/catalogue" className="btn ghost" style={{ minHeight: 40 }}>Browse catalogue</Link>
      </div>
    </>
  );
}
