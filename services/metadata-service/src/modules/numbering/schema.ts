import { pgSchema, uuid, varchar, boolean, integer, bigint, timestamp } from "drizzle-orm/pg-core";

export const metadataSchema = pgSchema("metadata");

/** Tenant-scoped named reference formats (CAP-032). */
export const numberFormats = metadataSchema.table("number_formats", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  formatKey: varchar("format_key", { length: 128 }).notNull(),
  label: varchar("label", { length: 256 }).notNull(),
  prefix: varchar("prefix", { length: 32 }).notNull().default(""),
  embedFinancialYear: boolean("embed_financial_year").notNull().default(true),
  fyStartMonth: integer("fy_start_month").notNull().default(4),
  counterWidth: integer("counter_width").notNull().default(6),
  separator: varchar("separator", { length: 4 }).notNull().default("/"),
  resetPolicy: varchar("reset_policy", { length: 16 }).notNull().default("yearly"),
  status: varchar("status", { length: 16 }).notNull().default("draft"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  publishedBy: uuid("published_by"),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
});

/** Gapless per (tenant, format_key, reset-bucket) counter store. */
export const numberSequences = metadataSchema.table("number_sequences", {
  tenantId: uuid("tenant_id").notNull(),
  formatKey: varchar("format_key", { length: 128 }).notNull(),
  bucket: varchar("bucket", { length: 16 }).notNull(),
  currentValue: bigint("current_value", { mode: "bigint" }).notNull().default(0n),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
