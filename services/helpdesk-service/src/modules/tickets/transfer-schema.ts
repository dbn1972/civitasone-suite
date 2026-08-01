import { uuid, varchar, text, integer, timestamp } from "drizzle-orm/pg-core";
import { helpdeskSchema } from "./schema.js";

/** TKT-07 — cross-department transfer audit trail (migration 0018). */
export const ticketTransfers = helpdeskSchema.table("ticket_transfers", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  ticketId: uuid("ticket_id").notNull(),
  fromDepartment: varchar("from_department", { length: 128 }),
  toDepartment: varchar("to_department", { length: 128 }).notNull(),
  reason: text("reason").notNull(),
  transferredAt: timestamp("transferred_at", { withTimezone: true }).notNull().defaultNow(),
  transferredBy: uuid("transferred_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type TicketTransferRow = typeof ticketTransfers.$inferSelect;
export type TicketTransferInsert = typeof ticketTransfers.$inferInsert;
