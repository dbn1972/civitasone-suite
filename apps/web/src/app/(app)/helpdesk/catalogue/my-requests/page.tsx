import Link from "next/link";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { PageHeader, StatCard, StatGrid, DataTable, EmptyState, RefreshErrorState } from "../../../../_components/ds";
import { getCatalogueOfferings, getMyServiceRequests } from "../../../../_data/loaders";
import { formatIndianDate } from "@/lib/formatters";
import { slaLabel } from "@/lib/slaLabels";
import { toHumanError } from "@/lib/messages";

type Row = {
  id: string;
  ref: string;
  service: string;
  status: string;
  stage: string;
  sla: string;
  due: string;
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

/**
 * GAP-HELPDESK-CATALOGUE-MY-REQUESTS-05: statuses that represent a closed /
 * terminal request — everything else is "in progress". "approved" is an
 * intermediate state before fulfilment (not terminal for offerings with
 * fulfilment stages), so it counts as in-progress.
 */
const CLOSED_STATUSES = ["fulfilled", "rejected", "cancelled"];

export default async function Page() {
  const [{ data: requests, source }, { data: offerings }] = await Promise.all([
    getMyServiceRequests(),
    getCatalogueOfferings(),
  ]);
  const errored = source === "error";

  const inProgress = errored ? 0 : requests.filter((r) => !CLOSED_STATUSES.includes(r.status)).length;
  const breached = errored ? 0 : requests.filter((r) => r.slaStatus === "breached").length;
  const fulfilled = errored ? 0 : requests.filter((r) => r.status === "fulfilled").length;

  // GAP-HELPDESK-CATALOGUE-MY-REQUESTS-01: build offering name map
  const offeringMap = new Map(offerings.map((o) => [o.id, o.name]));
  // Build stage name map from offerings' fulfilment stages
  const stageNameMap = new Map<string, string>();
  for (const o of offerings) {
    for (const s of o.fulfilmentStages) {
      stageNameMap.set(s.key, s.name);
    }
  }

  const rows: Row[] = requests.map((r) => ({
    id: r.id,
    // Short reference instead of raw UUID
    ref: `SR-${r.id.slice(0, 8).toUpperCase()}`,
    // Offering name or placeholder for retired offerings
    service: offeringMap.get(r.offeringId) ?? "Service (retired)",
    status: STATUS_LABEL[r.status] ?? r.status,
    // GAP-HELPDESK-CATALOGUE-MY-REQUESTS-03: show human stage name, not the raw key
    stage: r.currentStage ? (stageNameMap.get(r.currentStage) ?? r.currentStage.replace(/_/g, " ")) : "—",
    // GAP-HELPDESK-CATALOGUE-MY-REQUESTS-03: SLA label with correct acronym casing
    sla: slaLabel(r.slaStatus),
    // GAP-HELPDESK-CATALOGUE-MY-REQUESTS-04: show resolution deadline
    due: r.resolutionDeadline ? formatIndianDate(r.resolutionDeadline) : "—",
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
        {/* GAP-HELPDESK-CATALOGUE-MY-REQUESTS-05: label + hint explain the open-count rule */}
        <StatCard icon="📥" label="In Progress" hint="Requests not yet fulfilled, rejected or cancelled" value={errored ? "—" : inProgress.toLocaleString("en-IN")} />
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
              { key: "ref", label: "Reference" },
              { key: "service", label: "Service" },
              { key: "status", label: "Status", cellType: "status" },
              { key: "stage", label: "Stage" },
              { key: "sla", label: "SLA", cellType: "status" },
              { key: "due", label: "Resolution Due" },
              { key: "raised", label: "Raised" },
            ]}
            rows={rows}
            rowLinkKey="id"
            rowLinkPrefix="/helpdesk/catalogue/requests/"
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
