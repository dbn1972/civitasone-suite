import { PageHeader, DataTable, EmptyState, RefreshErrorState } from "@/app/_components/ds";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { formatIndianDate } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";
import { getTrainingPrograms, getMyNominations, getMyProfile, currentFinancialYearWindow } from "../_data";

type Search = { [k: string]: string | string[] | undefined };

type Row = {
  id: string; title: string; category: string; trainer: string;
  window: string; venue: string; seats: string; status: string;
};

type NomRow = {
  id: string; programme: string; session: string; when: string; state: string; note: string;
};

// Mirrors services/hrms-service/src/modules/training/routes.ts privileged set.
const PRIVILEGED_ROLES = ["hr_admin", "hr_officer", "super_admin", "manager"];

/** CALENDAR-02: format a start→end window from (possibly ISO) date strings. */
function dateWindow(start?: string, end?: string): string {
  const s = start ? formatIndianDate(start) : "";
  const e = end ? formatIndianDate(end) : "";
  if (s && e) return `${s} → ${e}`;
  return s || e || "—";
}

/** CALENDAR-05: capacity display with a "Full" cue; "Open" when uncapped. */
function seatsDisplay(enrolled?: number, max?: number): string {
  const n = enrolled ?? 0;
  if (max == null) return "Open";
  if (n >= max) return `${n} / ${max} · Full`;
  return `${n} / ${max}`;
}

export default async function Page({ searchParams }: { searchParams?: Search }) {
  const roles = getSessionRoles();
  const isPrivileged = roles.some((r: string) => PRIVILEGED_ROLES.includes(r));
  const queryEmployeeId = typeof searchParams?.employeeId === "string" ? searchParams.employeeId : "";

  // GAP-LEARNING-CALENDAR-01: derive "me" from the session instead of a typed
  // ?employeeId URL. HR/manager keep the override; a bare employee's override
  // is ignored (server self-scopes). The server already returns only the
  // caller's own rows for a non-HR caller, so this is display-correct too.
  const me = await getMyProfile();
  const employeeId = isPrivileged && queryEmployeeId ? queryEmployeeId : (me.data?.id ?? "");
  const noLinkedRecord = !employeeId;
  const viewerName = !queryEmployeeId || !isPrivileged ? me.data?.name ?? null : null;

  const { data: programs, source } = await getTrainingPrograms(currentFinancialYearWindow());

  const rows: Row[] = programs.map((p) => ({
    id: p.id,
    title: p.title,
    category: p.category ?? "general",
    trainer: p.trainerName ?? "—",
    window: dateWindow(p.startDate, p.endDate),
    venue: p.venue ?? "—",
    seats: seatsDisplay(p.enrolledCount, p.maxCapacity),
    status: p.status ?? "planned",
  }));

  const nom = employeeId ? await getMyNominations(employeeId) : null;
  const nomRows: NomRow[] = (nom?.data ?? []).map((n) => ({
    id: n.id,
    programme: n.trainingTitle ?? "—",
    session: n.sessionTitle ?? "—",
    when: n.sessionDate
      ? formatIndianDate(n.sessionDate)
      : dateWindow(n.startDate, n.endDate),
    state: n.approvalState,
    note: n.approvalState === "waitlisted" && n.waitlistPosition != null
      ? `waitlist #${n.waitlistPosition}`
      : n.result ?? "—",
  }));

  return (
    <>
      <PageHeader
        title="Training Calendar"
        // GAP-LEARNING-CALENDAR-03: the subtitle described nominate/approve/
        // waitlist actions that this page does not offer. Reword to describe
        // what the page actually shows: the schedule and your nomination status.
        subtitle="Scheduled training programmes and your own nomination status."
        back="/learning"
      />

      <div className="card">
        <div className="card-h"><h3>{viewerName ? `My Nominations — ${viewerName}` : "My Nominations"}</h3></div>
        {noLinkedRecord ? (
          <EmptyState
            icon="👤"
            title="No employee record linked"
            message="Your account is not linked to an employee record, so there are no nominations to show."
          />
        ) : nom?.source === "error" ? (
          // GAP-LEARNING-CALENDAR-04: a retry control matching the programmes
          // card, instead of a static badge + EmptyState with no retry.
          <RefreshErrorState error={toHumanError("load", { area: "nominations" })} backHref="/learning" />
        ) : nomRows.length === 0 ? (
          <EmptyState icon="📋" title="No nominations yet" message="You have not been nominated to any training programme." />
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
        {source === "error" ? (
          <RefreshErrorState error={toHumanError("load", { area: "training programmes" })} backHref="/learning" />
        ) : rows.length === 0 ? (
          <EmptyState icon="📅" title="No training programmes scheduled" message="Scheduled training programmes will appear here." />
        ) : (
          <DataTable<Row>
            columns={[
              { key: "title", label: "Programme" },
              { key: "category", label: "Category" },
              { key: "trainer", label: "Facilitator" },
              { key: "window", label: "Dates" },
              { key: "venue", label: "Venue" },
              { key: "seats", label: "Nominations / Capacity", align: "right" },
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
