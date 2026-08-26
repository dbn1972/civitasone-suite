import { notFound } from "next/navigation";
import { PageHeader, EmptyState } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { fetchJson } from "@/app/_data/apiClient";
import { JoineeWelcomeHeader } from "../_components/JoineeWelcomeHeader";
import { OnboardingChecklist, type ChecklistStep } from "../_components/OnboardingChecklist";
import { DocumentUploadCard, type OnboardingDocument } from "../_components/DocumentUploadCard";
import { TaskCalendar, type CalendarTask } from "../_components/TaskCalendar";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// Matches the real shape of GET /v1/hrms/onboarding (hrms-service
// modules/lifecycle/onboarding-routes.ts) — it returns exactly these fields.
// There is no checklist/documents/tasks/reportingManager/officeLocation in
// the response; a previous version of this page invented those and always
// rendered fabricated placeholder progress for every joinee (see PR notes).
type ApiRow = {
  id: string;
  employee: string;
  department: string;
  joiningDate: string;
  stepsCompleted: string | number;
  totalSteps: string | number;
  progress: string | number;
  status: string;
};

// Matches GET /v1/hrms/employees/:id/onboarding-tasks (hrms_onboarding_tasks
// table: id, employeeId, title, dueByDay, status, completedAt, ...).
type OnboardingTaskRow = {
  id: string;
  title: string;
  dueByDay: number;
  status: string; // only ever "pending" or "completed" — the backend never writes "in_progress"/"overdue"
};

const CALENDAR_MILESTONES = [1, 3, 7, 30] as const;

function nearestMilestone(day: number): (typeof CALENDAR_MILESTONES)[number] {
  return CALENDAR_MILESTONES.reduce((best, m) => (Math.abs(m - day) < Math.abs(best - day) ? m : best));
}

/** A "pending" task becomes "overdue" once its due date (joining date + dueByDay) has passed. */
function deriveStatus(task: OnboardingTaskRow, joiningDate: string): ChecklistStep["status"] {
  if (task.status === "completed") return "completed";
  const join = new Date(`${joiningDate}T00:00:00Z`);
  if (Number.isNaN(join.getTime())) return "pending";
  const due = new Date(join);
  due.setUTCDate(due.getUTCDate() + task.dueByDay);
  return due.toISOString().slice(0, 10) < new Date().toISOString().slice(0, 10) ? "overdue" : "pending";
}

// Standard KYC checklist we ask HR to collect. There is no backend record of
// per-document collection status yet (no onboarding-document routes exist),
// so every item starts "pending" rather than inventing which ones are
// already "verified"/"uploaded" for a given joinee.
const DEFAULT_DOCUMENTS: OnboardingDocument[] = [
  { id: "doc-appt", name: "Appointment Letter", description: "Signed copy of the appointment / offer letter.", required: true, status: "pending", category: "document" },
  { id: "doc-id", name: "Government ID Proof", description: "Aadhaar card, Voter ID, or Passport (self-attested).", required: true, status: "pending", category: "document" },
  { id: "doc-address", name: "Address Proof", description: "Aadhaar, utility bill, or bank statement (not older than 3 months).", required: true, status: "pending", category: "document" },
  { id: "doc-education", name: "Education Certificate", description: "Highest qualification marksheet and degree certificate.", required: true, status: "pending", category: "document" },
  { id: "doc-pan", name: "PAN Card", description: "Permanent Account Number card copy for payroll.", required: true, status: "pending", category: "document" },
  { id: "doc-bank", name: "Bank Account Details", description: "Cancelled cheque or passbook copy (Name + IFSC + Account No).", required: true, status: "pending", category: "document" },
];

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

interface Props {
  params: Promise<{ id: string }>;
}

export default async function OnboardingDetailPage({ params }: Props) {
  const { id } = await params;

  const { data: rows, source: summarySource } = await fetchJson<unknown, ApiRow[]>(
    "/api/v1/hrms/onboarding",
    [],
    {
      telemetryKey: "hr.onboarding.detail",
      mapResponse: (p) => {
        const arr = Array.isArray(p) ? p : (p as { data?: ApiRow[] })?.data;
        return Array.isArray(arr) ? arr : null;
      },
    },
  );

  const row = rows.find((r) => r.id === id);
  if (!row) notFound();

  // Real per-employee tasks — the only genuine source for checklist/calendar
  // content. `id` here IS the employee id (the summary route keys rows by
  // employeeId, confirmed against hrms-service onboarding-routes.ts).
  const { data: taskRows, source: tasksSource } = await fetchJson<unknown, OnboardingTaskRow[]>(
    `/api/v1/hrms/employees/${id}/onboarding-tasks`,
    [],
    {
      telemetryKey: "hr.onboarding.detail.tasks",
      mapResponse: (p) => {
        const arr = Array.isArray(p) ? p : (p as { data?: OnboardingTaskRow[] })?.data;
        return Array.isArray(arr) ? arr : null;
      },
    },
  );
  const source = summarySource === "error" || tasksSource === "error" ? "error" : "api";

  const pct = Math.min(100, Math.max(0, Number(String(row.progress).replace("%", ""))));

  const checklist: ChecklistStep[] = taskRows.map((t) => ({
    id: t.id,
    label: t.title,
    status: deriveStatus(t, row.joiningDate),
    dueDay: t.dueByDay,
  }));

  const tasks: CalendarTask[] = taskRows.map((t) => ({
    id: t.id,
    title: t.title,
    milestoneDay: nearestMilestone(t.dueByDay),
    status: deriveStatus(t, row.joiningDate),
  }));

  const documents: OnboardingDocument[] = DEFAULT_DOCUMENTS;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={`Onboarding — ${row.employee}`}
        subtitle={`${row.department} · Joining ${row.joiningDate}`}
        back="/hr/onboarding"
        backLabel="Onboarding Tracker"
      />
      <DataSourceBadge source={source} />

      {/* Welcome banner */}
      <JoineeWelcomeHeader
        name={row.employee}
        startDate={row.joiningDate}
        department={row.department}
        reportingManager="Not yet assigned"
        officeLocation="Not specified"
        overallProgress={pct}
      />

      {/* Two-column: checklist | task calendar */}
      {checklist.length === 0 ? (
        <div
          style={{
            border: "1px solid var(--border, #e2e8f0)",
            borderRadius: 12,
            padding: 20,
            background: "var(--card-bg, #fff)",
            marginBottom: 24,
          }}
        >
          <EmptyState
            icon="🗒️"
            title="No onboarding tasks set up yet"
            message="HR hasn't added any onboarding tasks for this joinee. Once tasks are added, their checklist and due-date calendar will appear here."
          />
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 20,
            marginBottom: 24,
          }}
          className="onboarding-grid"
        >
          {/* Checklist */}
          <div
            style={{
              border: "1px solid var(--border, #e2e8f0)",
              borderRadius: 12,
              padding: 20,
              background: "var(--card-bg, #fff)",
            }}
          >
            <OnboardingChecklist steps={checklist} />
          </div>

          {/* Task calendar */}
          <div
            style={{
              border: "1px solid var(--border, #e2e8f0)",
              borderRadius: 12,
              padding: 20,
              background: "var(--card-bg, #fff)",
            }}
          >
            <TaskCalendar tasks={tasks} joiningDate={row.joiningDate} />
          </div>
        </div>
      )}

      {/* Document upload section */}
      <div
        style={{
          border: "1px solid var(--border, #e2e8f0)",
          borderRadius: 12,
          padding: 20,
          background: "var(--card-bg, #fff)",
        }}
      >
        <DocumentUploadCard documents={documents} />
      </div>

      {/* Responsive stacking */}
      <style>{`
        @media (max-width: 720px) {
          .onboarding-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </main>
  );
}
