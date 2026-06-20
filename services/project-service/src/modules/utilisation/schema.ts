import { pgSchema, uuid, text, integer, bigint, char, varchar, timestamp, date } from "drizzle-orm/pg-core";

export const utilisationSchema = pgSchema("utilisation");

export const projectUcStatements = utilisationSchema.table("project_uc_statements", {
  id:                 uuid("id").primaryKey().defaultRandom(),
  schemeId:           uuid("scheme_id").notNull(),
  tenantId:           uuid("tenant_id").notNull(),
  ucNo:               text("uc_no").notNull(),
  periodFrom:         date("period_from").notNull(),
  periodTo:           date("period_to").notNull(),
  releasedMinor:      bigint("released_minor", { mode: "bigint" }).notNull().default(0n),
  expenditureMinor:   bigint("expenditure_minor", { mode: "bigint" }).notNull().default(0n),
  balanceMinor:       bigint("balance_minor", { mode: "bigint" }).notNull().default(0n),
  status:             varchar("status", { length: 24 }).notNull().default("submitted"),
  submittedBy:        uuid("submitted_by").notNull(),
  submittedAt:        timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt:          timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:          timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:          uuid("created_by").notNull(),
  updatedBy:          uuid("updated_by").notNull(),
  version:            integer("version").notNull().default(1),
});

export const projectUcItems = utilisationSchema.table("project_uc_items", {
  id:                 uuid("id").primaryKey().defaultRandom(),
  ucStatementId:      uuid("uc_statement_id").notNull(),
  componentId:        uuid("component_id").notNull(),
  tenantId:           uuid("tenant_id").notNull(),
  releasedMinor:      bigint("released_minor", { mode: "bigint" }).notNull().default(0n),
  expenditureMinor:   bigint("expenditure_minor", { mode: "bigint" }).notNull().default(0n),
  currency:           char("currency", { length: 3 }).notNull().default("INR"),
  createdAt:          timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:          timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:          uuid("created_by").notNull(),
  updatedBy:          uuid("updated_by").notNull(),
  version:            integer("version").notNull().default(1),
});

export type UcStatementRow    = typeof projectUcStatements.$inferSelect;
export type UcStatementInsert = typeof projectUcStatements.$inferInsert;
export type UcItemRow         = typeof projectUcItems.$inferSelect;
export type UcItemInsert      = typeof projectUcItems.$inferInsert;

export const schema = { projectUcStatements, projectUcItems };
