import { and, desc, eq, ne, sql } from "drizzle-orm";
import type { RequestContext } from "@civitasone/types";
import { HttpError } from "../../shared/context.js";
import { db, scopedRead } from "../../shared/db.js";
import type { Actor, Tx } from "../../shared/finance-command.js";
import * as repo from "./repo.js";
import { recordAudit } from "../../shared/audit-event.js";
import { readPolicyWith } from "./policy.js";
import {
  financeVendors, financeVendorBankChanges,
  type VendorRow, type VendorBankChangeRow,
} from "./schema.js";
import type { VendorWriteInput } from "./repo.js";
import { maskAccountNo, maskPan } from "./vendor-mask.js";

/**
 * Vendor onboarding and bank-detail change are fraud control points
 * (GAP-FINANCE-VENDORS-01 / GAP-FINANCE-VENDORS-DETAIL-04):
 *  - with the tenant's vendor_maker_checker policy ON (the default) a new vendor
 *    starts 'pending' and a DIFFERENT user must approve it; until then it cannot
 *    transact (is_active = false, so the bill and PFMS vendor checks refuse it);
 *  - changing a vendor's bank details is a request (maker) that a different
 *    user (checker) decides; the live bank details only change on approval.
 * Every transition is ONE conditional UPDATE (WHERE pins the source status and,
 * when the policy is on, created_by/proposed_by <> actor) inside a transaction
 * that also appends the audit.event.record outbox row, so a lost race or a
 * replay writes neither a second state change nor a second audit event.
 */

export type BankChangeInput = { bankName: string; bankAccount: string; ifsc: string; reason: string };
export type VendorField = "pan" | "bankAccount" | "phone" | "email";

function violation(what: string): HttpError {
  return new HttpError(409, "MAKER_CHECKER_VIOLATION", `${what}: the same user cannot both make and approve this change`);
}

/** Create a vendor: 'pending' under maker-checker, 'active' when the tenant switched it off. Audited. */
export async function createVendor(ctx: RequestContext, input: VendorWriteInput): Promise<VendorRow> {
  return db.transaction(async (tx) => {
    const policy = await readPolicyWith(tx, ctx.tenantId);
    const status = policy.vendorMakerChecker ? "pending" : "active";
    const rows = await tx.insert(financeVendors).values({
      tenantId: ctx.tenantId,
      ...input,
      status,
      isActive: status === "active",
      version: 1,
      createdBy: ctx.actorId,
      updatedBy: ctx.actorId,
    }).returning();
    const row = rows[0];
    if (!row) throw new Error("VENDOR_INSERT_FAILED: insert returned no row");
    await recordAudit(tx, ctx, {
      action: "vendor_create", resourceType: "vendor", resourceId: row.id,
      details: { status, makerChecker: policy.vendorMakerChecker },
    });
    return row;
  });
}

/**
 * Consumer side of vendor approve / reject: ONE conditional UPDATE (WHERE pins status = pending, the version the
 * checker reviewed and, for approve with the policy on, created_by <> actor) + the audit event, inside the
 * caller's transaction.
 */
export async function decideVendor(
  tx: Tx, actor: Actor, input: { id: string; decision: "approve" | "reject"; reason?: string | undefined; expectedVersion: number },
): Promise<VendorRow> {
  const { id, decision, reason, expectedVersion } = input;
  const policy = await readPolicyWith(tx, actor.tenantId);
  const now = new Date();
  const set = decision === "approve"
    ? { status: "active", isActive: true, approvedBy: actor.actorId, approvedAt: now, decisionReason: reason ?? null }
    : { status: "rejected", isActive: false, approvedBy: null, approvedAt: null, decisionReason: reason ?? null };
  const updated = await tx.update(financeVendors)
    .set({ ...set, updatedBy: actor.actorId, updatedAt: now, version: sql`${financeVendors.version} + 1` })
    .where(and(
      eq(financeVendors.tenantId, actor.tenantId),
      eq(financeVendors.id, id),
      eq(financeVendors.status, "pending"),
      eq(financeVendors.version, expectedVersion),
      decision === "approve" && policy.vendorMakerChecker ? ne(financeVendors.createdBy, actor.actorId) : undefined,
    ))
    .returning();
  const row = updated[0];
  if (!row) {
    const cur = (await tx.select().from(financeVendors)
      .where(and(eq(financeVendors.tenantId, actor.tenantId), eq(financeVendors.id, id))).limit(1))[0];
    if (!cur) throw new HttpError(404, "NOT_FOUND", "vendor not found");
    if (cur.status !== "pending") {
      throw new HttpError(409, "VENDOR_NOT_PENDING", `vendor is '${cur.status}', only a pending vendor can be ${decision}d`);
    }
    if (cur.version !== expectedVersion) {
      throw new HttpError(409, "VERSION_CONFLICT", "the vendor was changed after you opened it; reload and review it again");
    }
    throw violation("a vendor you created cannot be approved by you");
  }
  await recordAudit(tx, actor, {
    action: decision === "approve" ? "vendor_approve" : "vendor_reject",
    resourceType: "vendor", resourceId: id,
    details: { fromStatus: "pending", toStatus: row.status, reviewedVersion: expectedVersion, ...(reason ? { reason } : {}) },
  });
  return row;
}

/** Audited reveal of masked vendor fields. The audit event carries field names and the reason, never the values. */
export async function revealVendorFields(
  ctx: RequestContext, id: string, fields: VendorField[], reason: string,
): Promise<Partial<Record<VendorField, string | null>>> {
  return db.transaction(async (tx) => {
    const rows = await tx.select().from(financeVendors)
      .where(and(eq(financeVendors.tenantId, ctx.tenantId), eq(financeVendors.id, id))).limit(1);
    const v = rows[0];
    if (!v) throw new HttpError(404, "NOT_FOUND", "vendor not found");
    await recordAudit(tx, ctx, {
      action: "pii_reveal", resourceType: "vendor", resourceId: id, details: { fields, reason },
    });
    const out: Partial<Record<VendorField, string | null>> = {};
    for (const f of fields) {
      out[f] = f === "pan" ? v.pan : f === "bankAccount" ? v.bankAccountNo : f === "phone" ? v.phone : v.email;
    }
    return out;
  });
}

function csvCell(v: string): string {
  // spreadsheet formula injection guard: a leading = + - @ is prefixed with an apostrophe
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/**
 * Server-authoritative vendor register export (GAP-FINANCE-VENDORS-02): the audit row is written and committed BEFORE
 * the data is returned (if the audit write fails nothing is released), and the CSV is built here from the MASKED
 * list shape, so no clear PAN ever leaves. Value-returning, so it stays synchronous like the reveal endpoints.
 */
export async function exportVendorRegister(ctx: RequestContext): Promise<{ csv: string; rowCount: number }> {
  const rows = await repo.listVendors(ctx.tenantId, 5000);
  await db.transaction(async (tx) => {
    await recordAudit(tx, ctx, {
      action: "export", resourceType: "vendor_register", resourceId: ctx.tenantId, details: { rowCount: rows.length, format: "csv" },
    });
  });
  const header = ["Vendor Name", "PAN", "GSTIN", "Category", "Status"];
  const lines = rows.map((v) => [v.name, maskPan(v.pan), v.gstin ?? "Unregistered", v.category, v.status].map((c) => csvCell(String(c))).join(","));
  return { csv: [header.join(","), ...lines].join("\n"), rowCount: rows.length };
}


/** Consumer side of a bank-detail change request (maker). One open request per vendor (partial unique index -> 409). */
export async function proposeBankChange(tx: Tx, actor: Actor, input: { changeId: string; vendorId: string } & BankChangeInput): Promise<void> {
  const v = (await tx.select().from(financeVendors)
    .where(and(eq(financeVendors.tenantId, actor.tenantId), eq(financeVendors.id, input.vendorId))).limit(1))[0];
  if (!v) throw new HttpError(404, "NOT_FOUND", "vendor not found");
  if (v.status === "pending" || v.status === "rejected") {
    throw new HttpError(409, "VENDOR_NOT_APPROVED", "bank details of a vendor that is not approved are edited on the vendor, not through a change request");
  }
  const open = await tx.select({ id: financeVendorBankChanges.id }).from(financeVendorBankChanges)
    .where(and(eq(financeVendorBankChanges.tenantId, actor.tenantId), eq(financeVendorBankChanges.vendorId, input.vendorId), eq(financeVendorBankChanges.status, "pending"))).limit(1);
  if (open.length > 0) throw new HttpError(409, "BANK_CHANGE_PENDING", "a bank-detail change for this vendor is already awaiting approval");
  // The partial unique index (one open request per vendor) is the race-proof guard: two concurrent proposals both pass the
  // check above, and the loser's insert would raise a raw unique violation (a retryable DB error). ON CONFLICT DO NOTHING
  // turns it into a business 409 so the consumer dead-letters it instead of retrying.
  const inserted = await tx.insert(financeVendorBankChanges).values({
    id: input.changeId, tenantId: actor.tenantId, vendorId: input.vendorId,
    proposedBankName: input.bankName, proposedAccountNo: input.bankAccount, proposedIfsc: input.ifsc,
    reason: input.reason, proposedBy: actor.actorId,
  }).onConflictDoNothing().returning({ id: financeVendorBankChanges.id });
  if (inserted.length === 0) throw new HttpError(409, "BANK_CHANGE_PENDING", "a bank-detail change for this vendor is already awaiting approval");
  await recordAudit(tx, actor, {
    action: "bank_change_propose", resourceType: "vendor", resourceId: input.vendorId,
    details: { changeId: input.changeId, reason: input.reason, newAccountLast4: maskAccountNo(input.bankAccount).slice(-4) },
  });
}

/** Consumer side of a checker's decision; approval applies the new details to the vendor in the same transaction. */
export async function decideBankChange(
  tx: Tx, actor: Actor, input: { vendorId: string; changeId: string; decision: "approve" | "reject"; reason?: string | undefined },
): Promise<void> {
  const { vendorId, changeId, decision, reason } = input;
  // The vendor may have been rejected or deactivated since the proposal: re-check inside THIS transaction, and lock the
  // row so the new details are never applied to a vendor that is no longer in an approved state.
  const vendor = (await tx.select().from(financeVendors)
    .where(and(eq(financeVendors.tenantId, actor.tenantId), eq(financeVendors.id, vendorId))).limit(1).for("update"))[0];
  if (!vendor) throw new HttpError(404, "NOT_FOUND", "vendor not found");
  if (decision === "approve" && (vendor.status === "pending" || vendor.status === "rejected")) {
    throw new HttpError(409, "VENDOR_NOT_APPROVED", `vendor is '${vendor.status}'; a bank change cannot be applied to a vendor that is not approved`);
  }
  const policy = await readPolicyWith(tx, actor.tenantId);
  const now = new Date();
  const updated = await tx.update(financeVendorBankChanges)
    .set({
      status: decision === "approve" ? "approved" : "rejected",
      decidedBy: actor.actorId, decidedAt: now, decisionReason: reason ?? null,
      version: sql`${financeVendorBankChanges.version} + 1`,
    })
    .where(and(
      eq(financeVendorBankChanges.tenantId, actor.tenantId),
      eq(financeVendorBankChanges.id, changeId),
      eq(financeVendorBankChanges.vendorId, vendorId),
      eq(financeVendorBankChanges.status, "pending"),
      decision === "approve" && policy.vendorMakerChecker ? ne(financeVendorBankChanges.proposedBy, actor.actorId) : undefined,
    ))
    .returning();
  const row = updated[0];
  if (!row) {
    const cur = (await tx.select().from(financeVendorBankChanges)
      .where(and(eq(financeVendorBankChanges.tenantId, actor.tenantId), eq(financeVendorBankChanges.id, changeId), eq(financeVendorBankChanges.vendorId, vendorId))).limit(1))[0];
    if (!cur) throw new HttpError(404, "NOT_FOUND", "bank change request not found");
    if (cur.status !== "pending") throw new HttpError(409, "BANK_CHANGE_NOT_PENDING", `request is already ${cur.status}`);
    throw violation("a bank change you proposed cannot be approved by you");
  }
  if (decision === "approve") {
    await tx.update(financeVendors)
      .set({
        bankName: row.proposedBankName, bankAccountNo: row.proposedAccountNo, ifsc: row.proposedIfsc,
        updatedBy: actor.actorId, updatedAt: now, version: sql`${financeVendors.version} + 1`,
      })
      .where(and(eq(financeVendors.tenantId, actor.tenantId), eq(financeVendors.id, vendorId)));
  }
  await recordAudit(tx, actor, {
    action: decision === "approve" ? "bank_change_approve" : "bank_change_reject",
    resourceType: "vendor", resourceId: vendorId,
    details: { changeId, proposedBy: row.proposedBy, ...(reason ? { reason } : {}) },
  });
}

/** The open bank change for a vendor, shaped for the detail page (no clear account number). */
export async function getPendingBankChange(tenantId: string, vendorId: string) {
  const rows = await scopedRead((tx) => tx.select().from(financeVendorBankChanges)
    .where(and(
      eq(financeVendorBankChanges.tenantId, tenantId),
      eq(financeVendorBankChanges.vendorId, vendorId),
      eq(financeVendorBankChanges.status, "pending"),
    ))
    .orderBy(desc(financeVendorBankChanges.proposedAt)).limit(1));
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    proposedBy: r.proposedBy,
    proposedAt: r.proposedAt,
    bankName: r.proposedBankName,
    ifsc: r.proposedIfsc.slice(0, 4) + "XXXXXXX",
    accountMasked: maskAccountNo(r.proposedAccountNo),
    reason: r.reason,
  };
}
