import { pgSchema, uuid, text, integer, varchar, date, timestamp } from "drizzle-orm/pg-core";

export const rfqSchema = pgSchema("rfq");

export const procurementRfqs = rfqSchema.table("procurement_rfqs", {
  id:                uuid("id").primaryKey().defaultRandom(),
  tenantId:          uuid("tenant_id").notNull(),
  rfqNo:             text("rfq_no").notNull(),
  title:             text("title").notNull(),
  description:       text("description"),
  indentRef:         text("indent_ref"),
  vendorsInvited:    integer("vendors_invited").notNull().default(0),
  responsesReceived: integer("responses_received").notNull().default(0),
  closingDate:       date("closing_date").notNull().defaultNow(),
  status:            varchar("status", { length: 16 }).notNull().default("draft"),
  createdAt:         timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:         timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:         uuid("created_by").notNull(),
  updatedBy:         uuid("updated_by").notNull(),
  version:           integer("version").notNull().default(1),
});

export const procurementRfqItems = rfqSchema.table("procurement_rfq_items", {
  id:        uuid("id").primaryKey().defaultRandom(),
  rfqId:     uuid("rfq_id").notNull(),
  tenantId:  uuid("tenant_id").notNull(),
  itemName:  text("item_name").notNull(),
  quantity:  integer("quantity").notNull().default(1),
  unit:      varchar("unit", { length: 32 }).notNull().default("nos"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version:   integer("version").notNull().default(1),
});

export type RfqRow    = typeof procurementRfqs.$inferSelect;
export type RfqInsert = typeof procurementRfqs.$inferInsert;

export const schema = { procurementRfqs, procurementRfqItems };
