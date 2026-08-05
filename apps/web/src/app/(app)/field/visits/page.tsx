import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { Card, DataTable, PageHeader, StatCard, StatGrid } from "../../../_components/ds";
import { formatIndianDate } from "@/lib/formatters";
import { getFieldVisitsDetailed } from "../_data";
import { formatCoord, outcomeLabel, rankVisits, visitStatus } from "./visits";

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  status: string;
  checkIn: string;
  gps: string;
  duration: string;
  outcome: string;
  notes: string;
};

export default async function FieldVisitsPage() {
  const { data, source } = await getFieldVisitsDetailed();
  const ranked = rankVisits(data);
  const open = data.filter((v) => visitStatus(v) === "open").length;

  const rows: Row[] = ranked.map((v) => ({
    id: v.id,
    status: visitStatus(v),
    checkIn: v.checkInAt ? formatIndianDate(v.checkInAt) : "—",
    gps: formatCoord(v.checkInLatitude, v.checkInLongitude),
    duration: v.durationMinutes === null || v.durationMinutes === undefined ? "—" : `${v.durationMinutes} min`,
    outcome: outcomeLabel(v.outcome),
    notes: v.notes?.trim() ? v.notes : "—",
  }));

  return (
    <>
      <PageHeader
        title="Field Visits"
        subtitle="GPS check-ins, outcomes and notes from the field force."
        back="/field"
        backLabel="Field Operations"
      />
      {source === "error" && <DataSourceBadge source={source} />}
      <StatGrid>
        <StatCard icon="📍" iconBg="#e0f2fe" label="Visits" value={data.length.toLocaleString("en-IN")} />
        <StatCard icon="🚶" iconBg="#fef3c7" label="Open" value={open.toLocaleString("en-IN")} />
      </StatGrid>
      <Card title="Recent visits">
        <DataTable<Row>
          columns={[
            { key: "status", label: "Status", cellType: "status" },
            { key: "checkIn", label: "Check-in" },
            { key: "gps", label: "GPS" },
            { key: "duration", label: "Duration", align: "right" },
            { key: "outcome", label: "Outcome" },
            { key: "notes", label: "Notes" },
          ]}
          rows={rows}
          sortable
          exportable
          exportFilename="field-visits"
          emptyIcon="📍"
          emptyTitle="No visits yet"
          emptyMessage="Check in on a field task to record GPS and outcomes here."
        />
      </Card>
    </>
  );
}
