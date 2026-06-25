import { pgSchema, uuid, text, integer, varchar, timestamp } from "drizzle-orm/pg-core";

export const opinionsSchema = pgSchema("opinions");

export const legalOpinions = opinionsSchema.table("legal_opinions", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  caseId:      uuid("case_id"),
  opinionNo:   text("opinion_no").notNull(),
  subject:     text("subject").notNull(),
  question:    text("question").notNull(),
  soughtBy:    text("sought_by"),
  counselName: text("counsel_name"),
  opinionText: text("opinion_text"),
  status:      varchar("status", { length: 24 }).notNull().default("sought"),
  soughtAt:    timestamp("sought_at", { withTimezone: true }).notNull().defaultNow(),
  draftedAt:   timestamp("drafted_at", { withTimezone: true }),
  issuedAt:    timestamp("issued_at", { withTimezone: true }),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:   uuid("created_by").notNull(),
  updatedBy:   uuid("updated_by").notNull(),
  version:     integer("version").notNull().default(1),
});

export type OpinionRow = typeof legalOpinions.$inferSelect;
export type OpinionInsert = typeof legalOpinions.$inferInsert;
export const schema = { legalOpinions };
