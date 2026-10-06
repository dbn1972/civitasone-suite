import { ModuleHub } from "../../../_components/ModuleHub";
import { getInstallSteps } from "../../../_data/loaders";
import { StatGrid, StatCard, RefreshErrorState } from "@/app/_components/ds";
import { formatIndianDate } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";

export const dynamic = "force-dynamic";

const LINKS = [
  {
    href: "/install",
    label: "Installer wizard",
    note: "Start here: run, retry and skip setup steps in order.",
  },
  {
    href: "/install/domain-packs",
    label: "Domain Packs",
    note: "Import ready-made service templates (Municipal India → Trade License, grievances, Water drafts).",
  },
  {
    href: "/install/stages",
    label: "Stages",
    note: "Read-only progress by stage.",
  },
  {
    href: "/install/steps",
    label: "Steps",
    note: "Full step list with status and any errors.",
  },
  {
    href: "/install/modules",
    label: "Modules",
    note: "Module resolution catalogue — which modules resolve for this office.",
  },
  {
    href: "/install/silos",
    label: "Silo provisions",
    note: "Isolated per-office silo provision records.",
  },
];

export default async function Page() {
  const { data: steps, source } = await getInstallSteps();

  const total = steps.length;
  const completedRequired = steps.filter((s) => s.isRequired && s.status === "completed").length;
  const totalRequired = steps.filter((s) => s.isRequired).length;
  const failed = steps.filter((s) => s.status === "failed").length;
  const current = steps.find(
    (s) => s.status === "pending" || s.status === "in_progress" || s.status === "failed",
  );
  const lastCompleted = steps
    .filter((s) => s.completedAt)
    .map((s) => s.completedAt as string)
    .sort()
    .at(-1);

  return (
    <ModuleHub
      title="Install console"
      description="Provisioning stages, module resolution and silo provisions."
      help="install"
      links={LINKS}
    >
      {source === "error" ? (
        <RefreshErrorState
          error={toHumanError("load", { area: "install status" })}
          source={{ area: "install status" }}
          backHref="/dashboard"
        />
      ) : total > 0 ? (
        <StatGrid>
          <StatCard
            icon="📍"
            label="Current step"
            value={current ? `Step ${current.stepNo}: ${current.title}` : "All done"}
          />
          <StatCard
            icon="⚠️"
            iconBg={failed > 0 ? "#fee2e2" : "#eef2ff"}
            label="Failed steps"
            value={failed}
          />
          <StatCard icon="✔️" label="Required complete" value={`${completedRequired}/${totalRequired}`} />
          <StatCard icon="🗓️" label="Last completed" value={lastCompleted ? formatIndianDate(lastCompleted) : "—"} />
        </StatGrid>
      ) : null}
    </ModuleHub>
  );
}
