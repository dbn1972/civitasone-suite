import { eq, and } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import {
  projectAuc, assetLeases, assetImpairments, functionalLocations, spareParts,
} from "./schema.js";
import { assetAssets } from "../register/schema.js";
import { pgSchema, uuid, text, varchar, date, bigint, char, timestamp, integer } from "drizzle-orm/pg-core";

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

export async function listLocations(tenantId: string, limit = 500) {
  // scopedRead() so wrapWithTenantGuc injects app.tenant_id before this
  // read — a bare db.select() runs with no RLS GUC set.
  return scopedRead((tx) => tx.select().from(functionalLocations).where(eq(functionalLocations.tenantId, tenantId)).limit(limit));
}

export async function insertLocation(tx: Writer, row: typeof functionalLocations.$inferInsert) {
  await tx.insert(functionalLocations).values(row);
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

export async function updatePendingDisposal(tx: Writer, id: string, status: string) {
  await tx.update(pendingDisposals).set({ workflowStatus: status }).where(eq(pendingDisposals.id, id));
}

export async function insertInterOrgTransfer(tx: Writer, row: typeof interOrgTransfers.$inferInsert) {
  await tx.insert(interOrgTransfers).values(row);
}

export async function bulkInsertAssets(tx: Writer, rows: (typeof assetAssets.$inferInsert)[]) {
  if (rows.length) await tx.insert(assetAssets).values(rows);
}
