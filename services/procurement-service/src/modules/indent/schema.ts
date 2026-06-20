import { pgSchema, uuid, text, integer, bigint, char, varchar, timestamp, date } from "drizzle-orm/pg-core";

export const indentSchema = pgSchema("indent");

export const procurementIndents = indentSchema.table("procurement_indents", {
  id:           uuid("id").primaryKey().defaultRandom(),
  tenantId:     uuid("tenant_id").notNull(),
  indentNo:     text("indent_no").notNull(),
  department:   text("department").notNull(),
  purpose:      text("purpose").notNull(),
  totalMinor:   bigint("total_minor", { mode: "bigint" }).notNull().default(0n),
  currency:     char("currency", { length: 3 }).notNull().default("INR"),
  status:       varchar("status", { length: 24 }).notNull().default("draft"),
  indentDate:   date("indent_date").notNull().defaultNow(),
  requiredBy:   date("required_by"),
  sanctionRef:  text("sanction_ref"),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:    uuid("created_by").notNull(),
  updatedBy:    uuid("updated_by").notNull(),
  version:      integer("version").notNull().default(1),
});

export const procurementIndentItems = indentSchema.table("procurement_indent_items", {
  id:             uuid("id").primaryKey().defaultRandom(),
  indentId:       uuid("indent_id").notNull(),
  tenantId:       uuid("tenant_id").notNull(),
  itemCode:       text("item_code").notNull(),
  description:    text("description").notNull(),
  quantity:       integer("quantity").notNull().default(1),
  unit:           varchar("unit", { length: 32 }).notNull().default("nos"),
  unitPriceMinor: bigint("unit_price_minor", { mode: "bigint" }).notNull().default(0n),
  currency:       char("currency", { length: 3 }).notNull().default("INR"),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:      uuid("created_by").notNull(),
  updatedBy:      uuid("updated_by").notNull(),
  version:        integer("version").notNull().default(1),
});

export type IndentRow    = typeof procurementIndents.$inferSelect;
export type IndentInsert = typeof procurementIndents.$inferInsert;
export type IndentItemRow    = typeof procurementIndentItems.$inferSelect;
export type IndentItemInsert = typeof procurementIndentItems.$inferInsert;

export const schema = { procurementIndents, procurementIndentItems };
