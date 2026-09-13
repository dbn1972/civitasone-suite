import { notFound } from "next/navigation";
import { PageHeader, EmptyState } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { fetchJson } from "@/app/_data/apiClient";
import { JoineeWelcomeHeader } from "../_components/JoineeWelcomeHeader";
import { OnboardingChecklist, type ChecklistStep } from "../_components/OnboardingChecklist";
import { DocumentUploadCard, type OnboardingDocument, type DocStatus } from "../_components/DocumentUploadCard";
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

// Matches GET /v1/hrms/employees/:id/onboarding-documents (hrms-service
// modules/lifecycle/onboarding-routes.ts's mergeOnboardingDocuments()): this
// employee's own real document checklist -- required doc types for their
// tenant/employeeType, merged with what THEY have actually submitted/had
// verified. Previously this page ignored the backend entirely and rendered
// DEFAULT_DOCUMENTS, a fixed 6-item array with every status hardcoded
// "pending", for every employee (COMP-015) -- there was no fetch, no
// per-employee state, and no way for a document to ever show as
// received/verified for anyone.
type DocumentApiRow = {
  docType: string;
  required: boolean;
  status: DocStatus;
  receivedAt: string | null;
  verifiedBy: string | null;
  verifiedAt: string | null;
};

// Presentation-only copy for known document-type codes the backend returns.
// This is display metadata, not employee state: the actual required-ness and
// status for THIS employee always come from the API response, never from
// here. An unrecognised code (e.g. a tenant-defined type this map doesn't
// know about) still renders with a humanized label instead of being dropped.
const docTypeDisplay: Record<string, { name: string; description: string }> = {
  appointment_letter: { name: "Appointment Letter", description: "Signed copy of the appointment / offer letter." },
  government_id: { name: "Government ID Proof", description: "Aadhaar card, Voter ID, or Passport (self-attested)." },
  address_proof: { name: "Address Proof", description: "Aadhaar, utility bill, or bank statement (not older than 3 months)." },
  education_certificate: { name: "Education Certificate", description: "Highest qualification marksheet and degree certificate." },
  pan_card: { name: "PAN Card", description: "Permanent Account Number card copy for payroll." },
  bank_details: { name: "Bank Account Details", description: "Cancelled cheque or passbook copy (Name + IFSC + Account No)." },
};

function humanizeDocType(docType: string): string {
  if (typeof docType !== "string" || docType.length === 0) return "Document";
  return docType.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

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
  // Real per-employee document checklist -- same rationale as the tasks
  // fetch above (`id` is the employee id). Replaces the DEFAULT_DOCUMENTS
  // placeholder that used to show the same 6 documents, always "pending",
  // for every employee regardless of what HR had actually collected or
  // verified (COMP-015).
  const { data: documentRows, source: documentsSource } = await fetchJson<unknown, DocumentApiRow[]>(
    `/api/v1/hrms/employees/${id}/onboarding-documents`,
    [],
    {
      telemetryKey: "hr.onboarding.detail.documents",
      mapResponse: (p) => {
        const arr = Array.isArray(p) ? p : (p as { data?: DocumentApiRow[] })?.data;
        return Array.isArray(arr) ? arr : null;
      },
    },
  );

  const source =
    summarySource === "error" || tasksSource === "error" || documentsSource === "error" ? "error" : "api";

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

  const documents: OnboardingDocument[] = documentRows
    .filter((d) => typeof d.docType === "string" && d.docType.length > 0)
    .map((d) => ({
      id: d.docType,
      name: docTypeDisplay[d.docType]?.name ?? humanizeDocType(d.docType),
      description: docTypeDisplay[d.docType]?.description,
      required: d.required,
      status: d.status,
      category: "document",
    }));

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
