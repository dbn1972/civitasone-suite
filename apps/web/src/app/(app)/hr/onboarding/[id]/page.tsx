import { notFound } from "next/navigation";
import { PageHeader, EmptyState, RefreshErrorState, Card } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { getEmployeeById } from "@/app/_data/loaders";
import { fetchJson } from "@/app/_data/apiClient";
import { toHumanError } from "@/lib/messages";
import { formatIndianDate } from "@/lib/formatters";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { PermissionDenied } from "../../../../_components/PermissionDenied";
import { JoineeWelcomeHeader } from "../_components/JoineeWelcomeHeader";
import { type ChecklistStep } from "../_components/OnboardingChecklist";
import { ChecklistWithActions } from "../_components/ChecklistWithActions";
import { AddTaskForm } from "../_components/AddTaskForm";
import { DocumentUploadCard, type OnboardingDocument, type DocStatus } from "../_components/DocumentUploadCard";
import { TaskCalendar, type CalendarTask } from "../_components/TaskCalendar";
import { getTranslations } from "next-intl/server";

const ONBOARDING_ROLES = ["hr_admin", "hr_officer", "super_admin"];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// Matches GET /v1/hrms/employees/:id/onboarding-tasks (hrms_onboarding_tasks
// table: id, employeeId, title, dueByDay, status, completedAt, ...).
type OnboardingTaskRow = {
  id: string;
  title: string;
  dueByDay: number;
  status: string; // only ever "pending" or "completed" — the backend never writes "in_progress"/"overdue"
};

/** A "pending" task becomes "overdue" once its due date (joining date + dueByDay) has passed. */
function deriveStatus(task: OnboardingTaskRow, joiningDate: string | null | undefined): ChecklistStep["status"] {
  if (task.status === "completed") return "completed";
  if (!joiningDate) return "pending";
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
// verified.
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
  if (typeof docType !== "string" || docType.length === 0) return "Document"; // ux-001-ok: type/format guard for display text, not a loader empty-check
  return docType.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

interface Props {
  // GAP-HR-ONBOARDING-DETAIL-07: plain params object, matching every sibling
  // HR detail page's Next 14 convention (e.g. disciplinary/[id]/page.tsx) --
  // Promise<{id}> is a Next 15 convention; awaiting a non-Promise value is
  // legal JS and happened to work, but was needlessly inconsistent here.
  params: { id: string };
}

export default async function OnboardingDetailPage({ params }: Props) {
  const t = await getTranslations("onboardingDetail");
  const { id } = params;

  // Explicit role gate, independent of whichever backend endpoint we
  // happen to call below -- keeps this page's access boundary (HR only)
  // stable regardless of what role set GET /v1/hrms/employees/:id itself
  // enforces for other callers (e.g. it may also serve "manager").
  const roles = getSessionRoles();
  if (!roles.some((r) => ONBOARDING_ROLES.includes(r))) {
    return (
      <div className="page-main wrap">
        <PageHeader title={t("title")} back="/hr/onboarding" backLabel="Back to Onboarding" />
        <PermissionDenied module="onboarding details" requiredRoles={ONBOARDING_ROLES} />
      </div>
    );
  }

  // GAP-HR-ONBOARDING-DETAIL-05: fetch this one employee directly instead of
  // fetching the entire tenant-wide /onboarding summary (up to 2000 task
  // rows) just to .find() this id in it. The old approach 404'd for any
  // joinee with zero tasks (absent from a tasks-driven summary) and, more
  // seriously, ALSO 404'd on a genuine fetch failure (source:"error" ->
  // rows:[] -> also "not found") -- conflating "doesn't exist" with
  // "couldn't load".
  const { data: employee, source: employeeSource, status: employeeStatus } = await getEmployeeById(id);

  if (employeeSource === "error") {
    if (employeeStatus === 404) notFound();
    return (
      <div className="page-main wrap">
        <PageHeader title={t("title")} back="/hr/onboarding" backLabel="Back to Onboarding" />
        <Card style={{ padding: 20 }}>
          <RefreshErrorState error={toHumanError("load", { area: "onboarding details" })} />
        </Card>
      </div>
    );
  }
  // employeeSource === "api" guarantees a non-null mapped value: fetchJson
  // treats a mapResponse() result of null as source:"error" itself (see
  // apiClient.ts), never as a successful null -- safe to assert.
  const emp = employee!;

  const [{ data: taskRows, source: tasksSource }, { data: documentRows, source: documentsSource }] = await Promise.all([
    // Real per-employee tasks — the only genuine source for checklist/calendar content.
    fetchJson<unknown, OnboardingTaskRow[]>(`/api/v1/hrms/employees/${id}/onboarding-tasks`, [], {
      telemetryKey: "hr.onboarding.detail.tasks",
      mapResponse: (p) => {
        const arr = Array.isArray(p) ? p : (p as { data?: OnboardingTaskRow[] })?.data;
        return Array.isArray(arr) ? arr : null;
      },
    }),
    // Real per-employee document checklist (COMP-015).
    fetchJson<unknown, DocumentApiRow[]>(`/api/v1/hrms/employees/${id}/onboarding-documents`, [], {
      telemetryKey: "hr.onboarding.detail.documents",
      mapResponse: (p) => {
        const arr = Array.isArray(p) ? p : (p as { data?: DocumentApiRow[] })?.data;
        return Array.isArray(arr) ? arr : null;
      },
    }),
  ]);

  const source = tasksSource === "error" || documentsSource === "error" ? "error" : "api";

  const totalTasks = taskRows.length;
  const completedTasks = taskRows.filter((row) => row.status === "completed").length;
  const pct = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  const checklist: ChecklistStep[] = taskRows.map((row) => ({
    id: row.id,
    label: row.title,
    status: deriveStatus(row, emp.joiningDate),
    dueDay: row.dueByDay,
  }));

  const calendarTasks: CalendarTask[] = taskRows.map((row) => ({
    id: row.id,
    title: row.title,
    dueByDay: row.dueByDay,
    status: deriveStatus(row, emp.joiningDate),
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
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={`Onboarding — ${emp.name}`}
        subtitle={`${emp.department} · Joining ${formatIndianDate(emp.joiningDate)}`}
        back="/hr/onboarding"
        backLabel="Onboarding Tracker"
      />
      <DataSourceBadge source={source} />

      {/* Welcome banner */}
      <JoineeWelcomeHeader
        name={emp.name}
        startDate={emp.joiningDate}
        department={emp.department}
        // GAP-HR-ONBOARDING-DETAIL-04: real manager/location when the API has
        // them (GET /v1/hrms/employees/:id already resolves reportingTo/
        // postingLocation); the previous literals were honest placeholders
        // for the "not on file" case, not fabricated data, but were shown
        // unconditionally even when a manager/location genuinely existed.
        reportingManager={emp.reportingTo ?? "Not yet assigned"}
        officeLocation={emp.postingLocation ?? "Not specified"}
        overallProgress={pct}
      />

      {/* Two-column: checklist | task calendar */}
      {source === "error" ? (
        <Card style={{ padding: 20, marginBottom: 24 }}>
          <RefreshErrorState error={toHumanError("load", { area: "onboarding checklist" })} />
        </Card>
      ) : checklist.length === 0 ? (
        <Card style={{ padding: 20, marginBottom: 24 }}>
          <EmptyState
            icon="🗒️"
            title={t("emptyTasksTitle")}
            message={t("emptyTasksMessage")}
          />
          {/* GAP-HR-ONBOARDING-02: a joinee with zero tasks used to be
              unreachable at all (404, fixed by DETAIL-05 above) -- now that
              this page can open for them, HR needs a way to actually start
              onboarding instead of a dead end. */}
          <AddTaskForm employeeId={id} />
        </Card>
      ) : (
        // GAP-HR-ONBOARDING-DETAIL-07: Tailwind responsive utilities instead
        // of a bespoke inline style + a raw <style> tag for one media query.
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-6">
          <Card style={{ padding: 20 }}>
            <ChecklistWithActions steps={checklist} />
          </Card>
          <Card style={{ padding: 20 }}>
            <TaskCalendar tasks={calendarTasks} joiningDate={emp.joiningDate} />
          </Card>
        </div>
      )}

      {/* Document upload section */}
      <Card style={{ padding: 20 }}>
        <DocumentUploadCard documents={documents} />
      </Card>
    </div>
  );
}
