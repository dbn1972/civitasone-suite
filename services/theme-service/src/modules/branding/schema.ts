import { pgSchema, uuid, text, boolean, integer, timestamp } from "drizzle-orm/pg-core";

export const brandingSchema = pgSchema("branding");

export const tenantBranding = brandingSchema.table("tenant_branding", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  logoS3Key: text("logo_s3_key"),
  faviconS3Key: text("favicon_s3_key"),
  appName: text("app_name").notNull().default("CivitasOne"),
  primaryColor: text("primary_color").notNull().default("#1e40af"),
  accentColor: text("accent_color").notNull().default("#f59e0b"),
  footerText: text("footer_text"),
  customEmailFrom: text("custom_email_from"),
  poweredByHidden: boolean("powered_by_hidden").notNull().default(false),
  customLoginHtml: text("custom_login_html"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type TenantBrandingRow = typeof tenantBranding.$inferSelect;
export type TenantBrandingInsert = typeof tenantBranding.$inferInsert;

export type TenantBrandingView = {
  id: string;
  tenantId: string;
  logoS3Key: string | null;
  faviconS3Key: string | null;
  appName: string;
  primaryColor: string;
  accentColor: string;
  footerText: string | null;
  version: number;
};

export const schema = { tenantBranding };
