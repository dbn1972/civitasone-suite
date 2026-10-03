import { eq } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { uuid, varchar, boolean, integer, timestamp } from "drizzle-orm/pg-core";
import { recruitmentSchema } from "./schema.js";
import { pino } from "pino";
import { fetchTenantEdition } from "../../shared/tenant-client.js";
import { DEFAULT_POLICY, EDITIONS, editionFromTenant, requisitionRequired, type Edition, type EditionPolicy } from "./edition-policy.js";

const log = pino({ name: "recruitment-edition-policy" });

export const hrmsRecruitmentEditionPolicy = recruitmentSchema.table("hrms_recruitment_edition_policy", {
  tenantId:           uuid("tenant_id").primaryKey(),
  edition:            varchar("edition", { length: 16 }).notNull().default("small_office"),
  requireRequisition: boolean("require_requisition"),
  updatedBy:          uuid("updated_by").notNull(),
  createdAt:          timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:          timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  version:            integer("version").notNull().default(1),
});

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

function toPolicy(row: typeof hrmsRecruitmentEditionPolicy.$inferSelect | undefined): EditionPolicy {
  if (!row) return DEFAULT_POLICY;
  const edition = (EDITIONS as readonly string[]).includes(row.edition) ? (row.edition as Edition) : DEFAULT_POLICY.edition;
  return { edition, requireRequisition: row.requireRequisition };
}

export async function getPolicy(tenantId: string): Promise<EditionPolicy> {
  const rows = await scopedRead((tx) => tx.select().from(hrmsRecruitmentEditionPolicy)
    .where(eq(hrmsRecruitmentEditionPolicy.tenantId, tenantId)).limit(1));
  return toPolicy(rows[0]);
}

export interface EffectivePolicy extends EditionPolicy {
  /** "row" = an admin stored this policy; "tenant_edition" = derived from tenant.tenants.edition; "default" = unknown edition, OFF. */
  source: "row" | "tenant_edition" | "default";
  tenantEdition: string | null;
  requisitionRequired: boolean;
}

/**
 * The policy actually enforced. A stored row (explicit per-tenant choice, including its override) always wins.
 * With no row the default comes from the real tenant edition; an unreadable or unknown edition fails closed to
 * the current behaviour (not required) with a warning.
 */
export async function resolvePolicy(tenantId: string): Promise<EffectivePolicy> {
  const rows = await scopedRead((tx) => tx.select().from(hrmsRecruitmentEditionPolicy)
    .where(eq(hrmsRecruitmentEditionPolicy.tenantId, tenantId)).limit(1));
  if (rows[0]) {
    const p = toPolicy(rows[0]);
    return { ...p, source: "row", tenantEdition: null, requisitionRequired: requisitionRequired(p) };
  }
  const raw = (await fetchTenantEdition(tenantId)) ?? null;
  const mapped = editionFromTenant(raw);
  if (mapped === null) {
    log.warn({ tenantId, tenantEdition: raw }, "tenant edition unknown or unreadable; requisition-first stays OFF");
    return { ...DEFAULT_POLICY, source: "default", tenantEdition: raw, requisitionRequired: false };
  }
  const p: EditionPolicy = { edition: mapped, requireRequisition: null };
  return { ...p, source: "tenant_edition", tenantEdition: raw, requisitionRequired: requisitionRequired(p) };
}

/** Upsert (one row per tenant); the version column counts changes. */
export async function upsertPolicyTx(
  tx: Writer, tenantId: string, next: EditionPolicy, actorId: string,
): Promise<{ before: EditionPolicy; after: EditionPolicy }> {
  const existing = await (tx as typeof db).select().from(hrmsRecruitmentEditionPolicy)
    .where(eq(hrmsRecruitmentEditionPolicy.tenantId, tenantId)).limit(1);
  const before = toPolicy(existing[0]);
  if (existing[0]) {
    await tx.update(hrmsRecruitmentEditionPolicy)
      .set({ edition: next.edition, requireRequisition: next.requireRequisition, updatedBy: actorId, updatedAt: new Date(), version: existing[0].version + 1 })
      .where(eq(hrmsRecruitmentEditionPolicy.tenantId, tenantId));
  } else {
    await tx.insert(hrmsRecruitmentEditionPolicy).values({
      tenantId, edition: next.edition, requireRequisition: next.requireRequisition, updatedBy: actorId,
    }).onConflictDoUpdate({
      target: hrmsRecruitmentEditionPolicy.tenantId,
      set: { edition: next.edition, requireRequisition: next.requireRequisition, updatedBy: actorId, updatedAt: new Date() },
    });
  }
  return { before, after: next };
}
