import { PageShell } from "../../_components/PageShell";
import { DataSourceBadge } from "../../_components/DataSourceBadge";
import { getInstallSteps } from "../../_data/loaders";
import { StatGrid, StatCard, ProgressBar, StatusPill, EmptyState, Card } from "@/app/_components/ds";
import { formatIndianDate } from "@/lib/formatters";
import { InstallStepActions } from "./InstallStepActions";

const STATUS_ICON: Record<string, string> = {
  pending: "○",
  in_progress: "⟳",
  completed: "✓",
  failed: "✗",
  skipped: "—",
};

const STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  in_progress: "In progress",
  completed: "Completed",
  failed: "Failed",
  skipped: "Skipped",
};

export default async function Page() {
  const { data: steps, source } = await getInstallSteps();

  const total = steps.length;
  const requiredSteps = steps.filter((s) => s.isRequired);
  const completedRequired = requiredSteps.filter((s) => s.status === "completed").length;
  const totalRequired = requiredSteps.length;
  const completedAll = steps.filter((s) => s.status === "completed").length;
  const failed = steps.filter((s) => s.status === "failed").length;
  const allRequiredComplete = totalRequired > 0 && completedRequired === totalRequired;
  const progressPct = total > 0 ? Math.round((completedAll / total) * 100) : 0;

  // First non-terminal step is the "current" wizard step.
  const currentStepId = steps.find(
    (s) => s.status === "pending" || s.status === "in_progress" || s.status === "failed",
  )?.id;

  return (
    <PageShell
      title="Installer Wizard"
      description="Guided setup flow for provisioning a new tenant workspace."
    >
      {source === "error" ? <DataSourceBadge source={source} /> : null}

      {total === 0 ? (
        <EmptyState
          icon="🧩"
          title="No installation steps found"
          message="There are no setup steps to display for this tenant yet."
        />
      ) : (
        <div className="space-y-6">
          <StatGrid>
            <StatCard
              icon={allRequiredComplete ? "✅" : "⏳"}
              iconBg={allRequiredComplete ? "#dcfce7" : "#fef3c7"}
              label="Status"
              value={allRequiredComplete ? "Complete" : "In progress"}
            />
            <StatCard icon="📋" label="Total steps" value={total} />
            <StatCard
              icon="✔️"
              iconBg="#dcfce7"
              label="Required complete"
              value={`${completedRequired}/${totalRequired}`}
            />
            <StatCard
              icon="⚠️"
              iconBg={failed > 0 ? "#fee2e2" : "#eef2ff"}
              label="Failed steps"
              value={failed}
            />
          </StatGrid>

          <Card title="Overall progress" padding>
            <div className="flex items-center justify-between text-xs text-slate-600 mb-2">
              <span>
                {completedAll} of {total} steps complete
              </span>
              <span aria-hidden="true">{progressPct}%</span>
            </div>
            <ProgressBar value={progressPct} />
            <p className="sr-only" role="status" aria-live="polite">
              Installation {progressPct} percent complete. {completedRequired} of {totalRequired}{" "}
              required steps done.
            </p>
          </Card>

          <ol className="space-y-3" aria-label="Installation steps">
            {steps.map((step) => {
              const isCurrent = step.id === currentStepId;
              const statusLabel = STATUS_LABEL[step.status] ?? step.status;
              return (
                <li
                  key={step.id}
                  aria-current={isCurrent ? "step" : undefined}
                  className={`rounded-xl border p-5 shadow-sm ${
                    isCurrent ? "border-indigo-400 bg-indigo-50/40" : "border-slate-200 bg-white"
                  }`}
                >
                  <div className="flex items-start gap-4">
                    <span
                      aria-hidden="true"
                      className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-bold text-slate-600"
                    >
                      {STATUS_ICON[step.status] ?? step.stepNo}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className="font-medium text-slate-900">
                          <span className="text-slate-500">Step {step.stepNo}:</span> {step.title}
                          {step.isRequired ? null : (
                            <span className="ms-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                              Optional
                            </span>
                          )}
                        </p>
                        <StatusPill status={step.status.replace(/_/g, " ")} label={statusLabel} />
                      </div>
                      {step.description ? (
                        <p className="mt-1 text-sm text-slate-600">{step.description}</p>
                      ) : null}
                      {step.completedAt ? (
                        <p className="mt-1 text-xs text-slate-500">
                          Completed: {formatIndianDate(step.completedAt)}
                        </p>
                      ) : null}
                      {step.errorMessage ? (
                        <p className="mt-1 text-xs text-red-600" role="alert">
                          Error: {step.errorMessage}
                        </p>
                      ) : null}
                      {step.status !== "completed" ? (
                        <InstallStepActions
                          id={step.id}
                          status={step.status}
                          title={step.title}
                          isRequired={step.isRequired}
                        />
                      ) : null}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    <p className="back" style={{ marginTop: 16 }}>
        <a href="/install/console">Open install console →</a>
      </p>
    </PageShell>
  );
}
