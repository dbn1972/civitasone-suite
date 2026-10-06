import { PageHeader, StatCard, StatGrid, Card, ProgressBar, StatusPill, EmptyState, RefreshErrorState } from "@/app/_components/ds";
import { Breadcrumb } from "../Breadcrumb";
import { getInstallSteps } from "@/app/_data/loaders";
import { toResourceState } from "@/app/_data/useResource";
import { toHumanError } from "@/lib/messages";
import { formatIndianDateTime } from "@/lib/formatters";

// GAP-TENANT-ADMIN-INSTALL-03: a step's status drives exactly one visible
// label (the StatusPill); the leading glyph is decorative only (aria-hidden)
// and never the sole carrier of status. We no longer map "failed"/"skipped"
// into "pending" — each real status renders a distinct pill (the shared
// StatusPill already maps completed/failed/in progress; "skipped" is keyed as
// a neutral terminal state) so the four stat cards always sum to the total.
function stepIcon(status: string): string {
  if (status === "completed") return "✅";
  if (status === "in_progress") return "🔄";
  if (status === "failed") return "⚠️";
  if (status === "skipped") return "➖";
  return "⬜";
}

// GAP-TENANT-ADMIN-INSTALL-03: the shared STATUS_MAP colours both "pending"
// and "in progress" amber (warn), so without an override an in-progress step
// is indistinguishable from a pending one. We override tones *locally* here
// (rather than editing the shared map, which would recolour "in progress" on
// every other screen): in-progress = info (blue), skipped = mut (grey). The
// shared map already gives completed=good, failed=bad, pending=warn.
const STEP_TONE: Record<string, "good" | "warn" | "mut" | "bad" | "info"> = {
  in_progress: "info",
  skipped: "mut",
};

export default async function InstallStatusPage() {
  const result = await getInstallSteps();
  const { data: installSteps } = result;
  const errored = toResourceState(result).status === "error";
  const completed = installSteps.filter((s) => s.status === "completed").length;
  const inProgress = installSteps.filter((s) => s.status === "in_progress").length;
  const failed = installSteps.filter((s) => s.status === "failed").length;
  const skipped = installSteps.filter((s) => s.status === "skipped").length;
  const total = installSteps.length;
  // Pending is whatever remains after the known terminal/active states, so the
  // cards always add up to `total` even for statuses stepIcon() doesn't name.
  const pending = total - completed - inProgress - failed - skipped;
  const progressPct = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <Breadcrumb items={[{ label: "Tenant Admin", href: "/tenant-admin" }, { label: "Installer Status" }]} />
      <PageHeader
        back="/tenant-admin"
        title="Installer Status"
        subtitle="Setup wizard progress — track completed and pending installation steps."
        actions={
          <a href="/install" className="btn primary" aria-label="Go to main installer page" style={{ minHeight: 44 }}>
            Open Installer
          </a>
        }
      />
      {/* GAP-TENANT-ADMIN-INSTALL-04: no standalone DataSourceBadge here — the
          errored path already shows RefreshErrorState, so a second amber
          "unavailable" badge would say the same thing twice; the success path
          needs no badge. */}

      <StatGrid>
        {/* GAP-TENANT-ADMIN-INSTALL-01: with no steps, Progress shows "—" not a
            misleading 0%. */}
        <StatCard icon="🚀" iconBg="#eff6ff" label="Progress" value={errored || total === 0 ? "—" : `${progressPct}%`} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Completed" value={errored ? "—" : completed} />
        <StatCard icon="🔄" iconBg="#fffaeb" label="In Progress" value={errored ? "—" : inProgress} />
        <StatCard icon="⬜" iconBg="#f1f5f9" label="Pending" value={errored ? "—" : pending} />
      </StatGrid>

      {errored ? (
        <Card title="Setup Progress" padding>
          <RefreshErrorState error={toHumanError("load", { area: "installation status" })} backHref="/tenant-admin" />
        </Card>
      ) : (
        <>
          {/* GAP-TENANT-ADMIN-INSTALL-01: the Setup Progress card only makes
              sense once there is at least one step; with total === 0 it would
              show "0% / 0/0 steps" next to the "no steps" EmptyState below. */}
          {total > 0 && (
            <Card title="Setup Progress" padding>
              <div style={{ marginBottom: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: 13, fontWeight: 500 }}>
                  <span>Installation completion</span>
                  <span>{completed}/{total} steps</span>
                </div>
                <ProgressBar value={progressPct} color="#2563eb" />
              </div>
            </Card>
          )}

          {installSteps.length === 0 ? (
            <Card title="Installation Steps" padding>
              <EmptyState icon="🚀" title="No installation steps found" message="Run the installer to see setup progress here." action={<a href="/install" className="btn primary">Open Installer</a>} />
            </Card>
          ) : (
            <Card title="Installation Steps" padding>
              <ol aria-label="Installation steps" style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {installSteps.map((step, idx) => (
                  <li key={step.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderBottom: "1px solid var(--border, #e2e8f0)" }}>
                    <span aria-hidden="true" style={{ fontSize: 16, flexShrink: 0 }}>{stepIcon(step.status)}</span>
                    <span style={{ width: 24, height: 24, borderRadius: "50%", background: "var(--bg2, #f8fafc)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 600, flexShrink: 0, border: "1px solid var(--border, #e2e8f0)" }}>
                      {step.stepNo ?? idx + 1}
                    </span>
                    <div style={{ flex: 1 }}>
                      {/* GAP-TENANT-ADMIN-INSTALL-02: the step title links into
                          the installer so an admin can act on it directly; the
                          anchor carries the step number and has a 44px hit area
                          with a visible focus ring. */}
                      <p style={{ margin: 0, fontWeight: 500, fontSize: 14 }}>
                        <a
                          href={`/install/steps#step-${step.stepNo ?? idx + 1}`}
                          className="link"
                          aria-label={`Open installer at step ${step.stepNo ?? idx + 1}: ${step.title}`}
                          style={{ display: "inline-flex", alignItems: "center", minHeight: 44 }}
                        >
                          {step.title}
                        </a>
                      </p>
                      {step.description && <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--ink2)" }}>{step.description}</p>}
                      {/* GAP-TENANT-ADMIN-INSTALL-02: last-updated shown only
                          when the API actually provides it (completedAt);
                          owner is not exposed by InstallStepSummary, so it is
                          deliberately omitted rather than fabricated. */}
                      {step.completedAt && (
                        <p style={{ margin: "2px 0 0", fontSize: 11, color: "var(--ink2)" }}>
                          Last updated {formatIndianDateTime(step.completedAt)}
                        </p>
                      )}
                    </div>
                    <StatusPill status={step.status} variant={STEP_TONE[step.status]} />
                  </li>
                ))}
              </ol>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
