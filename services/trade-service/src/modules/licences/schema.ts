import { pgSchema, uuid, varchar, integer, timestamp, jsonb, text } from "drizzle-orm/pg-core";

export const tradeSchema = pgSchema("trade");

export const tradeLicences = tradeSchema.table("trade_licences", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  applicationId: uuid("application_id").notNull(),
  licenceNumber: varchar("licence_number", { length: 64 }).notNull().unique(),
  status: varchar("status", { length: 32 }).notNull().default("active"),
  tradeCategory: varchar("trade_category", { length: 64 }).notNull(),
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

export const licenceActions = tradeSchema.table("licence_actions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  licenceId: uuid("licence_id").notNull(),
  actionType: varchar("action_type", { length: 32 }).notNull(),
  reason: text("reason"),
  effectiveFrom: timestamp("effective_from", { withTimezone: true }),
  noticeDetails: jsonb("notice_details").$type<Record<string, unknown>>(),
  performedBy: uuid("performed_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  version: integer("version").notNull().default(1),
});

export type TradeLicenceRow = typeof tradeLicences.$inferSelect;
export type TradeLicenceInsert = typeof tradeLicences.$inferInsert;
export type LicenceActionRow = typeof licenceActions.$inferSelect;
export type LicenceActionInsert = typeof licenceActions.$inferInsert;

export const schema = { tradeLicences, licenceActions };
