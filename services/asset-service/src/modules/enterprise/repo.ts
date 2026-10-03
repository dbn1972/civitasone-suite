import { eq, and, asc, inArray, ne, sql } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import {
  projectAuc, assetLeases, assetImpairments, functionalLocations, spareParts,
  assetScanLog, assetSettings, assetSettingRequests, leaseScheduleRows,
} from "./schema.js";
import { assetAssets } from "../register/schema.js";
import { assetWorkOrders } from "../maintenance/schema.js";
import { pgSchema, uuid, text, varchar, date, bigint, char, timestamp } from "drizzle-orm/pg-core";

const lifecycleSchema = pgSchema("lifecycle");

export const pendingDisposals = lifecycleSchema.table("pending_disposals", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").notNull(),
  assetId:        uuid("asset_id").notNull(),
  disposalDate:   date("disposal_date").notNull(),
  disposalMethod: varchar("disposal_method", { length: 32 }).notNull(),
  proceedsMinor:  bigint("proceeds_minor", { mode: "bigint" }).notNull().default(0n),
  currency:       char("currency", { length: 3 }).notNull().default("INR"),
  notes:          text("notes"),
  workflowStatus: varchar("workflow_status", { length: 24 }).notNull().default("pending"),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:      uuid("created_by").notNull(),
});

export const interOrgTransfers = lifecycleSchema.table("inter_org_transfers", {
  id:           uuid("id").primaryKey().defaultRandom(),
  tenantId:     uuid("tenant_id").notNull(),
  assetId:      uuid("asset_id").notNull(),
  fromOrg:      varchar("from_org", { length: 64 }).notNull(),
  toOrg:        varchar("to_org", { length: 64 }).notNull(),
  transferDate: date("transfer_date").notNull(),
  notes:        text("notes"),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:    uuid("created_by").notNull(),
});

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function findAssetByBarcode(tenantId: string, barcode: string) {
  // scopedRead() so wrapWithTenantGuc injects app.tenant_id before this
  // read — a bare db.select() runs with no RLS GUC set.
  const rows = await scopedRead((tx) => tx.select().from(assetAssets)
    .where(and(eq(assetAssets.tenantId, tenantId), eq(assetAssets.barcode, barcode))).limit(1));
  return rows[0] ?? null;
}

/** Asset codes from `codes` that already exist in the tenant's register (GAP-ASSETS-BULK-IMPORT-03). */
export async function findExistingCodes(tenantId: string, codes: string[]): Promise<string[]> {
  if (codes.length === 0) return [];
  const rows = await scopedRead((tx) => tx.select({ code: assetAssets.code }).from(assetAssets)
    .where(and(eq(assetAssets.tenantId, tenantId), inArray(assetAssets.code, codes))));
  return rows.map((r) => r.code);
}

/** True when a bulk batch with this id has already been committed for the tenant (retry detection). */
export async function bulkBatchExists(tenantId: string, batchId: string): Promise<boolean> {
  const rows = await scopedRead((tx) => tx.select({ id: assetAssets.id }).from(assetAssets)
    .where(and(eq(assetAssets.tenantId, tenantId), eq(assetAssets.notes, `bulk:${batchId}`))).limit(1));
  return rows.length > 0;
}

export async function listAuc(tenantId: string, limit = 500) {
  // scopedRead() so wrapWithTenantGuc injects app.tenant_id before this
  // read — a bare db.select() runs with no RLS GUC set.
  return scopedRead((tx) => tx.select().from(projectAuc).where(eq(projectAuc.tenantId, tenantId)).limit(limit));
}

export async function insertAuc(tx: Writer, row: typeof projectAuc.$inferInsert) {
  await tx.insert(projectAuc).values(row);
}

export async function findAucById(id: string, tenantId: string) {
  // scopedRead() so wrapWithTenantGuc injects app.tenant_id before this
  // read — a bare db.select() runs with no RLS GUC set.
  const rows = await scopedRead((tx) => tx.select().from(projectAuc).where(and(eq(projectAuc.id, id), eq(projectAuc.tenantId, tenantId))).limit(1));
  return rows[0] ?? null;
}

/**
 * Atomic capitalize guard: flips under_construction -> capitalized in one conditional
 * UPDATE and reports whether THIS call won, so a double click / replay creates one asset.
 */
export async function claimAucForCapitalize(tx: Writer, id: string, tenantId: string, assetId: string, actor: string): Promise<boolean> {
  const rows = await tx.update(projectAuc).set({ status: "capitalized", assetId, updatedBy: actor, updatedAt: new Date() })
    .where(and(eq(projectAuc.id, id), eq(projectAuc.tenantId, tenantId), eq(projectAuc.status, "under_construction")))
    .returning({ id: projectAuc.id });
  return rows.length > 0;
}

/**
 * GAP-ASSETS-PROJECTS-09: capitalisation is a two-step maker != checker action.
 * Each transition is ONE conditional UPDATE ... RETURNING, so concurrent or replayed
 * decisions cannot both win and the checker can never be the maker.
 */
export async function requestAucCapitalization(
  tx: Writer, id: string, tenantId: string, actor: string, capitalizationDate: string, reason: string,
): Promise<boolean> {
  const rows = await tx.update(projectAuc).set({
    status: "pending_capitalization", capitalizationDate, capRequestedBy: actor, capRequestedAt: new Date(),
    capReason: reason, capRejectReason: null, updatedBy: actor, updatedAt: new Date(),
  }).where(and(eq(projectAuc.id, id), eq(projectAuc.tenantId, tenantId), eq(projectAuc.status, "under_construction")))
    .returning({ id: projectAuc.id });
  return rows.length > 0;
}

/** Checker approves: only a pending row, and only by someone other than the requester. */
export async function approveAucCapitalization(
  tx: Writer, id: string, tenantId: string, assetId: string, actor: string,
) {
  const rows = await tx.update(projectAuc).set({
    status: "capitalized", assetId, capDecidedBy: actor, capDecidedAt: new Date(), updatedBy: actor, updatedAt: new Date(),
  }).where(and(
    eq(projectAuc.id, id), eq(projectAuc.tenantId, tenantId),
    eq(projectAuc.status, "pending_capitalization"), ne(projectAuc.capRequestedBy, actor),
  )).returning();
  return rows[0] ?? null;
}

export async function rejectAucCapitalization(
  tx: Writer, id: string, tenantId: string, actor: string, reason: string,
): Promise<boolean> {
  const rows = await tx.update(projectAuc).set({
    status: "under_construction", capDecidedBy: actor, capDecidedAt: new Date(), capRejectReason: reason,
    updatedBy: actor, updatedAt: new Date(),
  }).where(and(eq(projectAuc.id, id), eq(projectAuc.tenantId, tenantId), eq(projectAuc.status, "pending_capitalization")))
    .returning({ id: projectAuc.id });
  return rows.length > 0;
}

/** Direct (single-actor) capitalisation, used only when the tenant has switched maker-checker off. */
export async function claimAucDirect(
  tx: Writer, id: string, tenantId: string, assetId: string, actor: string, capitalizationDate: string, reason: string,
) {
  const rows = await tx.update(projectAuc).set({
    status: "capitalized", assetId, capitalizationDate, capRequestedBy: actor, capRequestedAt: new Date(), capReason: reason,
    capDecidedBy: actor, capDecidedAt: new Date(), updatedBy: actor, updatedAt: new Date(),
  }).where(and(eq(projectAuc.id, id), eq(projectAuc.tenantId, tenantId), eq(projectAuc.status, "under_construction")))
    .returning();
  return rows[0] ?? null;
}

/** Per-tenant asset policy; no row means the defaults (maker-checker ON). */
export async function getAssetSettings(tenantId: string) {
  const rows = await scopedRead((tx) => tx.select().from(assetSettings).where(eq(assetSettings.tenantId, tenantId)).limit(1));
  return rows[0] ?? null;
}

export async function getAssetSettingsTx(tx: Writer, tenantId: string) {
  const rows = await tx.select().from(assetSettings).where(eq(assetSettings.tenantId, tenantId)).limit(1);
  return rows[0] ?? null;
}

export type AssetSettingsPatch = {
  capitalizeMakerChecker?: boolean;
  glMakerChecker?: boolean;
  cwipAccountCode?: string | null;
  fixedAssetAccountCode?: string | null;
  impairmentExpenseAccountCode?: string | null;
  revaluationReserveAccountCode?: string | null;
  grnClearingAccountCode?: string | null;
  acquisitionOffsetAccountCode?: string | null;
  maintenanceExpenseAccountCode?: string | null;
  apControlAccountCode?: string | null;
  rouAccountCode?: string | null;
  leaseLiabilityAccountCode?: string | null;
  leaseOffsetAccountCode?: string | null;
};

export async function upsertAssetSettings(tx: Writer, tenantId: string, actor: string, patch: AssetSettingsPatch): Promise<void> {
  const fields: AssetSettingsPatch = {};
  if (patch.capitalizeMakerChecker !== undefined) fields.capitalizeMakerChecker = patch.capitalizeMakerChecker;
  if (patch.glMakerChecker !== undefined) fields.glMakerChecker = patch.glMakerChecker;
  if (patch.cwipAccountCode !== undefined) fields.cwipAccountCode = patch.cwipAccountCode;
  if (patch.fixedAssetAccountCode !== undefined) fields.fixedAssetAccountCode = patch.fixedAssetAccountCode;
  if (patch.impairmentExpenseAccountCode !== undefined) fields.impairmentExpenseAccountCode = patch.impairmentExpenseAccountCode;
  if (patch.revaluationReserveAccountCode !== undefined) fields.revaluationReserveAccountCode = patch.revaluationReserveAccountCode;
  if (patch.grnClearingAccountCode !== undefined) fields.grnClearingAccountCode = patch.grnClearingAccountCode;
  if (patch.acquisitionOffsetAccountCode !== undefined) fields.acquisitionOffsetAccountCode = patch.acquisitionOffsetAccountCode;
  if (patch.maintenanceExpenseAccountCode !== undefined) fields.maintenanceExpenseAccountCode = patch.maintenanceExpenseAccountCode;
  if (patch.apControlAccountCode !== undefined) fields.apControlAccountCode = patch.apControlAccountCode;
  if (patch.rouAccountCode !== undefined) fields.rouAccountCode = patch.rouAccountCode;
  if (patch.leaseLiabilityAccountCode !== undefined) fields.leaseLiabilityAccountCode = patch.leaseLiabilityAccountCode;
  if (patch.leaseOffsetAccountCode !== undefined) fields.leaseOffsetAccountCode = patch.leaseOffsetAccountCode;
  await (tx as typeof db).insert(assetSettings).values({ tenantId, updatedBy: actor, ...fields }).onConflictDoUpdate({
    target: assetSettings.tenantId,
    set: { ...fields, updatedBy: actor, updatedAt: new Date(), version: sql`${assetSettings.version} + 1` },
  });
}

/** One pending "maker-checker OFF" request per tenant (unique partial index); false when one is already pending. */
export async function insertSettingRequest(tx: Writer, row: typeof assetSettingRequests.$inferInsert): Promise<boolean> {
  const rows = await tx.insert(assetSettingRequests).values(row).onConflictDoNothing().returning({ id: assetSettingRequests.id });
  return rows.length > 0;
}

export async function getPendingSettingRequest(tenantId: string, kind = "maker_checker_off") {
  const rows = await scopedRead((tx) => tx.select().from(assetSettingRequests)
    .where(and(eq(assetSettingRequests.tenantId, tenantId), eq(assetSettingRequests.kind, kind), eq(assetSettingRequests.status, "pending"))).limit(1));
  return rows[0] ?? null;
}

/** Every pending request of the tenant (any kind), oldest first. */
export async function listPendingSettingRequests(tenantId: string) {
  return scopedRead((tx) => tx.select().from(assetSettingRequests)
    .where(and(eq(assetSettingRequests.tenantId, tenantId), eq(assetSettingRequests.status, "pending")))
    .orderBy(asc(assetSettingRequests.requestedAt), asc(assetSettingRequests.id)));
}

/**
 * Serialise settings writes per tenant: make sure the settings row exists, then lock it (FOR UPDATE) for the rest of the
 * transaction. Everything that merges, validates and applies a settings change runs behind this lock, so two concurrent
 * saves cannot each validate against a stale row. Returns the locked, current row.
 */
export async function lockAssetSettings(tx: Writer, tenantId: string, actor: string) {
  await (tx as typeof db).insert(assetSettings).values({ tenantId, updatedBy: actor }).onConflictDoNothing();
  const rows = await (tx as typeof db).select().from(assetSettings).where(eq(assetSettings.tenantId, tenantId)).limit(1).for("update");
  return rows[0]!;
}

/** A pending request read under lock, so approve / reject of the same request serialise. */
export async function findSettingRequestForUpdate(tx: Writer, tenantId: string, id: string) {
  const rows = await (tx as typeof db).select().from(assetSettingRequests)
    .where(and(eq(assetSettingRequests.tenantId, tenantId), eq(assetSettingRequests.id, id))).limit(1).for("update");
  return rows[0] ?? null;
}

export async function findSettingRequest(tenantId: string, id: string) {
  const rows = await scopedRead((tx) => tx.select().from(assetSettingRequests)
    .where(and(eq(assetSettingRequests.tenantId, tenantId), eq(assetSettingRequests.id, id))).limit(1));
  return rows[0] ?? null;
}

/** Checker decision: only a pending request, and (for approval) only by someone other than the requester. */
export async function decideSettingRequest(
  tx: Writer, tenantId: string, id: string, actor: string, decision: "approved" | "rejected", reason: string | null,
) {
  const conds = [eq(assetSettingRequests.tenantId, tenantId), eq(assetSettingRequests.id, id), eq(assetSettingRequests.status, "pending")];
  if (decision === "approved") conds.push(ne(assetSettingRequests.requestedBy, actor));
  const rows = await tx.update(assetSettingRequests).set({ status: decision, decidedBy: actor, decidedAt: new Date(), decisionReason: reason })
    .where(and(...conds)).returning();
  return rows[0] ?? null;
}

/** Journal sent to finance: remember its id so finance.gl.posted / finance.gl.rejected can find the record. */
export async function setAucGlPending(tx: Writer, id: string, tenantId: string, journalId: string): Promise<void> {
  await tx.update(projectAuc).set({ glPostStatus: "pending", glJournalId: journalId, glPostError: null })
    .where(and(eq(projectAuc.id, id), eq(projectAuc.tenantId, tenantId)));
}

export async function findAucByIdTx(tx: Writer, tenantId: string, id: string) {
  const rows = await tx.select().from(projectAuc).where(and(eq(projectAuc.id, id), eq(projectAuc.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}

export async function findLeaseByIdTx(tx: Writer, tenantId: string, id: string) {
  const rows = await tx.select().from(assetLeases).where(and(eq(assetLeases.id, id), eq(assetLeases.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}

/** Repost: failed -> pending in ONE conditional UPDATE (a double click wins once). True only for the winner. */
export async function repostAucJournal(tx: Writer, tenantId: string, id: string, journalId: string): Promise<boolean> {
  const rows = await tx.update(projectAuc).set({ glPostStatus: "pending", glJournalId: journalId, glPostError: null })
    .where(and(eq(projectAuc.id, id), eq(projectAuc.tenantId, tenantId), eq(projectAuc.status, "capitalized"), eq(projectAuc.glPostStatus, "failed")))
    .returning({ id: projectAuc.id });
  return rows.length > 0;
}

export async function repostLeaseJournal(tx: Writer, tenantId: string, id: string, journalId: string): Promise<boolean> {
  const rows = await tx.update(assetLeases).set({ glPostStatus: "pending", glJournalId: journalId, glPostError: null })
    .where(and(eq(assetLeases.id, id), eq(assetLeases.tenantId, tenantId), eq(assetLeases.glPostStatus, "failed")))
    .returning({ id: assetLeases.id });
  return rows.length > 0;
}

export async function setAucGlFailed(tx: Writer, id: string, tenantId: string, error: string): Promise<void> {
  await tx.update(projectAuc).set({ glPostStatus: "failed", glPostError: error.slice(0, 500) })
    .where(and(eq(projectAuc.id, id), eq(projectAuc.tenantId, tenantId)));
}

export async function setLeaseGlFailed(tx: Writer, id: string, tenantId: string, error: string): Promise<void> {
  await tx.update(assetLeases).set({ glPostStatus: "failed", glPostError: error.slice(0, 500) })
    .where(and(eq(assetLeases.id, id), eq(assetLeases.tenantId, tenantId)));
}

/**
 * Finance answered for journal `journalId`: pending -> posted | failed on whichever record (AUC or lease) owns it.
 * Conditional on `pending`, so a replayed event is a no-op. Returns which record changed (null = not ours / replay).
 */
export async function resolveGlJournal(
  tx: Writer, tenantId: string, journalId: string, outcome: "posted" | "failed", error: string | null,
): Promise<{ kind: "auc" | "lease" | "asset" | "work_order"; id: string } | null> {
  const set = { glPostStatus: outcome, glPostError: error ? error.slice(0, 500) : null };
  const auc = await tx.update(projectAuc).set(set)
    .where(and(eq(projectAuc.tenantId, tenantId), eq(projectAuc.glJournalId, journalId), eq(projectAuc.glPostStatus, "pending")))
    .returning({ id: projectAuc.id });
  if (auc[0]) return { kind: "auc", id: auc[0].id };
  const lease = await tx.update(assetLeases).set(set)
    .where(and(eq(assetLeases.tenantId, tenantId), eq(assetLeases.glJournalId, journalId), eq(assetLeases.glPostStatus, "pending")))
    .returning({ id: assetLeases.id });
  if (lease[0]) return { kind: "lease", id: lease[0].id };
  const asset = await tx.update(assetAssets).set(set)
    .where(and(eq(assetAssets.tenantId, tenantId), eq(assetAssets.glJournalId, journalId), eq(assetAssets.glPostStatus, "pending")))
    .returning({ id: assetAssets.id });
  if (asset[0]) return { kind: "asset", id: asset[0].id };
  const wo = await tx.update(assetWorkOrders).set(set)
    .where(and(eq(assetWorkOrders.tenantId, tenantId), eq(assetWorkOrders.glJournalId, journalId), eq(assetWorkOrders.glPostStatus, "pending")))
    .returning({ id: assetWorkOrders.id });
  return wo[0] ? { kind: "work_order", id: wo[0].id } : null;
}

// ── deferred journals (fp-assets-02): records saved while the GL accounts were not configured ──
export type GlOpenStatus = "awaiting_accounts" | "failed";

/**
 * Set a record's journal state. `expect` makes it CONDITIONAL on the state the caller saw: a sweep that selected a row as
 * awaiting_accounts / failed can never overwrite a row that has meanwhile become pending or posted (finance's answer).
 * Returns true only when a row was actually updated; callers enqueue the journal only then. With no `expect` (the
 * consumers that have just INSERTED the record) it is unconditional.
 */
export async function setAssetGl(
  tx: Writer, tenantId: string, id: string, status: "none" | "awaiting_accounts" | "pending", journalId: string | null, error: string | null,
  expect?: readonly string[],
): Promise<boolean> {
  const conds = [eq(assetAssets.id, id), eq(assetAssets.tenantId, tenantId)];
  if (expect) conds.push(inArray(assetAssets.glPostStatus, [...expect]));
  const rows = await tx.update(assetAssets).set({ glPostStatus: status, glJournalId: journalId, glPostError: error ? error.slice(0, 500) : null })
    .where(and(...conds)).returning({ id: assetAssets.id });
  return rows.length > 0;
}

export async function setWorkOrderGl(
  tx: Writer, tenantId: string, id: string, status: "none" | "awaiting_accounts" | "pending", journalId: string | null, error: string | null,
  expect?: readonly string[],
): Promise<boolean> {
  const conds = [eq(assetWorkOrders.id, id), eq(assetWorkOrders.tenantId, tenantId)];
  if (expect) conds.push(inArray(assetWorkOrders.glPostStatus, [...expect]));
  const rows = await tx.update(assetWorkOrders).set({ glPostStatus: status, glJournalId: journalId, glPostError: error ? error.slice(0, 500) : null })
    .where(and(...conds)).returning({ id: assetWorkOrders.id });
  return rows.length > 0;
}

/**
 * Deferred / rejected assets whose journal CAN be built now. Eligibility is decided in SQL (a GRN asset needs the GRN
 * clearing head, a direct one the acquisition offset, both the fixed-asset head; cost > 0), so a blocked row can never
 * occupy the window and starve later rows. Rows are locked FOR UPDATE SKIP LOCKED: two overlapping sweeps never pick the
 * same row.
 */
export async function findAssetsGlOpen(
  tx: Writer, tenantId: string, statuses: readonly GlOpenStatus[], limit: number,
  ready: { direct: boolean; grn: boolean },
) {
  if (!ready.direct && !ready.grn) return [];
  const isGrn = sql`left(${assetAssets.grnRef}, 16) = 'procurement_grn:'`;
  const kindOk = ready.direct && ready.grn ? sql`true` : ready.grn ? isGrn : sql`NOT COALESCE(${isGrn}, false)`;
  return (tx as typeof db).select().from(assetAssets)
    .where(and(
      eq(assetAssets.tenantId, tenantId), inArray(assetAssets.glPostStatus, [...statuses]),
      sql`${assetAssets.acquisitionCost} > 0`, kindOk,
    ))
    .orderBy(asc(assetAssets.createdAt), asc(assetAssets.id)).limit(limit)
    .for("update", { skipLocked: true });
}

export async function findWorkOrdersGlOpen(tx: Writer, tenantId: string, statuses: readonly GlOpenStatus[], limit: number, ready: boolean) {
  if (!ready) return [];
  return (tx as typeof db).select().from(assetWorkOrders)
    .where(and(
      eq(assetWorkOrders.tenantId, tenantId), inArray(assetWorkOrders.glPostStatus, [...statuses]),
      sql`${assetWorkOrders.costMinor} > 0`, sql`${assetWorkOrders.completedDate} IS NOT NULL`,
    ))
    .orderBy(asc(assetWorkOrders.createdAt), asc(assetWorkOrders.id)).limit(limit)
    .for("update", { skipLocked: true });
}

/** Counts shown on the settings screen: records waiting for accounts, and journals finance rejected. */
export async function countGlOpen(tenantId: string) {
  const one = async (table: typeof assetAssets | typeof assetWorkOrders, status: string) => {
    const rows = await scopedRead((tx) => tx.select({ n: sql<number>`count(*)::int` }).from(table)
      .where(and(eq(table.tenantId, tenantId), eq(table.glPostStatus, status))));
    return rows[0]?.n ?? 0;
  };
  return {
    assetsAwaiting: await one(assetAssets, "awaiting_accounts"),
    assetsFailed: await one(assetAssets, "failed"),
    workOrdersAwaiting: await one(assetWorkOrders, "awaiting_accounts"),
    workOrdersFailed: await one(assetWorkOrders, "failed"),
  };
}

export async function insertScanLog(tx: Writer, row: typeof assetScanLog.$inferInsert) {
  await tx.insert(assetScanLog).values(row);
}

export async function insertLeaseScheduleRows(tx: Writer, rows: (typeof leaseScheduleRows.$inferInsert)[]) {
  if (rows.length) await tx.insert(leaseScheduleRows).values(rows);
}

export async function listLeaseSchedule(tenantId: string, leaseId: string) {
  return scopedRead((tx) => tx.select().from(leaseScheduleRows)
    .where(and(eq(leaseScheduleRows.tenantId, tenantId), eq(leaseScheduleRows.leaseId, leaseId)))
    .orderBy(asc(leaseScheduleRows.seq)));
}

export async function findLeaseById(tenantId: string, id: string) {
  const rows = await scopedRead((tx) => tx.select().from(assetLeases)
    .where(and(eq(assetLeases.id, id), eq(assetLeases.tenantId, tenantId))).limit(1));
  return rows[0] ?? null;
}

export async function findLocationByIdTx(tx: Writer, tenantId: string, id: string) {
  const rows = await tx.select().from(functionalLocations)
    .where(and(eq(functionalLocations.id, id), eq(functionalLocations.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}

export async function updateAuc(tx: Writer, id: string, patch: Partial<typeof projectAuc.$inferInsert>) {
  await tx.update(projectAuc).set({ ...patch, updatedAt: new Date() }).where(eq(projectAuc.id, id));
}

export async function insertLease(tx: Writer, row: typeof assetLeases.$inferInsert) {
  await tx.insert(assetLeases).values(row);
}

export async function listLeases(tenantId: string, limit = 500) {
  // scopedRead() so wrapWithTenantGuc injects app.tenant_id before this
  // read — a bare db.select() runs with no RLS GUC set.
  return scopedRead((tx) => tx.select().from(assetLeases).where(eq(assetLeases.tenantId, tenantId)).limit(limit));
}

export async function insertImpairment(tx: Writer, row: typeof assetImpairments.$inferInsert) {
  await tx.insert(assetImpairments).values(row);
}

export async function listImpairments(tenantId: string, assetId: string, limit = 500) {
  // scopedRead() so wrapWithTenantGuc injects app.tenant_id before this
  // read — a bare db.select() runs with no RLS GUC set.
  return scopedRead((tx) => tx.select().from(assetImpairments).where(and(eq(assetImpairments.tenantId, tenantId), eq(assetImpairments.assetId, assetId))).limit(limit));
}

export async function listLocations(tenantId: string, limit = 100, offset = 0, activeOnly = false) {
  // scopedRead() so wrapWithTenantGuc injects app.tenant_id before this
  // read — a bare db.select() runs with no RLS GUC set.
  const conds = [eq(functionalLocations.tenantId, tenantId)];
  if (activeOnly) conds.push(eq(functionalLocations.isActive, true));
  return scopedRead((tx) => tx.select().from(functionalLocations).where(and(...conds))
    .orderBy(asc(functionalLocations.code), asc(functionalLocations.id)).limit(limit).offset(offset));
}

/**
 * GAP-ASSETS-LOCATIONS-02: flip is_active in ONE conditional UPDATE so a double click /
 * replay is a no-op for the loser. Deactivation is refused (in the caller) while an active child exists.
 */
export async function setLocationActive(
  tx: Writer, tenantId: string, id: string, active: boolean, actor: string,
): Promise<boolean> {
  const rows = await tx.update(functionalLocations).set(
    active ? { isActive: true, deactivatedAt: null, deactivatedBy: null }
           : { isActive: false, deactivatedAt: new Date(), deactivatedBy: actor },
  ).where(and(
    eq(functionalLocations.id, id), eq(functionalLocations.tenantId, tenantId), eq(functionalLocations.isActive, !active),
  )).returning({ id: functionalLocations.id });
  return rows.length > 0;
}

export async function countActiveChildren(tx: Writer, tenantId: string, id: string): Promise<number> {
  const rows = await tx.select({ n: sql<number>`count(*)::int` }).from(functionalLocations)
    .where(and(eq(functionalLocations.tenantId, tenantId), eq(functionalLocations.parentId, id), eq(functionalLocations.isActive, true)));
  return rows[0]?.n ?? 0;
}

/** Number of assets pointing at this location (read-only, for the deactivate confirm copy). */
export async function countAssetsAtLocation(tenantId: string, id: string): Promise<number> {
  const rows = await scopedRead((tx) => tx.select({ n: sql<number>`count(*)::int` }).from(assetAssets)
    .where(and(eq(assetAssets.tenantId, tenantId), eq(assetAssets.locationId, id))));
  return rows[0]?.n ?? 0;
}


export async function insertLocation(tx: Writer, row: typeof functionalLocations.$inferInsert) {
  await tx.insert(functionalLocations).values(row);
}

export async function findLocationByCode(tenantId: string, code: string) {
  const rows = await scopedRead((tx) => tx.select().from(functionalLocations)
    .where(and(eq(functionalLocations.tenantId, tenantId), eq(functionalLocations.code, code))).limit(1));
  return rows[0] ?? null;
}

export async function findLocationById(tenantId: string, id: string) {
  const rows = await scopedRead((tx) => tx.select().from(functionalLocations)
    .where(and(eq(functionalLocations.id, id), eq(functionalLocations.tenantId, tenantId))).limit(1));
  return rows[0] ?? null;
}

/** GAP-ASSETS-LOCATIONS-02: name / org unit only -- the code is immutable (assets may reference it). */
export async function updateLocation(
  tx: Writer, tenantId: string, id: string, patch: { name?: string; orgUnit?: string | null },
) {
  await tx.update(functionalLocations).set(patch)
    .where(and(eq(functionalLocations.id, id), eq(functionalLocations.tenantId, tenantId)));
}

export async function insertSparePart(tx: Writer, row: typeof spareParts.$inferInsert) {
  await tx.insert(spareParts).values(row);
}

export async function insertPendingDisposal(tx: Writer, row: typeof pendingDisposals.$inferInsert) {
  await tx.insert(pendingDisposals).values(row);
}

export async function findPendingDisposal(id: string, tenantId: string) {
  // scopedRead() so wrapWithTenantGuc injects app.tenant_id before this
  // read — a bare db.select() runs with no RLS GUC set.
  const rows = await scopedRead((tx) => tx.select().from(pendingDisposals).where(and(eq(pendingDisposals.id, id), eq(pendingDisposals.tenantId, tenantId))).limit(1));
  return rows[0] ?? null;
}

/**
 * Tx-scoped variant of findPendingDisposal -- see findAssetByIdTx in
 * register/repo.ts for the full rationale (section 1 of the
 * production-readiness-audit skill). Note this pendingDisposals table is the
 * enterprise-module one (lifecycleSchema.pending_disposals), a distinct
 * table from the unrelated lifecycle-module pendingDisposals of the same
 * name -- do not confuse with findPendingDisposalByIdTx in lifecycle/repo.ts.
 */
export async function findPendingDisposalTx(tx: Writer, id: string, tenantId: string) {
  const rows = await tx.select().from(pendingDisposals).where(and(eq(pendingDisposals.id, id), eq(pendingDisposals.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}

export async function updatePendingDisposal(tx: Writer, id: string, status: string) {
  await tx.update(pendingDisposals).set({ workflowStatus: status }).where(eq(pendingDisposals.id, id));
}

export async function insertInterOrgTransfer(tx: Writer, row: typeof interOrgTransfers.$inferInsert) {
  await tx.insert(interOrgTransfers).values(row);
}

export async function bulkInsertAssets(tx: Writer, rows: (typeof assetAssets.$inferInsert)[]) {
  if (rows.length) await tx.insert(assetAssets).values(rows);
}

export async function listPendingDisposals(tenantId: string, limit = 200) {
  return scopedRead((tx) => tx.select().from(pendingDisposals)
    .where(eq(pendingDisposals.tenantId, tenantId)).limit(limit));
}
