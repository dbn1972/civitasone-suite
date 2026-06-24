import { pgSchema, uuid, varchar, text, integer, timestamp, boolean } from "drizzle-orm/pg-core";

export const exportsSchema = pgSchema("exports");

export const auditExports = exportsSchema.table("exports", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").notNull(),
  periodFrom:     timestamp("period_from", { withTimezone: true }).notNull(),
  periodTo:       timestamp("period_to", { withTimezone: true }).notNull(),
  format:         varchar("format", { length: 16 }).notNull().default("json"),
  signedUrl:      text("signed_url"),
  retentionUntil: timestamp("retention_until", { withTimezone: true }),
  // P1-5 worker metadata
  rowCount:       integer("row_count"),
  includesPii:    boolean("includes_pii").notNull().default(false),
  downloadToken:  text("download_token"),
  expiresAt:      timestamp("expires_at", { withTimezone: true }),
  error:          text("error"),
  requestedRoles: text("requested_roles"),
  status:         varchar("status", { length: 24 }).notNull().default("pending"),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:      uuid("created_by").notNull(),
  updatedBy:      uuid("updated_by").notNull(),
  version:        integer("version").notNull().default(1),
});

export type ExportRow    = typeof auditExports.$inferSelect;
export type ExportInsert = typeof auditExports.$inferInsert;

export const exportsModuleSchema = { auditExports };
