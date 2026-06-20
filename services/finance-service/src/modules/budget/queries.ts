import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import { sanctionAvailable } from "./domain.js";
import type { BudgetRow, SanctionRow } from "./schema.js";

export type AccountListItem = {
  code: string;
  name: string;
  type: "asset" | "liability" | "equity" | "income" | "expense";
  currency: string;
  balanceDisplay: string;
  status: "active" | "inactive";
};

function mapAccountType(classification: string | null, level: number): AccountListItem["type"] {
  const c = (classification ?? "").toLowerCase();
  if (c === "asset" || c === "liability" || c === "equity" || c === "income" || c === "expense") {
    return c;
  }
  return level === 0 ? "asset" : "expense";
}

export async function listAccounts(tenantId: string, limit: number): Promise<AccountListItem[]> {
  const rows = await cache.getOrLoad(
    cache.makeKey(tenantId, "accounts", `list:${limit}`),
    async () => {
      const heads = await repo.listHeads(tenantId, limit);
      return heads.map((h) => ({
        code: h.code,
        name: h.name,
        type: mapAccountType(h.classification, h.level),
        currency: "INR",
        balanceDisplay: "0",
        status: "active" as const,
      }));
    },
    60
  );
  return rows ?? [];
}

export async function getBudget(tenantId: string, headId: string, fy: string): Promise<BudgetRow | null> {
  return cache.getOrLoad(
    cache.makeKey(tenantId, "budget", `${headId}:${fy}`),
    () => repo.findBudget(headId, fy, tenantId)
  );
}

export async function getSanctionAvailable(id: string, tenantId: string): Promise<{ id: string; available: bigint; currency: string } | null> {
  const sanction = await cache.getOrLoad<SanctionRow>(
    cache.makeKey(tenantId, "sanction", id),
    () => repo.findSanctionById(id)
  );
  if (!sanction) return null;
  return {
    id,
    available: sanctionAvailable({ amountMinor: sanction.amountMinor, utilisedMinor: sanction.utilisedMinor }),
    currency:  sanction.currency ?? "INR",
  };
}
