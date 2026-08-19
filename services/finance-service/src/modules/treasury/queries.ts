import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import type { BankRow } from "./schema.js";

export async function getBankBalance(id: string, tenantId: string): Promise<BankRow | null> {
  const row = await cache.getOrLoad<BankRow>(
    cache.makeKey(tenantId, "bank", id),
    () => repo.findBankById(id)
  );
  if (!row || row.tenantId !== tenantId) return null;
  return row;
}
