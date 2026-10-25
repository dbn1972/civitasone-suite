import { pgSchema, uuid, varchar, text, integer, timestamp, boolean, primaryKey } from "drizzle-orm/pg-core";

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
  // AUD-2 tamper-evidence: content digest + detached HMAC signature over the manifest.
  contentSha256:  varchar("content_sha256", { length: 64 }),
  signature:      text("signature"),
  signedAt:       timestamp("signed_at", { withTimezone: true }),
  signingKeyId:   varchar("signing_key_id", { length: 64 }),
  signatureAlg:   varchar("signature_alg", { length: 32 }),
  status:         varchar("status", { length: 24 }).notNull().default("pending"),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:      uuid("created_by").notNull(),
  updatedBy:      uuid("updated_by").notNull(),
  version:        integer("version").notNull().default(1),
});

/**
 * Q34: one row per redeemed download token (SHA-256 of the token), so a token
 * works exactly once. PK (tenant_id, token_sha256) makes the redemption an atomic
 * INSERT ... ON CONFLICT DO NOTHING (migration 0033).
 */
export const downloadRedemptions = exportsSchema.table("download_redemptions", {
  tenantId:    uuid("tenant_id").notNull(),
  tokenSha256: varchar("token_sha256", { length: 64 }).notNull(),
  exportId:    uuid("export_id").notNull(),
  redeemedBy:  uuid("redeemed_by").notNull(),
  redeemedAt:  timestamp("redeemed_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ pk: primaryKey({ columns: [t.tenantId, t.tokenSha256] }) }));

export type ExportRow    = typeof auditExports.$inferSelect;
export type ExportInsert = typeof auditExports.$inferInsert;

export const exportsModuleSchema = { auditExports, downloadRedemptions };
