import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";

type ProgressResult = {
  physical: Awaited<ReturnType<typeof repo.listPhysicalProgressByProject>>;
  financial: Awaited<ReturnType<typeof repo.listFinancialProgressByProject>>;
  dprs: Awaited<ReturnType<typeof repo.listDprsByProject>>;
};

export async function getProgress(projectId: string, tenantId: string): Promise<ProgressResult> {
  const result = await cache.getOrLoad<ProgressResult>(
    cache.makeKey(tenantId, "progress", projectId),
    async () => {
      const [physical, financial, dprs] = await Promise.all([
        repo.listPhysicalProgressByProject(projectId),
        repo.listFinancialProgressByProject(projectId),
        repo.listDprsByProject(projectId),
      ]);
      return { physical, financial, dprs };
    }
  );
  return result ?? { physical: [], financial: [], dprs: [] };
}
