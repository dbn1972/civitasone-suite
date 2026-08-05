import { pgSchema, uuid, varchar, text, integer, timestamp } from "drizzle-orm/pg-core";

export const dltSchema = pgSchema("dlt");

export const dltTemplates = dltSchema.table("dlt_templates", {
  id:           uuid("id").primaryKey().defaultRandom(),
  tenantId:     uuid("tenant_id").notNull(),
  entityId:     varchar("entity_id", { length: 32 }).notNull(),
  templateId:   varchar("template_id", { length: 32 }).notNull(),
  headerId:     varchar("header_id", { length: 16 }).notNull(),
  contentType:  varchar("content_type", { length: 16 }).notNull(),
  templateBody: text("template_body").notNull(),
  channel:      varchar("channel", { length: 16 }).notNull(),
  status:       varchar("status", { length: 16 }).notNull().default("active"),
  registeredAt: timestamp("registered_at", { withTimezone: true }),
  expiresAt:    timestamp("expires_at", { withTimezone: true }),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:    uuid("created_by").notNull(),
  updatedBy:    uuid("updated_by").notNull(),
  version:      integer("version").notNull().default(1),
});

export type DltTemplateRow = typeof dltTemplates.$inferSelect;
export type DltTemplateInsert = typeof dltTemplates.$inferInsert;

export const dltModuleSchema = { dltTemplates };
