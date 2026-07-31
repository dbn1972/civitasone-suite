import { pgSchema, uuid, varchar, integer, timestamp, bigint, jsonb } from "drizzle-orm/pg-core";

const domainSchema = pgSchema("loyalty");

export const tierDefinitions = domainSchema.table("tier_definitions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  programId: uuid("program_id").notNull(),
  name: varchar("name", { length: 100 }).notNull(),
  level: integer("level").notNull(),
  minPointsThreshold: bigint("min_points_threshold", { mode: "bigint" }).notNull().default(BigInt(0)),
  benefits: jsonb("benefits").$type<Record<string, unknown>>().notNull().default({}),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const tierAssignments = domainSchema.table("tier_assignments", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  enrolmentId: uuid("enrolment_id").notNull(),
  tierDefinitionId: uuid("tier_definition_id").notNull(),
  assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type TierDefinitionRow = typeof tierDefinitions.$inferSelect;
export type TierDefinitionInsert = typeof tierDefinitions.$inferInsert;
export type TierAssignmentRow = typeof tierAssignments.$inferSelect;
export type TierAssignmentInsert = typeof tierAssignments.$inferInsert;

export const schema = { tierDefinitions, tierAssignments };
