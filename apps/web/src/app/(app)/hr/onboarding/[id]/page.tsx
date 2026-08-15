import { notFound } from "next/navigation";
import { PageHeader } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { fetchJson } from "@/app/_data/apiClient";
import { JoineeWelcomeHeader } from "../_components/JoineeWelcomeHeader";
import { OnboardingChecklist, type ChecklistStep } from "../_components/OnboardingChecklist";
import { DocumentUploadCard, type OnboardingDocument } from "../_components/DocumentUploadCard";
import { TaskCalendar, type CalendarTask } from "../_components/TaskCalendar";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ApiRow = {
  id: string;
  employee: string;
  employeeName?: string;
  department: string;
  joiningDate: string;
  reportingManager?: string;
  officeLocation?: string;
  stepsCompleted: number;
  totalSteps: number;
  overdue: number;
  progress: string | number;
  status: string;
  checklist?: ChecklistStep[];
  documents?: OnboardingDocument[];
  tasks?: CalendarTask[];
} & Record<string, unknown>;

// ---------------------------------------------------------------------------
// Default fallback data (used when API returns a minimal Row)
// ---------------------------------------------------------------------------

const DEFAULT_CHECKLIST: ChecklistStep[] = [
  { id: "docs", label: "Documents Submitted", description: "All required KYC and joining documents uploaded.", status: "completed", dueDay: 1 },
  { id: "id-card", label: "ID Card Issued", description: "Employee photo ID card printed and issued by admin.", status: "in_progress", dueDay: 3 },
  { id: "workstation", label: "Workstation Assigned", description: "Desk, laptop, and peripherals provisioned.", status: "pending", dueDay: 3 },
  { id: "it-access", label: "IT Access Created", description: "Email, VPN, and system accounts activated.", status: "pending", dueDay: 7 },
  { id: "induction", label: "Induction Completed", description: "HR induction, code-of-conduct briefing, and department introduction.", status: "pending", dueDay: 7 },
  { id: "probation-review", label: "Probation Review Scheduled", description: "30-day probation check-in meeting scheduled with reporting manager.", status: "pending", dueDay: 30 },
];

const DEFAULT_DOCUMENTS: OnboardingDocument[] = [
  { id: "doc-appt", name: "Appointment Letter", description: "Signed copy of the appointment / offer letter.", required: true, status: "verified", category: "document" },
  { id: "doc-id", name: "Government ID Proof", description: "Aadhaar card, Voter ID, or Passport (self-attested).", required: true, status: "uploaded", category: "document" },
  { id: "doc-address", name: "Address Proof", description: "Aadhaar, utility bill, or bank statement (not older than 3 months).", required: true, status: "pending", category: "document" },
  { id: "doc-education", name: "Education Certificate", description: "Highest qualification marksheet and degree certificate.", required: true, status: "pending", category: "document" },
  { id: "doc-pan", name: "PAN Card", description: "Permanent Account Number card copy for payroll.", required: true, status: "uploaded", category: "document" },
  { id: "doc-bank", name: "Bank Account Details", description: "Cancelled cheque or passbook copy (Name + IFSC + Account No).", required: true, status: "pending", category: "document" },
];

const DEFAULT_TASKS: CalendarTask[] = [
  { id: "t1", title: "Complete document submission", description: "Upload all 6 required KYC documents.", milestoneDay: 1, status: "completed", category: "Documents" },
  { id: "t2", title: "Collect ID card", description: "Visit Admin desk, Block B, Ground Floor.", milestoneDay: 3, status: "in_progress", category: "Admin" },
  { id: "t3", title: "Workstation setup", description: "Laptop imaging and email configuration.", milestoneDay: 3, status: "pending", category: "IT" },
  { id: "t4", title: "IT access & VPN setup", description: "Activate SSO, VPN, and directory access.", milestoneDay: 7, status: "pending", category: "IT" },
  { id: "t5", title: "HR induction session", description: "2-hour induction — policies, leave, payroll.", milestoneDay: 7, status: "pending", category: "HR" },
  { id: "t6", title: "Probation review meeting", description: "Performance check-in with reporting manager.", milestoneDay: 30, status: "pending", category: "HR" },
];

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

interface Props {
  params: Promise<{ id: string }>;
}

export default async function OnboardingDetailPage({ params }: Props) {
  const { id } = await params;

  const { data: rows, source } = await fetchJson<unknown, ApiRow[]>(
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

  const pct = Math.min(100, Math.max(0, Number(String(row.progress).replace("%", ""))));
  const checklist: ChecklistStep[] = row.checklist ?? DEFAULT_CHECKLIST;
  const documents: OnboardingDocument[] = row.documents ?? DEFAULT_DOCUMENTS;
  const tasks: CalendarTask[] = row.tasks ?? DEFAULT_TASKS;

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
        name={row.employeeName ?? row.employee}
        startDate={row.joiningDate}
        department={row.department}
        reportingManager={row.reportingManager ?? "Department Head"}
        officeLocation={row.officeLocation ?? "Head Office, New Delhi — 110 001"}
        overallProgress={pct}
      />

      {/* Two-column: checklist | task calendar */}
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
