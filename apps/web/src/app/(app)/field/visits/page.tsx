import { Card, DataTable, PageHeader, StatCard, StatGrid, RefreshErrorState } from "../../../_components/ds";
import { formatIndianDateTime } from "@/lib/formatters";
import { getSessionRoles, hasAnyRole, FIELD_VISIT_LOCATION_ROLES } from "@/lib/auth/roleGuard";
import { getFieldVisitsDetailed } from "../_data";
import { formatCoord, outcomeLabel, rankVisits, visitStatus, visitDisplayStatus } from "./visits";

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

export default async function FieldVisitsPage() {
  const { data, source } = await getFieldVisitsDetailed();
  const { rows: visits, total, limit } = data;

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
  const capped = total > visits.length;

  const rows: Row[] = ranked.map((v) => ({
    id: v.id,
    status: visitDisplayStatus(v),
    agent: v.agentId,
    task: v.taskId,
    checkIn: v.checkInAt ? formatIndianDateTime(v.checkInAt) : "—",
    gps: formatCoord(v.checkInLatitude, v.checkInLongitude),
    duration: v.durationMinutes === null || v.durationMinutes === undefined ? "—" : `${v.durationMinutes} min`,
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
      <StatGrid>
        <StatCard
          icon="📍"
          iconBg="#e0f2fe"
          label={capped ? `Visits (latest ${limit})` : "Visits"}
          value={(capped ? total : visits.length).toLocaleString("en-IN")}
        />
        <StatCard icon="🚶" iconBg="#fef3c7" label={capped ? `Open (in latest ${limit})` : "Open"} value={open.toLocaleString("en-IN")} />
      </StatGrid>
      <Card title="Recent visits">
        <DataTable<Row>
          columns={columns}
          rows={rows}
          sortable
          exportable={canSeeLocation}
          exportFilename="field-visits"
          emptyIcon="📍"
          emptyTitle="No visits yet"
          emptyMessage="Check in on a field task to record GPS and outcomes here."
        />
      </Card>
    </>
  );
}
