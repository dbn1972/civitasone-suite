import { pgSchema, uuid, varchar, integer, timestamp, bigint } from "drizzle-orm/pg-core";

const domainSchema = pgSchema("loyalty");

export const enrolments = domainSchema.table("enrolments", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  programId: uuid("program_id").notNull(),
  profileId: uuid("profile_id").notNull(),
  tier: varchar("tier", { length: 50 }).notNull().default("base"),
  pointsBalance: bigint("points_balance", { mode: "bigint" }).notNull().default(BigInt(0)),
  enrolledAt: timestamp("enrolled_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type EnrolmentRow = typeof enrolments.$inferSelect;
export type EnrolmentInsert = typeof enrolments.$inferInsert;

export const schema = { enrolments };
