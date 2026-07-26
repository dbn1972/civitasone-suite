import { pgSchema, uuid, varchar, text, timestamp } from "drizzle-orm/pg-core";

const tenantSchema = pgSchema("tenant");

export const dataDomains = tenantSchema.table("data_domains", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  code:          varchar("code", { length: 48 }).notNull(),
  name:          varchar("name", { length: 200 }).notNull(),
  description:   text("description"),
  ownerOffice:   varchar("owner_office", { length: 160 }).notNull(),
  ownerRole:     varchar("owner_role", { length: 80 }).notNull(),
  classification: varchar("classification", { length: 16 }).notNull().default("internal"),
  effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull().defaultNow(),
  effectiveTo:   timestamp("effective_to", { withTimezone: true }),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:     uuid("created_by").notNull(),
});

export const dataStewards = tenantSchema.table("data_stewards", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  domainId:      uuid("domain_id").notNull(),
  stewardUserId: uuid("steward_user_id").notNull(),
  role:          varchar("role", { length: 24 }).notNull().default("steward"),
  assignedAt:    timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:     uuid("created_by").notNull(),
});

export const dataAssets = tenantSchema.table("data_assets", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").notNull(),
  domainId:       uuid("domain_id").notNull(),
  name:           varchar("name", { length: 200 }).notNull(),
  assetType:      varchar("asset_type", { length: 48 }).notNull(),
  classification: varchar("classification", { length: 16 }).notNull().default("internal"),
  systemOfRecord: varchar("system_of_record", { length: 120 }),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:      uuid("created_by").notNull(),
});

export type DataDomainRow = typeof dataDomains.$inferSelect;
export type DataStewardRow = typeof dataStewards.$inferSelect;
export type DataAssetRow = typeof dataAssets.$inferSelect;
export const stewardshipSchema = { dataDomains, dataStewards, dataAssets };
