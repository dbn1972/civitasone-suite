import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatCard, StatGrid, DataTable, EmptyState, RefreshErrorState } from "../../../_components/ds";
import { getCatalogueOfferings, getMyServiceRequests } from "../../../_data/loaders";
import { formatMinutesDuration } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";
import { HELPDESK_PRIORITY_VARIANTS } from "@/lib/helpdesk/priorityVariants";

/**
 * GAP-HELPDESK-CATALOGUE-MY-REQUESTS-05: statuses that represent a closed /
 * terminal request — everything else is "in progress".
 */
const CLOSED_STATUSES = ["fulfilled", "rejected", "cancelled"];

type Row = {
  id: string;
  name: string;
  category: string;
  approval: string;
  priority: string;
  fulfilment: string;
  turnaround: string;
};

export default async function Page() {
  const [{ data: offerings, source }, { data: myRequests, source: mySource }] = await Promise.all([
    getCatalogueOfferings(),
    getMyServiceRequests(),
  ]);
  const errored = source === "error";
  const myErrored = mySource === "error";

  const categories = new Set(offerings.map((o) => o.category));
  const needsApproval = offerings.filter((o) => o.approvalRequired).length;

  // GAP-HELPDESK-CATALOGUE-01: wire "My Requests" stat card to real data
  const myOpen = myErrored
    ? null
    : myRequests.filter((r) => !CLOSED_STATUSES.includes(r.status)).length;

  const rows: Row[] = offerings.map((o) => ({
    id: o.id,
    name: o.name,
    category: o.category,
    // GAP-HELPDESK-CATALOGUE-03: replace "Maker-checker" ITIL jargon with plain wording
    approval: o.approvalRequired ? "Needs approval" : "No approval needed",
    priority: o.defaultPriority,
    fulfilment: `${o.fulfilmentStages.length} stage${o.fulfilmentStages.length === 1 ? "" : "s"}`,
    // GAP-HELPDESK-CATALOGUE-05: show expected turnaround from the max OLA target
    turnaround: o.olas && o.olas.length > 0
      ? formatMinutesDuration(Math.max(...o.olas.map((ola) => ola.targetMinutes)))
      : "—",
  }));

  return (
    <>
      <PageHeader
        title="Service Catalogue"
        subtitle="Browse available services, then select one to raise a request."
        back="/helpdesk"
      />
      {source === "error" && <DataSourceBadge source={source} />}
      <StatGrid>
        <StatCard icon="🧾" label="Offerings" value={errored ? "—" : offerings.length.toLocaleString("en-IN")} />
        <StatCard icon="🗂️" label="Categories" value={errored ? "—" : categories.size.toLocaleString("en-IN")} />
        <StatCard icon="✅" label="Approval Required" value={errored ? "—" : needsApproval.toLocaleString("en-IN")} />
        <StatCard
          icon="📥"
          label="In Progress"
          hint="Requests not yet fulfilled, rejected or cancelled"
          href="/helpdesk/catalogue/my-requests"
          value={myErrored ? "—" : (myOpen ?? "—").toLocaleString("en-IN")}
        />
      </StatGrid>
      <div style={{ display: "flex", gap: 8, margin: "12px 0" }}>
        <Link href="/helpdesk/catalogue/my-requests" className="btn ghost" style={{ minHeight: 40 }}>My requests</Link>
        <Link href="/helpdesk/catalogue/breaches" className="btn ghost" style={{ minHeight: 40 }}>Breach report</Link>
      </div>
      <div className="card">
        <div className="card-h"><h3>Catalogue offerings</h3></div>
        {errored ? (
          <RefreshErrorState error={toHumanError("load", { area: "catalogue offerings" })} backHref="/helpdesk" />
        ) : rows.length === 0 ? (
          // GAP-HELPDESK-CATALOGUE-02: honest empty state (no promise of a publish UI)
          <EmptyState
            icon="🧾"
            title="No services available yet"
            message="Please contact your helpdesk administrator."
            action={<Link href="/helpdesk/tickets/new" className="btn primary">Raise a ticket instead</Link>}
          />
        ) : (
          <DataTable<Row>
            columns={[
              { key: "name", label: "Offering" },
              // GAP-HELPDESK-CATALOGUE-03: Category is plain text, not a status pill
              { key: "category", label: "Category" },
              // Priority keeps cellType "status" — the map now has low/medium/high/critical
              { key: "priority", label: "Priority", cellType: "status", statusVariants: HELPDESK_PRIORITY_VARIANTS },
              { key: "approval", label: "Approval" },
              { key: "fulfilment", label: "Fulfilment" },
              { key: "turnaround", label: "Expected turnaround" },
            ]}
            rows={rows}
            rowLinkKey="id"
            rowLinkPrefix="/helpdesk/catalogue/"
            sortable
            filterable
            filterPlaceholder="Filter catalogue…"
            pageSize={15}
            exportable
            exportFilename="catalogue-offerings"
          />
        )}
      </div>
    </>
  );
}
