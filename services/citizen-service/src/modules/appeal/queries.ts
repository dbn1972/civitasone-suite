import * as repo from "./repo.js";

export async function listAppeals(tenantId: string) {
  return repo.listAppeals(tenantId);
}

export async function getAppeal(tenantId: string, id: string) {
  const appeal = await repo.findAppealById(id, tenantId);
  if (!appeal) return null;
  const hearings = await repo.listHearings(tenantId, id);
  return { ...appeal, hearings };
}
