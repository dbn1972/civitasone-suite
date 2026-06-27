import { PageHeader } from "../../_components/ds";
import { SetupWizard } from "./SetupWizard";
import { evaluateSteps } from "./progress";
import {
  WIZARD_STEPS,
  REQUIRED_STEP_KEYS,
  countComplete,
  progressPct,
  allRequiredComplete,
  firstIncompleteIndex,
  type StepStatus,
  type WizardStepKey,
} from "@/lib/setupSteps";
import { getEnabledModules, isModuleEnabled } from "@/lib/moduleVisibility";

export const metadata = { title: "Getting Started" };

/**
 * First-run organisation Bootstrap Wizard.
 *
 * Honest by design: every step's status is derived from real tenant data here on
 * the server (progress.ts), module-dependent steps are scoped to enabled modules
 * (R13.3), and the progress is computed only from genuinely complete steps (R8).
 * If evaluation throws entirely, we fall back to a safe "all to do" view and keep
 * the page working (R8.3).
 */
export default async function SetupPage() {
  const enabled = await getEnabledModules();

  // Hide optional module steps when their module isn't turned on. Required steps
  // have no moduleKey and always show.
  const steps = WIZARD_STEPS.filter((s) => isModuleEnabled(enabled, s.moduleKey ?? null));
  const keys = steps.map((s) => s.key) as WizardStepKey[];

  let statuses: Record<string, StepStatus>;
  try {
    statuses = await evaluateSteps(keys);
  } catch {
    // R8.3 — never break the page; show everything as "to do" if we can't compute.
    statuses = Object.fromEntries(keys.map((k) => [k, "todo" as StepStatus]));
  }

  const stepViews = steps.map((s) => ({ ...s, status: statuses[s.key] ?? "todo" }));
  const doneCount = countComplete(statuses, keys);
  const progress = progressPct(statuses, keys);
  const ready = allRequiredComplete(statuses);
  const resumeIndex = firstIncompleteIndex(steps, statuses);
  const progressUnknown = keys.some((k) => statuses[k] === "unknown");

  // Required-step count for the visible denominator label.
  const visibleRequired = keys.filter((k) => REQUIRED_STEP_KEYS.includes(k));
  void visibleRequired;

  return (
    <section className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Getting Started"
        subtitle="A few quick steps to set up your office. There's no rush — do them in any order, and finish the rest later."
        help="tenant-admin"
      />
      <SetupWizard
        steps={stepViews}
        doneCount={doneCount}
        totalCount={keys.length}
        progress={progress}
        ready={ready}
        resumeIndex={resumeIndex}
        progressUnknown={progressUnknown}
        sampleDataEnabled={process.env.SAMPLE_DATA_ENABLED === "true"}
      />
    </section>
  );
}
