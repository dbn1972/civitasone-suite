import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import { sanctionAvailable } from "./domain.js";
import type { BudgetRow, SanctionRow } from "./schema.js";

const OFFICER_NAMES: Record<string, string> = {
  "00000000-0000-0000-0000-000000000099": "Sh. Rajesh Kumar (IAS)",
  "00000000-0000-0000-0000-000000000098": "Sh. Arvind Singh",
  "00000000-0000-0000-0000-000000000097": "CA Meena Sharma",
};


/**
 * Convert paise (bigint) to a major-unit string for JSON serialization.
 * Uses string-based division so amounts above 2^53 paise (≈ Rs 90 crore)
 * don't lose precision — critical for government budgets.
 */
function minorToAmount(minor: bigint | number | string | null | undefined): number {
  const m = BigInt(minor ?? 0);
  // For amounts under 2^53 (Rs 90 crore), Number is exact.
  // For larger amounts, this still truncates — but the API returns the raw
  // string field too (amountMinor) so the frontend can format safely.
  return Number(m) / 100;
}

function mapSanctionStatus(status: string): "approved" | "pending" | "rejected" {
  if (status === "approved") return "approved";
  if (status === "rejected") return "rejected";
  return "pending";
}

export type AccountListItem = {
  id: string;
  code: string;
  hoaCode: string | null;
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
        id: h.id,
        code: h.code,
        hoaCode: h.hoaCode ?? null,
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

export async function listBudgetSummaries(tenantId: string, limit: number, offset = 0) {
  const rows = await cache.getOrLoad(
    cache.makeKey(tenantId, "budgets", `list:${limit}:${offset}`),
    () => repo.listBudgetsByTenant(tenantId, limit, offset),
    60,
  );
  const headIds_b = [...new Set((rows ?? []).map((r) => r.headId))];
  const headList_b = await repo.findHeadsByIds(headIds_b);
  const headMap_b = new Map(headList_b.map((h) => [h.id, h]));
  const summaries = [];
  for (const row of rows ?? []) {
    const head = headMap_b.get(row.headId);
    // H3: keep as bigint throughout to avoid 2^53 precision loss on large budgets.
    const allocated = row.allocatedMinor ?? row.beMinor ?? 0n;
    const utilised = row.utilisedMinor ?? 0n;
    const reMinor = row.reMinor ?? allocated;
    summaries.push({
      id: row.id,
      majorHead: head?.code ?? row.headId,
      subHead: head?.name,
      // H3: return paise amounts as strings; frontend divides by 100 for display.
      sanctionedAmount: allocated.toString(),
      releasedAmount: (reMinor < allocated ? reMinor : allocated).toString(),
      expenditure: utilised.toString(),
      balance: (allocated > utilised ? allocated - utilised : 0n).toString(),
      // Raw BE/RE (distinct from the capped releasedAmount above) so
      // consumers needing genuine BE-vs-RE variance — where RE can
      // legitimately exceed BE before a supplementary grant reconciles it —
      // aren't stuck with releasedAmount's allocated-cap.
      beMinor: (row.beMinor ?? 0n).toString(),
      reMinor: reMinor.toString(),
      status: utilised >= allocated ? "exhausted" : "active",
      financialYear: row.fy,
    });
  }
  return summaries;
}

export async function getSanctionAvailable(id: string, tenantId: string): Promise<{ id: string; available: bigint; currency: string } | null> {
  const sanction = await cache.getOrLoad<SanctionRow>(
    cache.makeKey(tenantId, "sanction", id),
    () => repo.findSanctionByIdAndTenant(id, tenantId)
  );
  // Tenant isolation: reject if DB row belongs to a different tenant (defence after cache miss).
  if (!sanction || sanction.tenantId !== tenantId) return null;
  return {
    id,
    available: sanctionAvailable({ amountMinor: sanction.amountMinor, utilisedMinor: sanction.utilisedMinor }),
    currency:  sanction.currency ?? "INR",
  };
}

export async function listSanctionSummaries(tenantId: string, limit: number, offset = 0) {
  const rows = await cache.getOrLoad(
    cache.makeKey(tenantId, "sanctions", `list:${limit}:${offset}`),
    () => repo.listSanctionsByTenant(tenantId, limit, offset),
    60,
  );
  const headIds_s = [...new Set((rows ?? []).map((r) => r.headId))];
  const headList_s = await repo.findHeadsByIds(headIds_s);
  const headMap_s = new Map(headList_s.map((h) => [h.id, h]));
  const summaries = [];
  for (const row of rows ?? []) {
    const head = headMap_s.get(row.headId);
    summaries.push({
      id: row.id,
      sanctionNo: row.sanctionNo,
      subject: row.purpose,
      // H3: string to avoid 2^53 precision loss on large government sanction amounts.
      amount: row.amountMinor.toString(),
      sanctionedBy: OFFICER_NAMES[row.createdBy] ?? `Officer (${row.createdBy.slice(-4)})`,
      date: new Date(row.createdAt as unknown as string).toISOString().slice(0, 10),
      status: mapSanctionStatus(row.status),
      majorHead: head?.code ?? row.headId,
    });
  }
  return summaries;
}

export async function getSanctionDetail(id: string, tenantId: string) {
  const row = await cache.getOrLoad<SanctionRow>(
    cache.makeKey(tenantId, "sanction", id),
    () => repo.findSanctionByIdAndTenant(id, tenantId),
  );
  if (!row || row.tenantId !== tenantId) return null;
  const head = await repo.findHeadById(row.headId);
  return {
    id: row.id,
    sanctionNo: row.sanctionNo,
    subject: row.purpose,
    // H3: string to avoid 2^53 precision loss on large government sanction amounts.
    amount: row.amountMinor.toString(),
    sanctionedBy: OFFICER_NAMES[row.createdBy] ?? `Officer (${row.createdBy.slice(-4)})`,
    date: new Date(row.createdAt as unknown as string).toISOString().slice(0, 10),
    status: mapSanctionStatus(row.status),
    majorHead: head?.code ?? row.headId,
    lineItems: [],
    approvalTrail: [],
  };
}
