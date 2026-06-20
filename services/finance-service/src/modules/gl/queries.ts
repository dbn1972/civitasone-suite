import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import type { LedgerQueryParams } from "./validators.js";

export async function getLedger(tenantId: string, params: LedgerQueryParams) {
  return repo.getLedgerLines(tenantId, params.headId, params.from, params.to, params.limit);
}

export async function getTrialBalance(tenantId: string) {
  return cache.getOrLoad(
    cache.makeKey(tenantId, "gl_trial_balance", tenantId),
    () => repo.getTrialBalance(tenantId),
    30
  );
}
