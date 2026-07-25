import { pgSchema, uuid, varchar, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core";

export const supportSchema = pgSchema("support");

export const adminBreakGlassLog = supportSchema.table("admin_break_glass_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  ticketId: uuid("ticket_id").notNull(),
  actorId: uuid("actor_id").notNull(),
  reason: text("reason").notNull(),
  openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  correlationId: varchar("correlation_id", { length: 64 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export const adminSupportTickets = supportSchema.table("admin_support_tickets", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  subject: text("subject").notNull(),
  status: varchar("status", { length: 24 }).notNull().default("open"),
  priority: varchar("priority", { length: 16 }).notNull().default("normal"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type AdminBreakGlassLogInsert = typeof adminBreakGlassLog.$inferInsert;
export const adminDataCorrections = supportSchema.table("admin_data_corrections", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  targetTable: varchar("target_table", { length: 160 }).notNull(),
  targetId: varchar("target_id", { length: 160 }).notNull(),
  justification: text("justification").notNull(),
  proposedChange: jsonb("proposed_change").notNull(),
  ticketId: uuid("ticket_id"),
  // pending | approved | rejected
  status: varchar("status", { length: 16 }).notNull().default("pending"),
  proposedBy: uuid("proposed_by").notNull(),
  approvedBy: uuid("approved_by"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  rejectedReason: text("rejected_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type AdminDataCorrectionRow = typeof adminDataCorrections.$inferSelect;
export type AdminDataCorrectionInsert = typeof adminDataCorrections.$inferInsert;

export const schema = { adminBreakGlassLog, adminSupportTickets, adminDataCorrections };
