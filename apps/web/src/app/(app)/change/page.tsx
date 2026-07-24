import { DataSourceBadge } from "../../_components/DataSourceBadge";
import { PageHeader, StatCard, StatGrid, DataTable, EmptyState } from "../../_components/ds";
import { getChangeRequests } from "./_data/loaders";
import { NewChangeButton } from "./NewChangeButton";
import { formatIndianDate } from "@/lib/formatters";

type Row = {
  id: string;
  title: string;
  type: string;
  risk: string;
  status: string;
  services: string;
  created: string;
};

const OPEN_STATES = new Set(["draft", "submitted", "approved", "scheduled", "in_progress"]);

export default async function Page() {
  const { data: changes, source } = await getChangeRequests();

  const awaitingCab = changes.filter((c) => c.status === "submitted").length;
  const scheduled = changes.filter((c) => c.status === "scheduled").length;
  const open = changes.filter((c) => OPEN_STATES.has(c.status)).length;

  const rows: Row[] = changes.map((c) => ({
    id: c.id,
    title: c.title,
    type: c.type,
    risk: c.risk,
    status: c.status.replace(/_/g, " "),
    services: c.affectedServices.join(", ") || "—",
    created: formatIndianDate(c.createdAt),
  }));

  return (
    <>
      <PageHeader
        title="Change & Release"
        subtitle="Raise changes, run CAB approval, schedule release windows and publish release notes."
        back="/dashboard"
        actions={<NewChangeButton />}
      />
      {source === "error" && <DataSourceBadge source={source} />}
      <StatGrid>
        <StatCard icon="📋" iconBg="#eef2ff" label="Total Changes" value={changes.length.toLocaleString("en-IN")} />
        <StatCard icon="🧑‍⚖️" iconBg="#fffbeb" label="Awaiting CAB" value={awaitingCab.toLocaleString("en-IN")} />
        <StatCard icon="🗓️" iconBg="#ecfdf5" label="Scheduled" value={scheduled.toLocaleString("en-IN")} />
        <StatCard icon="🔓" iconBg="#f0f9ff" label="Open" value={open.toLocaleString("en-IN")} />
      </StatGrid>
      <div className="card">
        <div className="card-h" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3>Change requests</h3>
          <a className="btn ghost" href="/change/calendar">Release calendar →</a>
        </div>
        {rows.length === 0 ? (
          <EmptyState icon="📋" title="No change requests yet" message="Raise the first change to start the governed release process." />
        ) : (
          <DataTable<Row>
            columns={[
              { key: "title", label: "Title" },
              { key: "type", label: "Type", cellType: "status" },
              { key: "risk", label: "Risk", cellType: "status" },
              { key: "status", label: "Status", cellType: "status" },
              { key: "services", label: "Affected services" },
              { key: "created", label: "Raised" },
            ]}
            rows={rows}
            rowLinkKey="id"
            rowLinkPrefix="/change/"
            sortable
            filterable
            filterPlaceholder="Filter changes…"
            pageSize={15}
          />
        )}
      </div>
    </>
  );
}
