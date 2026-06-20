import {
  pgSchema, uuid, text, integer, bigint, char, varchar, date, numeric, timestamp,
} from "drizzle-orm/pg-core";

export const registerSchema = pgSchema("register");

export const assetCategories = registerSchema.table("asset_categories", {
  id:              uuid("id").primaryKey().defaultRandom(),
  tenantId:        uuid("tenant_id").notNull(),
  code:            text("code").notNull(),
  name:            text("name").notNull(),
  usefulLifeYears: integer("useful_life_years").notNull().default(5),
  depRate:         numeric("dep_rate", { precision: 8, scale: 4 }).notNull().default("20.0"),
  depMethod:       varchar("dep_method", { length: 8 }).notNull().default("SLM"),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:       uuid("created_by").notNull(),
  updatedBy:       uuid("updated_by").notNull(),
  version:         integer("version").notNull().default(1),
});

export const assetAssets = registerSchema.table("asset_assets", {
  id:              uuid("id").primaryKey().defaultRandom(),
  tenantId:        uuid("tenant_id").notNull(),
  name:            text("name").notNull(),
  code:            text("code").notNull(),
  categoryId:      uuid("category_id").notNull(),
  status:          varchar("status", { length: 24 }).notNull().default("active"),
  acquisitionCost: bigint("acquisition_cost", { mode: "bigint" }).notNull().default(0n),
  salvageValue:    bigint("salvage_value", { mode: "bigint" }).notNull().default(0n),
  usefulLifeYears: integer("useful_life_years").notNull().default(5),
  depRate:         numeric("dep_rate", { precision: 8, scale: 4 }).notNull().default("20.0"),
  depMethod:       varchar("dep_method", { length: 8 }).notNull().default("SLM"),
  currency:        char("currency", { length: 3 }).notNull().default("INR"),
  bookValue:       bigint("book_value", { mode: "bigint" }).notNull().default(0n),
  accumulatedDep:  bigint("accumulated_dep", { mode: "bigint" }).notNull().default(0n),
  acquisitionDate: date("acquisition_date").notNull(),
  poRef:           text("po_ref"),
  grnRef:          text("grn_ref"),
  location:        text("location"),
  notes:           text("notes"),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:       uuid("created_by").notNull(),
  updatedBy:       uuid("updated_by").notNull(),
  version:         integer("version").notNull().default(1),
});

export type CategoryRow    = typeof assetCategories.$inferSelect;
export type CategoryInsert = typeof assetCategories.$inferInsert;
export type AssetRow       = typeof assetAssets.$inferSelect;
export type AssetInsert    = typeof assetAssets.$inferInsert;

export const schema = { assetCategories, assetAssets };
