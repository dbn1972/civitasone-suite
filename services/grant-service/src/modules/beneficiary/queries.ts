import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import type { BeneficiaryRow } from "./schema.js";

export async function getBeneficiary(tenantId: string, id: string): Promise<BeneficiaryRow | null> {
  return cache.getOrLoad(
    cache.makeKey(tenantId, "beneficiary", id),
    () => repo.findBeneficiaryById(id)
  );
}
