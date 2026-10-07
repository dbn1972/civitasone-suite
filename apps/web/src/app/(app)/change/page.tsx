import { DataSourceBadge } from "../../_components/DataSourceBadge";
import { PageHeader, StatCard, StatGrid, DataTable, EmptyState, RefreshErrorState } from "../../_components/ds";
import { getChangeRequests } from "./_data/loaders";
import { NewChangeButton } from "./NewChangeButton";
import { ChangeFilterTabs } from "./ChangeFilterTabs";
import { formatIndianDate } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";

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

// GAP-CHANGE-HOME-04: change-request risk/type pill tones. Deliberately NOT
// added to the shared STATUS_MAP (low/medium/high already mean
// priority/severity in crm/finance/helpdesk/projects and would be recoloured);
// kept register-local and passed to DataTable via statusVariants.
const RISK_VARIANTS: Record<string, "good" | "warn" | "bad"> = {
  low: "good",
  medium: "warn",
  high: "bad",
};
const TYPE_VARIANTS: Record<string, "good" | "warn" | "bad"> = {
  standard: "good",
  normal: "good",
  emergency: "bad",
};

// GAP-CHANGE-HOME-03: which raw statuses each filter tab shows.
function matchesFilter(status: string, filter: string): boolean {
  if (filter === "all") return true;
  if (filter === "open") return OPEN_STATES.has(status);
  return status === filter;
}

const VALID_FILTERS = new Set(["all", "submitted", "scheduled", "open"]);

export default async function Page({ searchParams }: { searchParams?: { status?: string } }) {
  const { data: changes, source } = await getChangeRequests();
  const errored = source === "error";

  const requested = searchParams?.status ?? "all";
  const filter = VALID_FILTERS.has(requested) ? requested : "all";

  const awaitingCab = errored ? null : changes.filter((c) => c.status === "submitted").length;
  const scheduled = errored ? null : changes.filter((c) => c.status === "scheduled").length;
  const open = errored ? null : changes.filter((c) => OPEN_STATES.has(c.status)).length;

  const counts: Record<string, number> = {
    all: changes.length,
    submitted: awaitingCab ?? 0,
    scheduled: scheduled ?? 0,
    open: open ?? 0,
  };

  const rows: Row[] = changes
    .filter((c) => matchesFilter(c.status, filter))
    .map((c) => ({
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
        <StatCard icon="📋" iconBg="#eef2ff" label="Total Changes" value={errored ? "—" : changes.length.toLocaleString("en-IN")} />
        <StatCard icon="🧑‍⚖️" iconBg="#fffbeb" label="Awaiting CAB" href="/change?status=submitted" value={awaitingCab === null ? "—" : awaitingCab.toLocaleString("en-IN")} />
        <StatCard icon="🗓️" iconBg="#ecfdf5" label="Scheduled" href="/change?status=scheduled" value={scheduled === null ? "—" : scheduled.toLocaleString("en-IN")} />
        <StatCard icon="🔓" iconBg="#f0f9ff" label="Open" href="/change?status=open" value={open === null ? "—" : open.toLocaleString("en-IN")} />
      </StatGrid>
      <div className="card">
        <div className="card-h" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3>Change requests</h3>
          <a className="btn ghost" href="/change/calendar">Release calendar →</a>
        </div>
        {!errored && (
          <div className="pad" style={{ paddingBottom: 0 }}>
            <ChangeFilterTabs active={filter} counts={counts} />
          </div>
        )}
        {errored ? (
          <RefreshErrorState error={toHumanError("load", { area: "change requests" })} />
        ) : rows.length === 0 ? (
          <EmptyState icon="📋" title="No change requests" message={filter === "all" ? "Raise the first change to start the governed release process." : "No change requests match this filter."} />
        ) : (
          <DataTable<Row>
            columns={[
              { key: "title", label: "Title" },
              { key: "type", label: "Type", cellType: "status", statusVariants: TYPE_VARIANTS },
              { key: "risk", label: "Risk", cellType: "status", statusVariants: RISK_VARIANTS },
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
