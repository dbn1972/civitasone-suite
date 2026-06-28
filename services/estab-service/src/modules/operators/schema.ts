import {
  pgSchema, uuid, text, integer, boolean, timestamp,
} from "drizzle-orm/pg-core";

export const filesSchema = pgSchema("files");

export const estabFileOperator = filesSchema.table("estab_file_operator", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  employeeId:  uuid("employee_id").notNull(),
  division:    text("division").notNull(),
  section:     text("section"),
  deskRole:    text("desk_role").notNull().default("dealing_hand"),
  canInitiate: boolean("can_initiate").notNull().default(true),
  active:      boolean("active").notNull().default(true),
  assignedBy:  uuid("assigned_by").notNull(),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:   uuid("created_by").notNull(),
  updatedBy:   uuid("updated_by").notNull(),
  version:     integer("version").notNull().default(1),
});

export type OperatorRow = typeof estabFileOperator.$inferSelect;
export type OperatorInsert = typeof estabFileOperator.$inferInsert;

export const schema = { estabFileOperator };
