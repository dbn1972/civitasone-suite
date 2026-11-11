/**
 * DDO master write path (UAT b24). Until now only GET /v1/finance/ddo existed and the one writer (the
 * finance.masters.ddo_sync consumer) had no producer, so no tenant could create a DDO and every
 * finance.bill.create dead-lettered UNKNOWN_DDO after a 202. These are synchronous, audited, tenant-scoped
 * writes (RLS: the request hook runs the transaction under the tenant GUC), like the vendor master.
 */
import { and, eq, sql } from "drizzle-orm";
import type { RequestContext } from "@civitasone/types";
import { hasAnyRole } from "@civitasone/auth";
import { HttpError } from "../../shared/context.js";
import { db, scopedRead } from "../../shared/db.js";
import { recordAudit } from "../../shared/audit-event.js";
import { assertValidDdoCode, PfmsValidationError } from "../../shared/pfms.js";
import { financePfmsConfig } from "../pfms/schema.js";
import * as pfmsRepo from "../pfms/repo.js";
import * as mastersRepo from "./repo.js";
import { financeDdo, financePao, type DdoRow } from "./schema.js";

export function normaliseDdoCode(raw: string): string {
  const code = raw.trim().toUpperCase();
  try {
    assertValidDdoCode(code);
  } catch (e) {
    if (e instanceof PfmsValidationError) {
      throw new HttpError(422, "INVALID_DDO_CODE", "DDO code must be 6-12 letters or digits (PFMS format)", [
        { field: "ddoCode", message: "Use 6 to 12 letters or digits, for example DDO000001.", code: "INVALID_DDO_CODE" },
      ]);
    }
    throw e;
  }
  return code;
}

type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function assertPaoOrNull(tx: DbTx, tenantId: string, paoCode: string | null | undefined): Promise<string | null> {
  if (!paoCode) return null;
  const code = paoCode.trim().toUpperCase();
  const rows = await tx.select({ id: financePao.id }).from(financePao)
    .where(and(eq(financePao.tenantId, tenantId), eq(financePao.paoCode, code), eq(financePao.isActive, true))).limit(1);
  if (rows.length === 0) {
    throw new HttpError(422, "UNKNOWN_PAO", `PAO ${code} is not in this tenant's PAO master`, [
      { field: "paoCode", message: "This PAO is not set up for your office.", code: "UNKNOWN_PAO" },
    ]);
  }
  return code;
}

/** Upsert payments.finance_pfms_config.default_ddo inside the caller's tx. agency_code is NOT NULL, so a first row needs one. */
async function upsertDefaultDdoTx(tx: DbTx, ctx: RequestContext, defaultDdo: string, agencyCode: string | undefined): Promise<void> {
  const tenantId = ctx.tenantId;
  const cur = await tx.select().from(financePfmsConfig).where(eq(financePfmsConfig.tenantId, tenantId)).limit(1);
  if (cur[0]) {
    // agency_code is a payment-routing field: it is only ever SET here (no row yet), or changed by an admin, audited.
    const changing = !!agencyCode && agencyCode !== cur[0].agencyCode;
    if (changing && !hasAnyRole(ctx, ["finance_admin", "super_admin"])) {
      throw new HttpError(409, "AGENCY_CODE_ALREADY_SET", "this tenant's PFMS agency code is already set; only a finance administrator can change it");
    }
    await tx.update(financePfmsConfig)
      .set({ defaultDdo, ...(changing ? { agencyCode } : {}), updatedAt: new Date() })
      .where(eq(financePfmsConfig.tenantId, tenantId));
    if (changing) {
      await recordAudit(tx, ctx, {
        action: "pfms_agency_code_change", resourceType: "pfms_config", resourceId: tenantId,
        details: { oldAgencyCode: cur[0].agencyCode, newAgencyCode: agencyCode },
      });
    }
    return;
  }
  if (!agencyCode) {
    throw new HttpError(422, "AGENCY_CODE_REQUIRED", "this tenant has no PFMS configuration yet; supply the PFMS agency code to set the default DDO", [
      { field: "agencyCode", message: "Enter the PFMS agency code.", code: "AGENCY_CODE_REQUIRED" },
    ]);
  }
  await tx.insert(financePfmsConfig).values({ tenantId, agencyCode, defaultDdo });
}

export async function createDdo(
  ctx: RequestContext,
  input: { ddoCode: string; name: string; paoCode?: string | null | undefined; makeDefault?: boolean | undefined; agencyCode?: string | undefined },
): Promise<DdoRow> {
  const ddoCode = normaliseDdoCode(input.ddoCode);
  return db.transaction(async (tx) => {
    const paoCode = await assertPaoOrNull(tx, ctx.tenantId, input.paoCode);
    const dup = await tx.select({ id: financeDdo.id }).from(financeDdo)
      .where(and(eq(financeDdo.tenantId, ctx.tenantId), eq(financeDdo.ddoCode, ddoCode))).limit(1);
    if (dup.length > 0) throw new HttpError(409, "DDO_EXISTS", `DDO ${ddoCode} already exists for this tenant`);
    const rows = await tx.insert(financeDdo).values({
      tenantId: ctx.tenantId, ddoCode, name: input.name.trim(), paoCode, isActive: true,
      createdBy: ctx.actorId, updatedBy: ctx.actorId,
    }).returning();
    const row = rows[0];
    if (!row) throw new Error("DDO_INSERT_FAILED: insert returned no row");
    if (input.makeDefault) await upsertDefaultDdoTx(tx, ctx, ddoCode, input.agencyCode);
    await recordAudit(tx, ctx, {
      action: "ddo_create", resourceType: "ddo", resourceId: row.id,
      details: { ddoCode, paoCode, makeDefault: !!input.makeDefault },
    });
    return row;
  });
}

export async function updateDdo(
  ctx: RequestContext, id: string,
  patch: { name?: string | undefined; paoCode?: string | null | undefined; isActive?: boolean | undefined },
): Promise<DdoRow> {
  return db.transaction(async (tx) => {
    const cur = (await tx.select().from(financeDdo)
      .where(and(eq(financeDdo.tenantId, ctx.tenantId), eq(financeDdo.id, id))).limit(1))[0];
    if (!cur) throw new HttpError(404, "NOT_FOUND", "DDO not found");
    if (patch.isActive === false && cur.isActive) {
      const cfg = (await tx.select().from(financePfmsConfig).where(eq(financePfmsConfig.tenantId, ctx.tenantId)).limit(1))[0];
      if (cfg?.defaultDdo?.toUpperCase() === cur.ddoCode.toUpperCase()) {
        throw new HttpError(409, "DDO_IS_DEFAULT", `DDO ${cur.ddoCode} is the tenant default; choose another default DDO before deactivating it`);
      }
    }
    const paoCode = patch.paoCode === undefined ? cur.paoCode : await assertPaoOrNull(tx, ctx.tenantId, patch.paoCode);
    const rows = await tx.update(financeDdo).set({
      name: patch.name?.trim() ?? cur.name, paoCode, isActive: patch.isActive ?? cur.isActive,
      updatedBy: ctx.actorId, updatedAt: new Date(), version: sql`${financeDdo.version} + 1`,
    }).where(and(eq(financeDdo.tenantId, ctx.tenantId), eq(financeDdo.id, id))).returning();
    const row = rows[0]!;
    await recordAudit(tx, ctx, {
      action: patch.isActive === false ? "ddo_deactivate" : "ddo_update", resourceType: "ddo", resourceId: id,
      details: { ddoCode: cur.ddoCode, fields: Object.keys(patch) },
    });
    return row;
  });
}

/** Set the tenant PFMS-config defaultDdo to an existing, active DDO of this tenant. */
export async function setDefaultDdo(ctx: RequestContext, input: { defaultDdo: string; agencyCode?: string | undefined }) {
  const code = normaliseDdoCode(input.defaultDdo);
  return db.transaction(async (tx) => {
    const ddo = await tx.select({ id: financeDdo.id }).from(financeDdo)
      .where(and(eq(financeDdo.tenantId, ctx.tenantId), eq(financeDdo.ddoCode, code), eq(financeDdo.isActive, true))).limit(1);
    if (ddo.length === 0) {
      throw new HttpError(422, "DDO_NOT_CONFIGURED", `DDO ${code} is not set up for this tenant; create it under Masters > DDO first`);
    }
    await upsertDefaultDdoTx(tx, ctx, code, input.agencyCode);
    await recordAudit(tx, ctx, { action: "pfms_default_ddo_set", resourceType: "pfms_config", resourceId: ctx.tenantId, details: { defaultDdo: code } });
    return { defaultDdo: code };
  });
}

/**
 * Bill-route pre-check: resolve the DDO exactly as the finance.bill.create consumer does (payload, then
 * FINANCE_DEFAULT_DDO_CODE, then the tenant PFMS config defaultDdo, then DDO000001) and refuse with a 422 when
 * it is not an active DDO of the tenant, instead of a 202 that dead-letters UNKNOWN_DDO in the worker.
 */
export async function assertBillDdoConfigured(tenantId: string, payloadDdo: string | null | undefined): Promise<string> {
  let resolved = payloadDdo || undefined;
  if (!resolved) {
    const cfg = await pfmsRepo.getTenantConfig(tenantId);
    resolved = process.env.FINANCE_DEFAULT_DDO_CODE ?? cfg?.defaultDdo ?? "DDO000001";
  }
  const code = resolved.toUpperCase();
  // scopedRead: RLS needs the tenant GUC, which a bare db read does not carry.
  if (!(await scopedRead((tx) => mastersRepo.ddoExists(tenantId, code, tx as never)))) {
    throw new HttpError(
      422, "DDO_NOT_CONFIGURED",
      `DDO ${code} is not set up for your office. Ask a finance or tenant administrator to create it under Masters > DDO (and set the default DDO) before lodging bills.`,
      [{ field: "ddoCode", message: `DDO ${code} is not set up for your office yet.`, code: "DDO_NOT_CONFIGURED" }],
    );
  }
  return code;
}
