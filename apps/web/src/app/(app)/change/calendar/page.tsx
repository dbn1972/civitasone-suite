import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatCard, StatGrid, EmptyState, DataTable, RefreshErrorState } from "../../../_components/ds";
import { getChangeRequests, getChangeFreezes } from "../_data/loaders";
import { freezeState } from "../_data/calendar";
import { ReleaseCalendar } from "./ReleaseCalendar";
import { toHumanError } from "@/lib/messages";

type WindowRow = { id: string; title: string; type: string; status: string; windowStart: string | null; windowEnd: string | null };
type FreezeRow = { id: string; name: string; state: string; startsAt: string; endsAt: string; reason: string };

const FREEZE_STATE_LABELS: Record<string, string> = { upcoming: "Upcoming", active: "Active", ended: "Ended" };
const FREEZE_STATE_VARIANTS: Record<string, "good" | "warn" | "mut"> = { upcoming: "warn", active: "good", ended: "mut" };

export default async function Page({ searchParams }: { searchParams?: { showEnded?: string } }) {
  const [{ data: changes, source: cSource }, { data: freezes, source: fSource }] = await Promise.all([
    getChangeRequests(),
    getChangeFreezes(),
  ]);
  const cErrored = cSource === "error";
  const fErrored = fSource === "error";
  const anyErrored = cErrored || fErrored;
  const showEnded = searchParams?.showEnded === "1";

  const scheduled = changes
    .filter((c) => c.windowStart && (c.status === "scheduled" || c.status === "in_progress"))
    .sort((a, b) => new Date(a.windowStart ?? 0).getTime() - new Date(b.windowStart ?? 0).getTime());

  const freezesWithState = [...freezes]
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())
    .map((f) => ({ freeze: f, state: freezeState(f) }));
  const visibleFreezes = showEnded ? freezesWithState : freezesWithState.filter((f) => f.state !== "ended");
  const endedCount = freezesWithState.filter((f) => f.state === "ended").length;

  const windowRows: WindowRow[] = scheduled.map((c) => ({
    id: c.id, title: c.title, type: c.type, status: c.status.replace(/_/g, " "),
    windowStart: c.windowStart, windowEnd: c.windowEnd,
  }));
  const freezeRows: FreezeRow[] = visibleFreezes.map(({ freeze: f, state }) => ({
    id: f.id, name: f.name, state, startsAt: f.startsAt, endsAt: f.endsAt, reason: f.reason,
  }));

  return (
    <>
      <PageHeader title="Release calendar" subtitle="Scheduled release windows and change freezes (ended freezes hidden by default)." back="/change" />
      {anyErrored && <DataSourceBadge source="error" />}
      <StatGrid>
        {/* GAP-CHANGE-CALENDAR-02: per-loader "—" on error so a broken feed never
            reads as a reassuring 0 (which could invite scheduling into a freeze). */}
        <StatCard icon="🗓️" iconBg="#ecfdf5" label="Scheduled releases" value={cErrored ? "—" : scheduled.length.toLocaleString("en-IN")} />
        <StatCard icon="🧊" iconBg="#eff6ff" label="Change freezes" value={fErrored ? "—" : freezes.length.toLocaleString("en-IN")} />
      </StatGrid>

      {/* GAP-CHANGE-CALENDAR-01: visual agenda flagging window/freeze conflicts. */}
      {!cErrored && !fErrored && <ReleaseCalendar scheduled={scheduled} freezes={freezes} />}

      <div className="card">
        <div className="card-h"><h3>Upcoming release windows</h3></div>
        {cErrored ? (
          <RefreshErrorState error={toHumanError("load", { area: "release windows" })} />
        ) : windowRows.length === 0 ? (
          <EmptyState icon="🗓️" title="No scheduled releases" message="Approved changes with a booked window appear here." />
        ) : (
          <DataTable<WindowRow>
            columns={[
              { key: "title", label: "Change" },
              { key: "type", label: "Type" },
              { key: "status", label: "Status", cellType: "status" },
              { key: "windowStart", label: "Window start", cellType: "datetime" },
              { key: "windowEnd", label: "Window end", cellType: "datetime" },
            ]}
            rows={windowRows}
            rowLinkKey="id"
            rowLinkPrefix="/change/"
            sortable
            filterable
            filterPlaceholder="Filter windows…"
          />
        )}
      </div>

      <div className="card">
        <div className="card-h" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3>Change freezes</h3>
          {!fErrored && endedCount > 0 && (
            <a className="btn ghost" href={showEnded ? "/change/calendar" : "/change/calendar?showEnded=1"}>
              {showEnded ? "Hide ended" : `Show ended (${endedCount})`}
            </a>
          )}
        </div>
        {fErrored ? (
          <RefreshErrorState error={toHumanError("load", { area: "change freezes" })} />
        ) : freezeRows.length === 0 ? (
          <EmptyState icon="🧊" title="No change freezes" message="Freeze windows block scheduling of overlapping releases." />
        ) : (
          <DataTable<FreezeRow>
            columns={[
              { key: "name", label: "Name" },
              { key: "state", label: "State", cellType: "status", statusLabels: FREEZE_STATE_LABELS, statusVariants: FREEZE_STATE_VARIANTS },
              { key: "startsAt", label: "Starts", cellType: "datetime" },
              { key: "endsAt", label: "Ends", cellType: "datetime" },
              { key: "reason", label: "Reason" },
            ]}
            rows={freezeRows}
            sortable
            filterable
            filterPlaceholder="Filter freezes…"
          />
        )}
      </div>
    </>
  );
}
