import { tenantTransaction } from "@civitasone/db";
import { and, eq, desc, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { rateHeads, rateSlabs, penaltyRules, rebateRules, configProposals } from "../rate-engine/schema.js";
import type { ConfigState } from "./domain.js";

type Reader = Pick<typeof db, "select">;

const dateStr = (v: unknown): string => (typeof v === "string" ? v : String(v));
const dateOrNull = (v: unknown): string | null => (v == null ? null : dateStr(v));

/**
 * The tenant's rate configuration as the planner sees it (all heads, slabs,
 * penalty and rebate rules). Reads through a caller-supplied handle so the
 * approval consumer can read inside its own transaction (TX-001: never open a
 * second connection from inside a consumer transaction).
 */
export async function loadConfigStateTx(tx: Reader, tenantId: string): Promise<ConfigState> {
  const heads = await tx.select().from(rateHeads).where(eq(rateHeads.tenantId, tenantId));
  const slabs = await tx.select().from(rateSlabs).where(eq(rateSlabs.tenantId, tenantId));
  const penalties = await tx.select().from(penaltyRules).where(eq(penaltyRules.tenantId, tenantId));
  const rebates = await tx.select().from(rebateRules).where(eq(rebateRules.tenantId, tenantId));
  return {
    heads: heads.map((h) => ({
      id: h.id, code: h.code, name: h.name, category: h.category, unitOfMeasure: h.unitOfMeasure ?? null,
      isActive: h.isActive, effectiveTo: dateOrNull(h.effectiveTo), version: h.version,
    })),
    slabs: slabs.map((s) => ({
      id: s.id, rateHeadId: s.rateHeadId, slabType: s.slabType as "flat", bandFrom: s.bandFrom ?? null, bandTo: s.bandTo ?? null,
      rateValue: s.rateValue, effectiveFrom: dateStr(s.effectiveFrom), effectiveTo: dateOrNull(s.effectiveTo), isActive: s.isActive, version: s.version,
    })),
    penalties: penalties.map((r) => ({
      id: r.id, rateHeadId: r.rateHeadId, interestType: r.interestType as "simple", annualRateBps: r.annualRateBps, graceDays: r.graceDays,
      capMonths: r.capMonths ?? null, roundingMode: r.roundingMode as "floor", isActive: r.isActive,
      effectiveFrom: dateStr(r.effectiveFrom), effectiveTo: dateOrNull(r.effectiveTo), version: r.version,
    })),
    rebates: rebates.map((r) => ({
      id: r.id, rateHeadId: r.rateHeadId, rebateType: r.rebateType as "early_payment", discountBps: r.discountBps,
      validUntilDaysBeforeDue: r.validUntilDaysBeforeDue ?? null, isActive: r.isActive,
      effectiveFrom: dateStr(r.effectiveFrom), effectiveTo: dateOrNull(r.effectiveTo), version: r.version,
    })),
  };
}

export async function loadConfigState(tenantId: string): Promise<ConfigState> {
  return tenantTransaction(db, tenantId, async (tx) => loadConfigStateTx(tx as typeof db, tenantId));
}

export async function findProposalById(tenantId: string, id: string) {
  const rows = await tenantTransaction(db, tenantId, async (tx) => {
    const t = tx as typeof db;
    return t.select().from(configProposals).where(and(eq(configProposals.tenantId, tenantId), eq(configProposals.id, id))).limit(1);
  });
  return rows[0] ?? null;
}

export async function listProposals(
  tenantId: string,
  opts: { status?: string; kind?: string; limit: number; offset: number },
) {
  return tenantTransaction(db, tenantId, async (tx) => {
    const t = tx as typeof db;
    const conds = [eq(configProposals.tenantId, tenantId)];
    if (opts.status) conds.push(eq(configProposals.status, opts.status));
    if (opts.kind) conds.push(eq(configProposals.kind, opts.kind));
    const where = and(...conds);
    const rows = await t.select().from(configProposals).where(where).orderBy(desc(configProposals.createdAt)).limit(opts.limit).offset(opts.offset);
    const counted = await t.select({ n: sql<number>`count(*)::int` }).from(configProposals).where(where);
    return { rows: rows ?? [], total: Number(counted[0]?.n ?? 0) };
  });
}
