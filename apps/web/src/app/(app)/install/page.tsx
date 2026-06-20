import { PageShell } from "../../_components/PageShell";
import { DataSourceBadge } from "../../_components/DataSourceBadge";
import { getInstallSteps } from "../../_data/loaders";

const statusIcons: Record<string, string> = {
  pending: "○",
  in_progress: "⟳",
  completed: "✓",
  failed: "✗",
  skipped: "—",
};

const statusColors: Record<string, string> = {
  pending: "border-slate-200 bg-white",
  in_progress: "border-yellow-300 bg-yellow-50",
  completed: "border-emerald-300 bg-emerald-50",
  failed: "border-red-300 bg-red-50",
  skipped: "border-slate-200 bg-slate-50",
};

const statusTextColors: Record<string, string> = {
  pending: "text-slate-500",
  in_progress: "text-yellow-700",
  completed: "text-emerald-700",
  failed: "text-red-700",
  skipped: "text-slate-400",
};

const iconBgColors: Record<string, string> = {
  pending: "bg-slate-100 text-slate-500",
  in_progress: "bg-yellow-100 text-yellow-700",
  completed: "bg-emerald-100 text-emerald-700",
  failed: "bg-red-100 text-red-700",
  skipped: "bg-slate-100 text-slate-400",
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

  return (
    <PageShell title="Installer Wizard" description="Guided setup flow for provisioning a new tenant workspace.">
      {source === "error" ? <DataSourceBadge source={source} /> : null}

      <div className="space-y-6">
        {total > 0 ? (
          <div className={`rounded-xl border px-5 py-4 ${allRequiredComplete ? "border-emerald-300 bg-emerald-50" : "border-amber-300 bg-amber-50"}`}>
            <p className={`text-sm font-semibold ${allRequiredComplete ? "text-emerald-800" : "text-amber-800"}`}>
              {allRequiredComplete ? "Installation Complete" : "Setup In Progress"}
            </p>
            {!allRequiredComplete ? (
              <p className="mt-0.5 text-xs text-amber-700">
                {completedRequired}/{totalRequired} required steps complete
              </p>
            ) : null}
          </div>
        ) : null}

        {total > 0 ? (
          <div>
            <div className="flex items-center justify-between text-xs text-slate-600 mb-1">
              <span>Overall progress</span>
              <span>{progressPct}%</span>
            </div>
            <div className="h-2 w-full rounded-full bg-slate-200">
              <div
                className="h-2 rounded-full bg-indigo-500 transition-all"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
        ) : null}

        <ol className="space-y-3">
          {steps.map((step) => (
            <li
              key={step.id}
              className={`rounded-xl border p-5 shadow-sm ${statusColors[step.status] ?? "border-slate-200 bg-white"}`}
            >
              <div className="flex items-start gap-4">
                <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${iconBgColors[step.status] ?? "bg-slate-100 text-slate-500"}`}>
                  {statusIcons[step.status] ?? step.stepNo}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-medium text-slate-900">
                      {step.stepNo}. {step.title}
                      {step.isRequired ? null : (
                        <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">Optional</span>
                      )}
                    </p>
                    <span className={`text-xs font-medium capitalize ${statusTextColors[step.status] ?? "text-slate-500"}`}>
                      {step.status.replace(/_/g, " ")}
                    </span>
                  </div>
                  {step.description ? (
                    <p className="mt-1 text-sm text-slate-600">{step.description}</p>
                  ) : null}
                  {step.completedAt ? (
                    <p className="mt-1 text-xs text-slate-500">Completed: {step.completedAt.slice(0, 16).replace("T", " ")}</p>
                  ) : null}
                  {step.errorMessage ? (
                    <p className="mt-1 text-xs text-red-600">Error: {step.errorMessage}</p>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
          {steps.length === 0 && (
            <li className="rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
              <p className="text-sm text-slate-400">No installation steps found.</p>
            </li>
          )}
        </ol>
      </div>
    </PageShell>
  );
}
