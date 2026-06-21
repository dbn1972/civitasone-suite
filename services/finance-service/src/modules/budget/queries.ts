import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import { sanctionAvailable } from "./domain.js";
import type { BudgetRow, SanctionRow } from "./schema.js";

function minorToAmount(minor: bigint): number {
  return Number(minor) / 100;
}

function mapSanctionStatus(status: string): "approved" | "pending" | "rejected" {
  if (status === "approved") return "approved";
  if (status === "rejected") return "rejected";
  return "pending";
}

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

export async function listBudgetSummaries(tenantId: string, limit: number) {
  const rows = await cache.getOrLoad(
    cache.makeKey(tenantId, "budgets", `list:${limit}`),
    () => repo.listBudgetsByTenant(tenantId, limit),
    60,
  );
  const summaries = [];
  for (const row of rows ?? []) {
    const head = await repo.findHeadById(row.headId);
    const allocated = Number(row.allocatedMinor ?? row.beMinor ?? 0n);
    const utilised = Number(row.utilisedMinor ?? 0n);
    summaries.push({
      id: row.id,
      majorHead: head?.code ?? row.headId,
      subHead: head?.name,
      sanctionedAmount: allocated / 100,
      releasedAmount: Number(row.reMinor ?? row.allocatedMinor ?? 0n) / 100,
      expenditure: utilised / 100,
      balance: Math.max(0, allocated - utilised) / 100,
      status: utilised >= allocated ? "exhausted" : "active",
      financialYear: row.fy,
    });
  }
  return summaries;
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

export async function listSanctionSummaries(tenantId: string, limit: number) {
  const rows = await cache.getOrLoad(
    cache.makeKey(tenantId, "sanctions", `list:${limit}`),
    () => repo.listSanctionsByTenant(tenantId, limit),
    60,
  );
  const summaries = [];
  for (const row of rows ?? []) {
    const head = await repo.findHeadById(row.headId);
    summaries.push({
      id: row.id,
      sanctionNo: row.sanctionNo,
      subject: row.purpose,
      amount: minorToAmount(row.amountMinor),
      sanctionedBy: row.createdBy,
      date: row.createdAt.toISOString().slice(0, 10),
      status: mapSanctionStatus(row.status),
      majorHead: head?.code ?? row.headId,
    });
  }
  return summaries;
}

export async function getSanctionDetail(id: string, tenantId: string) {
  const row = await cache.getOrLoad<SanctionRow>(
    cache.makeKey(tenantId, "sanction", id),
    () => repo.findSanctionById(id),
  );
  if (!row || row.tenantId !== tenantId) return null;
  const head = await repo.findHeadById(row.headId);
  return {
    id: row.id,
    sanctionNo: row.sanctionNo,
    subject: row.purpose,
    amount: minorToAmount(row.amountMinor),
    sanctionedBy: row.createdBy,
    date: row.createdAt.toISOString().slice(0, 10),
    status: mapSanctionStatus(row.status),
    majorHead: head?.code ?? row.headId,
    lineItems: [],
    approvalTrail: [],
  };
}
