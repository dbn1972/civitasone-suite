import { uuid, varchar, integer, numeric, text, timestamp, date } from "drizzle-orm/pg-core";
import { recruitmentSchema } from "./schema.js";

export const hrmsSelectionLists = recruitmentSchema.table("hrms_selection_lists", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  jobOpeningId:  uuid("job_opening_id").notNull(),
  title:         varchar("title", { length: 256 }).notNull(),
  vacancies:     integer("vacancies").notNull(),
  status:        varchar("status", { length: 16 }).notNull().default("draft"),
  validityUntil: date("validity_until"),
  createdBy:     uuid("created_by").notNull(),
  entriesSetBy:  uuid("entries_set_by"),
  entriesSetAt:  timestamp("entries_set_at", { withTimezone: true }),
  approvedBy:    uuid("approved_by"),
  approvedAt:    timestamp("approved_at", { withTimezone: true }),
  publishedAt:   timestamp("published_at", { withTimezone: true }),
  updatedBy:     uuid("updated_by").notNull(),
  version:       integer("version").notNull().default(1),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const hrmsSelectionListEntries = recruitmentSchema.table("hrms_selection_list_entries", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  listId:        uuid("list_id").notNull(),
  applicationId: uuid("application_id").notNull(),
  candidateName: varchar("candidate_name", { length: 256 }).notNull(),
  category:      varchar("category", { length: 16 }).notNull(),
  rank:          integer("rank").notNull(),
  score:         numeric("score", { precision: 8, scale: 2 }),
  remarks:       text("remarks"),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SelectionListRow = typeof hrmsSelectionLists.$inferSelect;
export type SelectionListInsert = typeof hrmsSelectionLists.$inferInsert;
export type SelectionEntryRow = typeof hrmsSelectionListEntries.$inferSelect;
export type SelectionEntryInsert = typeof hrmsSelectionListEntries.$inferInsert;

export const schema = { hrmsSelectionLists, hrmsSelectionListEntries };
