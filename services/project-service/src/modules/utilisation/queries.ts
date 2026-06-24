import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";

export async function getUcStatements(schemeId: string, tenantId: string) {
  return cache.getOrLoad(
    cache.makeKey(tenantId, "uc", schemeId),
    () => repo.listUcStatementsByScheme(schemeId, tenantId)
  );
}
