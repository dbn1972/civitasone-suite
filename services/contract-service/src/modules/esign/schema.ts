import { pgSchema, uuid, text, integer, varchar, timestamp, jsonb } from "drizzle-orm/pg-core";

export const esignSchema = pgSchema("esign");

/**
 * Signatory entry within the e-sign route's JSONB array.
 */
export interface SignatoryEntry {
  userId: string;
  ordinal: number;
  deadlineDays: number; // 1–30 calendar days
  status: "pending" | "signed" | "overdue";
  signedAt: string | null; // ISO timestamp or null
}

/**
 * E-sign routing table.
 *
 * Manages sequential signature routing for contracts.
 * Signatories sign in ordinal order; only the current ordinal can sign.
 */
export const esignRoutes = esignSchema.table("esign_routes", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").notNull(),
  contractId:     uuid("contract_id").notNull(),
  signatories:    jsonb("signatories").$type<SignatoryEntry[]>().notNull(),
  currentOrdinal: integer("current_ordinal").notNull().default(1),
  status:         varchar("status", { length: 24 }).notNull().default("in_progress"),
  ownerId:        uuid("owner_id").notNull(),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:      uuid("created_by").notNull(),
  updatedBy:      uuid("updated_by").notNull(),
  version:        integer("version").notNull().default(1),
});

export type EsignRouteRow = typeof esignRoutes.$inferSelect;
export type EsignRouteInsert = typeof esignRoutes.$inferInsert;

export const schema = { esignRoutes };
