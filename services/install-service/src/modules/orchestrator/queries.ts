import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import { resolveReadySteps, isWizardComplete, getWizardProgress as getDomainProgress } from "./domain.js";
import type { StepDef, StepExec } from "./domain.js";
import type { WizardProgressView } from "./validators.js";

const RESOURCE = "wizard";

export async function getWizardProgress(wizardId: string, tenantId: string): Promise<WizardProgressView | null> {
  return cache.getOrLoad<WizardProgressView>(
    cache.makeKey(tenantId, RESOURCE, `${wizardId}:progress`),
    async () => {
      const wizard = await repo.getWizard(wizardId, tenantId);
      if (!wizard) return null;

      const defs = await repo.getStepDefinitions(wizardId, tenantId);
      const execs = await repo.getStepExecutions(wizardId, tenantId);

      const stepDefs: StepDef[] = defs.map((d) => ({
        stepKey: d.stepKey,
        isRequired: d.isRequired,
        dependsOn: d.dependsOn ?? [],
      }));

      const stepExecs: StepExec[] = execs.map((e) => ({
        stepKey: e.stepKey,
        status: e.status as StepExec["status"],
      }));

      const progress = getDomainProgress(stepDefs, stepExecs);
      const readySteps = resolveReadySteps(stepDefs, stepExecs);
      const complete = isWizardComplete(stepDefs, stepExecs);

      const execMap = new Map(execs.map((e) => [e.stepKey, e.status]));

      const steps = defs
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((d) => {
          let status = execMap.get(d.stepKey) ?? "pending";
          if (readySteps.includes(d.stepKey) && (status === "pending" || status === "blocked")) {
            status = "ready";
          }
          return {
            stepKey: d.stepKey,
            title: d.title,
            status,
            isRequired: d.isRequired,
            dependsOn: d.dependsOn ?? [],
            sortOrder: d.sortOrder,
          };
        });

      return {
        wizardId: wizard.id,
        name: wizard.name,
        total: progress.total,
        completed: progress.completed,
        percentage: progress.percentage,
        isComplete: complete,
        steps,
      };
    },
  );
}

export async function listWizards(tenantId: string, limit: number, offset: number) {
  return cache.listOrLoad(tenantId, RESOURCE, `list:${limit}:${offset}`, async () => {
    const rows = await repo.listWizards(tenantId, limit, offset);
    const data = rows.map((r) => ({
      id: r.id,
      tenantId: r.tenantId,
      name: r.name,
      description: r.description,
      status: r.status,
      version: r.version,
    }));
    return {
      data,
      pagination: {
        hasMore: rows.length === limit,
        pageSize: limit,
        ...(rows.length ? { cursor: String(offset + rows.length) } : {}),
      },
    };
  });
}
