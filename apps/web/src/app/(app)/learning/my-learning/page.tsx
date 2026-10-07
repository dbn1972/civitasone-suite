import { PageHeader, EmptyState, RefreshErrorState } from "@/app/_components/ds";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { toHumanError } from "@/lib/messages";
import { getMyLearning, getMyProfile, OVERDUE_STALE_DAYS } from "../_data";
import { EnrolmentsTable, type EnrolmentRow } from "./EnrolmentsTable";

type Search = { [k: string]: string | string[] | undefined };

// Mirrors services/hrms-service/src/modules/learning/routes.ts privileged set.
const PRIVILEGED_ROLES = ["hr_admin", "hr_officer", "super_admin", "manager"];

/** True when an enrolled/in-progress course has been stale beyond the window. */
function isOverdue(status: string, updatedAt: string | null | undefined): boolean {
  if (status !== "enrolled" && status !== "in_progress") return false;
  if (!updatedAt) return false;
  const last = new Date(updatedAt).getTime();
  if (Number.isNaN(last)) return false;
  const ageDays = (Date.now() - last) / (24 * 60 * 60 * 1000);
  return ageDays > OVERDUE_STALE_DAYS;
}

export default async function Page({ searchParams }: { searchParams?: Search }) {
  const roles = getSessionRoles();
  const isPrivileged = roles.some((r: string) => PRIVILEGED_ROLES.includes(r));
  const queryEmployeeId = typeof searchParams?.employeeId === "string" ? searchParams.employeeId : "";
  const statusFilter = typeof searchParams?.status === "string" ? searchParams.status : "";

  // GAP-LEARNING-HOME-02: derive the viewer from the session (getMyProfile)
  // for the honest no-record state. The my-learning loader self-scopes a bare
  // employee server-side (MY-LEARNING-01/02), so HR/manager may override via
  // ?employeeId while a bare employee's value is ignored by the server.
  const me = await getMyProfile();
  const myId = me.data?.id ?? null;
  const overrideId = isPrivileged && queryEmployeeId ? queryEmployeeId : undefined;

  // An employee with no linked record AND no privileged override has nothing to
  // show — be honest rather than printing an empty table or a uuid prompt.
  if (!overrideId && !myId) {
    return (
      <>
        <PageHeader title="My Learning" subtitle="Your course enrolments, progress and resume point." back="/learning" />
        <EmptyState icon="👤" title="No employee record linked" message="Your account is not linked to an employee record, so there is no learning progress to show." />
      </>
    );
  }

  const { data: enrolments, source } = await getMyLearning(overrideId ?? myId ?? undefined);
  const filtered = statusFilter
    ? enrolments.filter((e) =>
        statusFilter === "overdue"
          ? isOverdue(e.status, e.updatedAt)
          : e.status === statusFilter,
      )
    : enrolments;

  const rows: EnrolmentRow[] = filtered.map((e) => ({
    id: e.id,
    course: e.courseTitle,
    code: e.courseCode,
    progressPct: e.progressPct,
    statusRaw: e.status,
    courseId: e.courseId,
    resumeLessonId: e.resumeLessonId ?? "",
    overdue: isOverdue(e.status, e.updatedAt),
  }));

  const heading = statusFilter ? `Enrolments — ${statusFilter.replace(/_/g, " ")}` : "Enrolments";

  return (
    <>
      <PageHeader title="My Learning" subtitle="Your course enrolments, progress and resume point." back="/learning" />
      <div className="card">
        <div className="card-h"><h3>{heading}</h3></div>
        {source === "error" ? (
          <RefreshErrorState error={toHumanError("load", { area: "learning enrolments" })} backHref="/learning" />
        ) : rows.length === 0 ? (
          <EmptyState icon="📚" title="No enrolments yet" message="Enrol in a published course from the catalogue to start learning." />
        ) : (
          <EnrolmentsTable rows={rows} />
        )}
      </div>
    </>
  );
}
