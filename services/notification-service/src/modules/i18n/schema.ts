import { pgSchema, uuid, varchar, text, boolean, integer, timestamp } from "drizzle-orm/pg-core";

export const i18nSchema = pgSchema("i18n");

export const localeVariants = i18nSchema.table("locale_variants", {
  id:         uuid("id").primaryKey().defaultRandom(),
  tenantId:   uuid("tenant_id").notNull(),
  templateId: uuid("template_id").notNull(),
  locale:     varchar("locale", { length: 35 }).notNull(),
  subject:    text("subject"),
  body:       text("body").notNull(),
  status:     varchar("status", { length: 24 }).notNull().default("current"),
  createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:  uuid("created_by").notNull(),
  updatedBy:  uuid("updated_by").notNull(),
  version:    integer("version").notNull().default(1),
});

export type LocaleVariantRow = typeof localeVariants.$inferSelect;
export type LocaleVariantInsert = typeof localeVariants.$inferInsert;

export const i18nModuleSchema = { localeVariants };
