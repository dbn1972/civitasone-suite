import { pgSchema, uuid, text, integer, varchar, timestamp } from "drizzle-orm/pg-core";

export const noticesSchema = pgSchema("notices");

export const legalNotices = noticesSchema.table("legal_notices", {
  id:        uuid("id").primaryKey().defaultRandom(),
  tenantId:  uuid("tenant_id").notNull(),
  noticeNo:  text("notice_no").notNull(),
  subject:   text("subject").notNull(),
  partyRef:  text("party_ref").notNull(),
  direction: varchar("direction", { length: 16 }).notNull(),
  status:    varchar("status", { length: 24 }).notNull().default("open"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version:   integer("version").notNull().default(1),
});

export const legalNoticeResponses = noticesSchema.table("legal_notice_responses", {
  id:           uuid("id").primaryKey().defaultRandom(),
  tenantId:     uuid("tenant_id").notNull(),
  noticeId:     uuid("notice_id").notNull(),
  responseBody: text("response_body").notNull(),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:    uuid("created_by").notNull(),
  updatedBy:    uuid("updated_by").notNull(),
  version:      integer("version").notNull().default(1),
});

export type NoticeRow = typeof legalNotices.$inferSelect;
export const schema = { legalNotices, legalNoticeResponses };
