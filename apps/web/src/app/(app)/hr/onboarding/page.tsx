import Link from "next/link";
import { PageHeader, StatGrid, StatCard, EmptyState, RefreshErrorState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PermissionDenied } from "../../../_components/PermissionDenied";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { toHumanError } from "@/lib/messages";
import { JoineeCard, type JoineeCardData } from "./_components/JoineeCard";

// Mirrors HR_ROLES in services/hrms-service/src/modules/lifecycle/onboarding-routes.ts
// (GET /v1/hrms/onboarding) -- kept local rather than shared, matching how
// the backend itself already re-declares this same list per route file.
const ONBOARDING_ROLES = ["hr_admin", "hr_officer", "super_admin"];

type Row = {
  id: string;
  employee: string;
  department: string;
  joiningDate: string;
  stepsCompleted: string | number;
  totalSteps: string | number;
  overdue: number;
  progress: string | number;
  status: string;
} & Record<string, unknown>;

async function getData(): Promise<LoaderResult<Row[]>> {
  return fetchJson<unknown, Row[]>("/api/v1/hrms/onboarding", [], {
    telemetryKey: "hr.onboarding",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: Row[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

export default async function OnboardingPage() {
  const { data: items, source, status } = await getData();

  // A 403 here is a real, permanent role restriction (this is a tenant-wide
  // onboarding summary across every new joinee, deliberately HR-only -- see
  // HR_ROLES in onboarding-routes.ts), not a transient failure. The normal
  // "Couldn't load -- try again" error state is misleading for it: retrying
  // never succeeds, and it reads as this page being broken rather than as a
  // role the viewer correctly doesn't have. Skip the stat tiles/cards
  // entirely (none of it is meaningful with zero access) and say plainly
  // what's actually true.
  if (status === 403) {
    return (
      <main className="page-main wrap" aria-labelledby="page-heading">
        <PageHeader
          title="Onboarding Tracker"
          subtitle="Onboarding checklist progress for new joinees — document collection, IT setup, and departmental induction."
          back="/hr" backLabel="Back to HR"
        />
        <PermissionDenied module="the onboarding tracker" requiredRoles={ONBOARDING_ROLES} />
      </main>
    );
  }

  const inProgress = items.filter((i) => i.status === "in_progress").length;
  const completed = items.filter((i) => i.status === "completed").length;
  const overdue = items.filter((i) => i.status === "overdue" || Number(i.overdue) > 0).length;

  const cardData: JoineeCardData[] = items.map((row) => ({
    id: row.id,
    employee: row.employee,
    department: row.department,
    joiningDate: row.joiningDate,
    stepsCompleted: Number(row.stepsCompleted),
    totalSteps: Number(row.totalSteps),
    overdue: Number(row.overdue),
    progress: Number(String(row.progress).replace("%", "")),
    status: row.status,
  }));

  // Sort: overdue first, then in_progress, then rest
  const sorted = [...cardData].sort((a, b) => {
    if (b.overdue !== a.overdue) return b.overdue - a.overdue;
    const order: Record<string, number> = { overdue: 0, in_progress: 1, pending: 2, completed: 3 };
    return (order[a.status] ?? 9) - (order[b.status] ?? 9);
  });

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Onboarding Tracker"
        subtitle="Onboarding checklist progress for new joinees — document collection, IT setup, and departmental induction."
        back="/hr" backLabel="Back to HR"
        actions={
          <Link href="/hr/employees/new" className="btn primary" aria-label="Add new joinee">
            + Add New Joinee
          </Link>
        }
      />

      <DataSourceBadge source={source} />

      <StatGrid>
        <StatCard icon="👋" iconBg="#e6f0ff" label="Total Onboarding" value={items.length} />
        <StatCard icon="🔄" iconBg="#fffbe6" label="In Progress" value={inProgress} />
        <StatCard icon="✅" iconBg="#e6f7f0" label="Completed" value={completed} />
        <StatCard icon="⚠️" iconBg="#fff1f0" label="Overdue Tasks" value={overdue} />
      </StatGrid>

      {/* ── Joinee card grid (manager view) ─────────────────────────────────── */}
      {source === "error" ? (
        <div
          style={{
            marginTop: 24,
            border: "1px solid var(--border, #e2e8f0)",
            borderRadius: 12,
            padding: 32,
          }}
        >
          <RefreshErrorState error={toHumanError("load", { area: "onboarding tracker" })} backHref="/hr" />
        </div>
      ) : items.length === 0 ? (
        <div
          style={{
            marginTop: 24,
            border: "1px solid var(--border, #e2e8f0)",
            borderRadius: 12,
            padding: 32,
          }}
        >
          <EmptyState
            icon="👋"
            title="No joiners this month"
            message="New joinee onboarding checklists appear here once a joining is initiated. Checklists track document collection, IT access setup, workstation assignment, ID card issuance, and induction completion."
            action={
              <Link
                href="/hr/employees/new"
                className="btn primary"
                style={{ marginTop: 12, display: "inline-block" }}
                aria-label="Add new joinee to start onboarding"
              >
                Add New Joinee
              </Link>
            }
          />
        </div>
      ) : (
        <>
          {overdue > 0 && (
            <div
              role="alert"
              aria-live="polite"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 14px",
                background: "var(--warnbg, #fffbeb)",
                border: "1px solid var(--warnbd, #fde68a)",
                borderRadius: 8,
                fontSize: 13,
                color: "var(--warn, #92400e)",
                fontWeight: 500,
                marginTop: 4,
                marginBottom: 4,
              }}
            >
              <span aria-hidden style={{ fontSize: 16 }}>⚠️</span>
              <span>
                <strong>{overdue}</strong> onboarding{overdue > 1 ? "s" : ""} have overdue tasks — highlighted in amber below.
              </span>
            </div>
          )}

          <section aria-label="Joinee onboarding cards">
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
                gap: 14,
                marginTop: 16,
              }}
            >
              {sorted.map((card) => (
                <JoineeCard key={card.id} {...card} />
              ))}
            </div>
          </section>
        </>
      )}
    </main>
  );
}
