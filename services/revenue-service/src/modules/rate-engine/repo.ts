import { tenantTransaction } from "@civitasone/db";
import { cache } from "../../shared/infra.js";
import { db } from "../../shared/db.js";
import { rateHeads, rateSlabs, penaltyRules, rebateRules } from "./schema.js";
import { eq, and } from "drizzle-orm";
import { SERVICE } from "../../topics.js";

export async function listRateHeads(tenantId: string) {
  return cache.getOrLoad(`${SERVICE}:${tenantId}:rate_heads`, async () => {
    return tenantTransaction(db, tenantId, async (tx) => {
      const t = tx as typeof db;
      return t.select().from(rateHeads).where(eq(rateHeads.tenantId, tenantId));
    });
  });
}

export async function listRateSlabs(tenantId: string, rateHeadId: string) {
  return cache.getOrLoad(`${SERVICE}:${tenantId}:rate_slabs:${rateHeadId}`, async () => {
    return tenantTransaction(db, tenantId, async (tx) => {
      const t = tx as typeof db;
      return t.select().from(rateSlabs).where(and(eq(rateSlabs.tenantId, tenantId), eq(rateSlabs.rateHeadId, rateHeadId)));
    });
  });
}

export async function listPenaltyRules(tenantId: string, rateHeadId: string) {
  return cache.getOrLoad(`${SERVICE}:${tenantId}:penalty_rules:${rateHeadId}`, async () => {
    return tenantTransaction(db, tenantId, async (tx) => {
      const t = tx as typeof db;
      return t.select().from(penaltyRules).where(and(eq(penaltyRules.tenantId, tenantId), eq(penaltyRules.rateHeadId, rateHeadId)));
    });
  });
}

export async function listRebateRules(tenantId: string, rateHeadId: string) {
  return cache.getOrLoad(`${SERVICE}:${tenantId}:rebate_rules:${rateHeadId}`, async () => {
    return tenantTransaction(db, tenantId, async (tx) => {
      const t = tx as typeof db;
      return t.select().from(rebateRules).where(and(eq(rebateRules.tenantId, tenantId), eq(rebateRules.rateHeadId, rateHeadId)));
    });
  });
}
