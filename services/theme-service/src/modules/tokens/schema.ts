import { pgSchema, uuid, varchar, text, integer, timestamp } from "drizzle-orm/pg-core";

export const themeSchema = pgSchema("theme");

export const tokens = themeSchema.table("tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  name: varchar("name", { length: 128 }).notNull(),
  value: varchar("value", { length: 512 }).notNull(),
  category: varchar("category", { length: 64 }),
  status: varchar("status", { length: 24 }).notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type TokenRow = typeof tokens.$inferSelect;
export type TokenInsert = typeof tokens.$inferInsert;

export type TokenView = {
  id: string;
  tenantId: string;
  name: string;
  value: string;
  category: string | null;
  status: string;
  version: number;
};

export const brandConfig = themeSchema.table("brand_config", {
  tenantId:        uuid("tenant_id").primaryKey(),
  appName:         text("app_name").notNull().default("CivitasOne"),
  tagline:         text("tagline"),
  logoUrl:         text("logo_url"),
  logoDarkUrl:     text("logo_dark_url"),
  faviconUrl:      text("favicon_url"),
  loginBgUrl:      text("login_bg_url"),
  footerText:      text("footer_text"),
  poweredBy:       text("powered_by").default("Powered by CivitasOne"),
  colorPrimary:    text("color_primary").notNull().default("#1e40af"),
  colorPrimaryFg:  text("color_primary_fg").notNull().default("#ffffff"),
  colorSecondary:  text("color_secondary").notNull().default("#64748b"),
  colorAccent:     text("color_accent").notNull().default("#f59e0b"),
  colorBackground: text("color_background").notNull().default("#ffffff"),
  colorSurface:    text("color_surface").notNull().default("#f8fafc"),
  colorBorder:     text("color_border").notNull().default("#e2e8f0"),
  colorText:       text("color_text").notNull().default("#1e293b"),
  colorMuted:      text("color_muted").notNull().default("#64748b"),
  colorSuccess:    text("color_success").notNull().default("#16a34a"),
  colorWarning:    text("color_warning").notNull().default("#d97706"),
  colorError:      text("color_error").notNull().default("#dc2626"),
  fontFamily:      text("font_family").notNull().default("Inter, system-ui, sans-serif"),
  fontFamilyMono:  text("font_family_mono").notNull().default("JetBrains Mono, monospace"),
  sidebarStyle:    text("sidebar_style").notNull().default("default"),
  headerStyle:     text("header_style").notNull().default("default"),
  borderRadius:    text("border_radius").notNull().default("0.5rem"),
  customCss:       text("custom_css"),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:       uuid("created_by").notNull(),
  updatedBy:       uuid("updated_by").notNull(),
  version:         integer("version").notNull().default(1),
});

export const brandPresets = themeSchema.table("brand_presets", {
  id:              uuid("id").primaryKey().defaultRandom(),
  code:            text("code").notNull().unique(),
  name:            text("name").notNull(),
  description:     text("description"),
  colorPrimary:    text("color_primary").notNull(),
  colorSecondary:  text("color_secondary").notNull(),
  colorAccent:     text("color_accent").notNull(),
  colorBackground: text("color_background").notNull().default("#ffffff"),
  colorSurface:    text("color_surface").notNull().default("#f8fafc"),
  fontFamily:      text("font_family").notNull().default("Inter, system-ui, sans-serif"),
  sidebarStyle:    text("sidebar_style").notNull().default("default"),
  previewUrl:      text("preview_url"),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type BrandConfigRow = typeof brandConfig.$inferSelect;
export type BrandConfigInsert = typeof brandConfig.$inferInsert;
export type BrandPresetRow = typeof brandPresets.$inferSelect;

export const schema = { tokens, brandConfig, brandPresets };
