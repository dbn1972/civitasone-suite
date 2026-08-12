import { pgSchema, uuid, varchar, timestamp, text, boolean } from "drizzle-orm/pg-core";

const domainSchema = pgSchema("document");

export const daks = domainSchema.table("daks", {
  id:           uuid("id").primaryKey(),
  tenantId:     uuid("tenant_id").notNull(),
  fileId:       uuid("file_id"),
  subject:      varchar("subject", { length: 500 }).notNull(),
  body:         text("body"),
  priority:     varchar("priority", { length: 32 }).notNull().default("normal"),
  status:       varchar("status", { length: 32 }).notNull().default("pending"),
  assignedTo:   uuid("assigned_to"),
  forwardedBy:  uuid("forwarded_by"),
  forwardedAt:  timestamp("forwarded_at", { withTimezone: true }),
  acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
  dueDate:      timestamp("due_date", { withTimezone: true }),
  createdBy:    uuid("created_by").notNull(),
  updatedBy:    uuid("updated_by").notNull(),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const notings = domainSchema.table("notings", {
  id:        uuid("id").primaryKey(),
  tenantId:  uuid("tenant_id").notNull(),
  dakId:     uuid("dak_id").notNull(),
  body:      text("body").notNull(),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const approvals = domainSchema.table("approvals", {
  id:          uuid("id").primaryKey(),
  tenantId:    uuid("tenant_id").notNull(),
  dakId:       uuid("dak_id").notNull(),
  decision:    varchar("decision", { length: 32 }),
  remarks:     text("remarks"),
  decidedBy:   uuid("decided_by"),
  decidedAt:   timestamp("decided_at", { withTimezone: true }),
  status:      varchar("status", { length: 32 }).notNull().default("pending"),
  createdBy:   uuid("created_by").notNull(),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type DakRow      = typeof daks.$inferSelect;
export type DakInsert   = typeof daks.$inferInsert;
export type NotingRow   = typeof notings.$inferSelect;
export type ApprovalRow = typeof approvals.$inferSelect;

export type DakView = {
  id:              string;
  tenantId:        string;
  fileId:          string | null;
  subject:         string;
  body:            string | null;
  priority:        string;
  status:          string;
  assignedTo:      string | null;
  dueDate:         Date | null;
  createdAt:       Date;
  updatedAt:       Date;
};

export const schema = { daks, notings, approvals };
