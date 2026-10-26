import Link from "next/link";
import { Card, DataTable, PageHeader, StatCard, StatGrid, RefreshErrorState } from "../../../_components/ds";
import { formatIndianDateTime } from "@/lib/formatters";
import { getSessionRoles, hasAnyRole, FIELD_VISIT_LOCATION_ROLES } from "@/lib/auth/roleGuard";
import { resolveUsers, userDisplayLabel } from "@/lib/directory/resolveUsers";
import { getFieldVisitsDetailed, getFieldTasksDetailed, parseVisitDay, FIELD_VISITS_LIMIT } from "../_data";
import { formatCoord, outcomeLabel, openVisitHours, rankVisits, visitStatus, visitDisplayStatus } from "./visits";

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  status: string;
  agent: string;
  task: string;
  checkIn: string;
  gps: string;
  duration: string;
  outcome: string;
  notes: string;
};

type SearchParams = { offset?: string; from?: string; to?: string };

function visitsHref(offset: number, from?: string, to?: string): string {
  const params = new URLSearchParams();
  if (offset > 0) params.set("offset", String(offset));
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const qs = params.toString();
  return qs ? `/field/visits?${qs}` : "/field/visits";
}

export default async function FieldVisitsPage(props: { searchParams?: Promise<SearchParams> } = {}) {
  // GAP-FIELD-VISITS-04: paging + inclusive IST date range come from the URL;
  // malformed values are dropped, never forwarded to the server.
  const sp = (await props.searchParams) ?? {};
  const requestedOffset = Number(sp.offset ?? 0);
  const offset = Number.isFinite(requestedOffset) && requestedOffset > 0 ? Math.floor(requestedOffset) : 0;
  const from = parseVisitDay(sp.from);
  const to = parseVisitDay(sp.to);
  const { data, source } = await getFieldVisitsDetailed({ offset, from, to });
  const { rows: visits, total, limit } = data;
  const filtered = Boolean(from || to);

  // GAP-FIELD-VISITS-01 (FAILMASK): a failed load used to render real "0"
  // stats and the "No visits yet" empty state, indistinguishable from a tenant
  // that genuinely has no visits. Show an honest error state with a retry.
  if (source === "error") {
    return (
      <>
        <PageHeader
          title="Field Visits"
          subtitle="GPS check-ins, outcomes and notes from the field force."
          back="/field"
          backLabel="Field Operations"
        />
        <Card title="Recent visits">
          <RefreshErrorState
            error={{
              what: "Could not load field visits",
              next: "Check your connection and try again.",
              actions: ["retry", "back"],
            }}
            source={{ area: "field visits" }}
            backHref="/field"
          />
        </Card>
      </>
    );
  }

  // GAP-FIELD-VISITS-03 (PII/DPDP): only supervisory roles see precise(ish)
  // coordinates and may export; a plain field_agent sees the list without the
  // GPS column or the CSV button. Coordinates are rounded for everyone
  // (COORD_DISPLAY_PRECISION). The server remains the authority on who may read
  // the endpoint at all; this governs what the UI reveals.
  const canSeeLocation = hasAnyRole(getSessionRoles(), FIELD_VISIT_LOCATION_ROLES);

  const ranked = rankVisits(visits);
  const open = visits.filter((v) => visitStatus(v) === "open").length;
  const capped = total > visits.length && offset === 0;
  const first = visits.length === 0 ? 0 : offset + 1;
  const last = offset + visits.length;
  const hasOlder = last < total;

  // GAP-FIELD-VISITS-03: show who/what, not UUIDs. Names come from the shared
  // tenant-scoped directory and the task list; an unresolved id degrades to a
  // short id, never a guessed name.
  const [names, tasks] = await Promise.all([
    resolveUsers(visits.map((v) => v.agentId)),
    getFieldTasksDetailed(),
  ]);
  const taskTitles = new Map((tasks.data ?? []).map((t) => [t.id, t.title]));

  const rows: Row[] = ranked.map((v) => ({
    id: v.id,
    status: visitDisplayStatus(v),
    agent: userDisplayLabel(names, v.agentId),
    task: taskTitles.get(v.taskId) ?? `${v.taskId.slice(0, 8)}…`,
    checkIn: v.checkInAt ? formatIndianDateTime(v.checkInAt) : "—",
    gps: formatCoord(v.checkInLatitude, v.checkInLongitude),
    duration: v.durationMinutes != null ? `${v.durationMinutes} min` : (() => { const h = openVisitHours(v); return h != null && h > 0 ? `open ${h}h` : h === 0 ? "open <1h" : "—"; })(),
    outcome: outcomeLabel(v.outcome),
    notes: v.notes?.trim() ? v.notes : "—",
  }));

  const columns = [
    { key: "status" as const, label: "Status", cellType: "status" as const },
    { key: "agent" as const, label: "Agent" },
    { key: "task" as const, label: "Task" },
    { key: "checkIn" as const, label: "Check-in" },
    ...(canSeeLocation ? [{ key: "gps" as const, label: "GPS" }] : []),
    { key: "duration" as const, label: "Duration", align: "right" as const },
    { key: "outcome" as const, label: "Outcome" },
    { key: "notes" as const, label: "Notes" },
  ];

  return (
    <>
      <PageHeader
        title="Field Visits"
        subtitle="GPS check-ins, outcomes and notes from the field force."
        back="/field"
        backLabel="Field Operations"
      />
      {/* GAP-FIELD-VISITS-03: short purpose note for location data. */}
      <p className="muted" style={{ fontSize: 13 }}>
        Visit locations are personal data. They are shown rounded and {canSeeLocation ? "may be exported by supervisors for" : "are limited to"}{" "}
        field-operations purposes only.
      </p>
      <form method="get" action="/field/visits" style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end", margin: "12px 0" }}>
        <div className="field">
          <label className="label" htmlFor="visits-from">From</label>
          <input id="visits-from" className="inp" type="date" name="from" defaultValue={from ?? ""} />
        </div>
        <div className="field">
          <label className="label" htmlFor="visits-to">To</label>
          <input id="visits-to" className="inp" type="date" name="to" defaultValue={to ?? ""} />
        </div>
        <button type="submit" className="btn">Filter</button>
        {filtered && <Link href="/field/visits">Clear dates</Link>}
      </form>
      <StatGrid>
        <StatCard
          icon="📍"
          tone="info"
          label={capped ? `Visits (latest ${limit})` : filtered ? "Visits in range" : "Visits"}
          value={(total > visits.length ? total : visits.length).toLocaleString("en-IN")}
        />
        <StatCard icon="🚶" tone="warn" label={capped ? `Open (in latest ${limit})` : "Open"} value={open.toLocaleString("en-IN")} />
      </StatGrid>
      <div role="note" data-testid="field-visits-window" style={{ fontSize: 13, color: "var(--mut)", margin: "8px 0" }}>
        Showing visits {first}–{last} of {total.toLocaleString("en-IN")}, newest first.
        {offset > 0 && (
          <>
            {" "}
            <Link href={visitsHref(Math.max(0, offset - FIELD_VISITS_LIMIT), from, to)}>Show newer visits</Link>.
          </>
        )}
        {hasOlder && (
          <>
            {" "}
            <Link href={visitsHref(offset + FIELD_VISITS_LIMIT, from, to)}>Show older visits</Link>.
          </>
        )}
      </div>
      <Card title="Recent visits">
        <DataTable<Row>
          columns={columns}
          rows={rows}
          sortable
          exportable={canSeeLocation} exportAudit="field/visits"
          exportFilename="field-visits"
          emptyIcon="📍"
          emptyTitle={filtered ? "No visits in this date range" : "No visits yet"}
          emptyMessage={
            filtered
              ? "Try a wider date range, or clear the dates to see all visits."
              : "Check in on a field task to record GPS and outcomes here."
          }
        />
      </Card>
    </>
  );
}
