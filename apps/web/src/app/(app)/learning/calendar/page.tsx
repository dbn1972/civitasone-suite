import { PageHeader, DataTable, EmptyState } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { getTrainingPrograms, getMyNominations } from "../_data";

type Search = { [k: string]: string | string[] | undefined };

type Row = {
  id: string; title: string; category: string; trainer: string;
  window: string; venue: string; seats: string; status: string;
};

type NomRow = {
  id: string; programme: string; session: string; when: string; state: string; note: string;
};

export default async function Page({ searchParams }: { searchParams?: Search }) {
  const employeeId = typeof searchParams?.employeeId === "string" ? searchParams.employeeId : "";

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

  // SVC-121/122 — live "My Nominations": per-employee nominations with their
  // approval state (approved / pending / waitlisted / rejected) and linked
  // training/session, read from GET /v1/hrms/nominations?employeeId=…
  const nom = employeeId ? await getMyNominations(employeeId) : null;
  const nomRows: NomRow[] = (nom?.data ?? []).map((n) => ({
    id: n.id,
    programme: n.trainingTitle ?? "—",
    session: n.sessionTitle ?? "—",
    when: n.sessionDate ?? ([n.startDate, n.endDate].filter(Boolean).join(" → ") || "—"),
    state: n.approvalState,
    note: n.approvalState === "waitlisted" && n.waitlistPosition != null
      ? `waitlist #${n.waitlistPosition}`
      : n.result ?? "—",
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
        <div className="card-h"><h3>My Nominations</h3></div>
        {!employeeId ? (
          <EmptyState
            icon="🔎"
            title="Select an employee"
            message="Append ?employeeId=<uuid> to view an employee's nominations and their approval state."
          />
        ) : nom?.source === "error" ? (
          <>
            <DataSourceBadge source={nom.source} />
            <EmptyState icon="⚠️" title="Could not load nominations" message="The nominations service is unavailable. Try again shortly." />
          </>
        ) : nomRows.length === 0 ? (
          <EmptyState icon="📋" title="No nominations yet" message="This employee has not been nominated to any training programme." />
        ) : (
          <DataTable<NomRow>
            columns={[
              { key: "programme", label: "Programme" },
              { key: "session", label: "Session" },
              { key: "when", label: "When" },
              { key: "state", label: "Approval state", cellType: "status" },
              { key: "note", label: "Note" },
            ]}
            rows={nomRows}
            sortable
            pageSize={15}
          />
        )}
      </div>

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
