import { pgSchema, uuid, varchar, integer, timestamp, jsonb, bigint } from "drizzle-orm/pg-core";

export const domainSchema = pgSchema("loyalty");

export const programs = domainSchema.table("programs", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  status: varchar("status", { length: 24 }).notNull().default("draft"),
  earnRatio: bigint("earn_ratio", { mode: "bigint" }).notNull().default(BigInt(100)),
  expiryDays: integer("expiry_days"),
  tierConfig: jsonb("tier_config").$type<Record<string, unknown>>().notNull().default({}),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
});

export type ProgramRow = typeof programs.$inferSelect;
export type ProgramInsert = typeof programs.$inferInsert;

export const schema = { programs };
