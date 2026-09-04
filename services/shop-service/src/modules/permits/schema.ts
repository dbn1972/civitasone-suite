import { pgSchema, uuid, varchar, integer, timestamp, jsonb, text } from "drizzle-orm/pg-core";

export const shopSchema = pgSchema("shop");

export const permits = shopSchema.table("permits", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  applicationId: uuid("application_id").notNull(),
  permitNumber: varchar("permit_number", { length: 64 }).notNull().unique(),
  establishmentName: varchar("establishment_name", { length: 256 }).notNull(),
  permitStatus: varchar("permit_status", { length: 32 }).notNull().default("active"),
  issuedAt: timestamp("issued_at", { withTimezone: true }),
  validFrom: timestamp("valid_from", { withTimezone: true }),
  validUntil: timestamp("valid_until", { withTimezone: true }),
  suspendedAt: timestamp("suspended_at", { withTimezone: true }),
  suspensionReason: text("suspension_reason"),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  cancellationReason: text("cancellation_reason"),
  verificationCode: varchar("verification_code", { length: 64 }).notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export const permitActions = shopSchema.table("permit_actions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  permitId: uuid("permit_id").notNull(),
  actionType: varchar("action_type", { length: 32 }).notNull(),
  reason: text("reason"),
  effectiveFrom: timestamp("effective_from", { withTimezone: true }),
  noticeDetails: jsonb("notice_details").$type<Record<string, unknown>>(),
  performedBy: uuid("performed_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  version: integer("version").notNull().default(1),
});

// Public, cross-tenant verification directory (migration 0003). Deliberately
// NOT declared under `shop.permits`'s FORCE RLS: GET /v1/shop/permits/verify
// is unauthenticated (a citizen looks up a permit with no tenant context), and
// a read against the FORCE-RLS table with no app.tenant_id GUC silently
// returns zero rows for every code, forever -- see the migration header for
// the full story and services/trade-service/src/modules/licences/schema.ts's
// tradeLicenceDirectory for the established pattern this mirrors. Carries
// ONLY already-public permit facts; no owner/PII columns.
export const permitDirectory = shopSchema.table("permit_directory", {
  verificationCode: varchar("verification_code", { length: 64 }).primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  permitId: uuid("permit_id").notNull(),
  permitNumber: varchar("permit_number", { length: 64 }).notNull(),
  establishmentName: varchar("establishment_name", { length: 256 }).notNull(),
  permitStatus: varchar("permit_status", { length: 32 }).notNull(),
  issuedAt: timestamp("issued_at", { withTimezone: true }),
  validFrom: timestamp("valid_from", { withTimezone: true }),
  validUntil: timestamp("valid_until", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PermitRow = typeof permits.$inferSelect;
export type PermitInsert = typeof permits.$inferInsert;
export type PermitActionRow = typeof permitActions.$inferSelect;
export type PermitActionInsert = typeof permitActions.$inferInsert;
export type PermitDirectoryRow = typeof permitDirectory.$inferSelect;
export type PermitDirectoryInsert = typeof permitDirectory.$inferInsert;

export const schema = { permits, permitActions, permitDirectory };
