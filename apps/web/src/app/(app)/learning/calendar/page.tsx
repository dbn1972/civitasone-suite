import { PageHeader, DataTable, EmptyState } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { getTrainingPrograms } from "../_data";

type Row = {
  id: string; title: string; category: string; trainer: string;
  window: string; venue: string; seats: string; status: string;
};

export default async function Page() {
  const { data: programs, source } = await getTrainingPrograms();

  const rows: Row[] = programs.map((p) => ({
    id: p.id,
    title: p.title,
    category: p.category ?? "general",
    trainer: p.trainerName ?? "—",
    window: [p.startDate, p.endDate].filter(Boolean).join(" → ") || "—",
    venue: p.venue ?? "—",
    seats: `${p.enrolledCount ?? 0} / ${p.maxCapacity ?? "—"}`,
    status: p.status ?? "planned",
  }));

  return (
    <>
      <PageHeader
        title="Training Calendar"
        subtitle="Scheduled programmes and sessions. Nominations follow a maker-checker approval (approver ≠ nominator); once a session's capacity is full, further approvals are waitlisted."
        back="/learning"
      />
      {source === "error" && <DataSourceBadge source={source} />}
      <div className="card">
        <div className="card-h"><h3>Programmes</h3></div>
        {rows.length === 0 ? (
          <EmptyState icon="📅" title="No training programmes scheduled" message="Scheduled training programmes will appear here." />
        ) : (
          <DataTable<Row>
            columns={[
              { key: "title", label: "Programme" },
              { key: "category", label: "Category" },
              { key: "trainer", label: "Facilitator" },
              { key: "window", label: "Dates" },
              { key: "venue", label: "Venue" },
              { key: "seats", label: "Enrolled / Capacity", align: "right" },
              { key: "status", label: "Status", cellType: "status" },
            ]}
            rows={rows}
            sortable
            filterable
            filterPlaceholder="Filter programmes…"
            pageSize={15}
          />
        )}
      </div>
    </>
  );
}
