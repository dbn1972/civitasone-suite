import { pgSchema, uuid, varchar, boolean, integer, bigint, timestamp } from "drizzle-orm/pg-core";

export const works = pgSchema("works");

export const authorities = works.table("authorities", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  name: varchar("name", { length: 256 }).notNull(),
  code: varchar("code", { length: 64 }).notNull(),
  level: varchar("level", { length: 64 }),
  active: boolean("active").notNull().default(true),
  version: integer("version").notNull().default(1),
});

export const workTypes = works.table("work_types", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  name: varchar("name", { length: 256 }).notNull(),
  code: varchar("code", { length: 64 }).notNull(),
  active: boolean("active").notNull().default(true),
  version: integer("version").notNull().default(1),
});

export const workSubTypes = works.table("work_sub_types", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  workTypeId: uuid("work_type_id").notNull(),
  name: varchar("name", { length: 256 }).notNull(),
  code: varchar("code", { length: 64 }).notNull(),
  active: boolean("active").notNull().default(true),
  version: integer("version").notNull().default(1),
});

export const proposerTypes = works.table("proposer_types", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  name: varchar("name", { length: 256 }).notNull(),
  active: boolean("active").notNull().default(true),
  version: integer("version").notNull().default(1),
});

export const programs = works.table("programs", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  name: varchar("name", { length: 256 }).notNull(),
  active: boolean("active").notNull().default(true),
  version: integer("version").notNull().default(1),
});

export const publicationLevels = works.table("publication_levels", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  name: varchar("name", { length: 256 }).notNull(),
  active: boolean("active").notNull().default(true),
  version: integer("version").notNull().default(1),
});

export const repairTypes = works.table("repair_types", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  programId: uuid("program_id").notNull(),
  name: varchar("name", { length: 256 }).notNull(),
  active: boolean("active").notNull().default(true),
  version: integer("version").notNull().default(1),
});

export const schemes = works.table("schemes", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  name: varchar("name", { length: 256 }).notNull(),
  sponsor: varchar("sponsor", { length: 256 }),
  active: boolean("active").notNull().default(true),
  version: integer("version").notNull().default(1),
});

export const scopes = works.table("scopes", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  workTypeId: uuid("work_type_id").notNull(),
  name: varchar("name", { length: 256 }).notNull(),
  unit: varchar("unit", { length: 64 }).notNull(),
  active: boolean("active").notNull().default(true),
  version: integer("version").notNull().default(1),
});

export const tenderTypes = works.table("tender_types", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  name: varchar("name", { length: 256 }).notNull(),
  rateType: varchar("rate_type", { length: 64 }),
  active: boolean("active").notNull().default(true),
  version: integer("version").notNull().default(1),
});

export const userDepartments = works.table("user_departments", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  name: varchar("name", { length: 256 }).notNull(),
  demandNumber: varchar("demand_number", { length: 64 }),
  active: boolean("active").notNull().default(true),
  version: integer("version").notNull().default(1),
});

export const contractorClasses = works.table("contractor_classes", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  name: varchar("name", { length: 256 }).notNull(),
  description: varchar("description", { length: 512 }),
  active: boolean("active").notNull().default(true),
  version: integer("version").notNull().default(1),
});

export const issueTypes = works.table("issue_types", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  name: varchar("name", { length: 256 }).notNull(),
  active: boolean("active").notNull().default(true),
  version: integer("version").notNull().default(1),
});

export const issueDescriptionTypes = works.table("issue_description_types", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  issueTypeId: uuid("issue_type_id").notNull(),
  name: varchar("name", { length: 256 }).notNull(),
  active: boolean("active").notNull().default(true),
  version: integer("version").notNull().default(1),
});

export const assets = works.table("assets", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  code: varchar("code", { length: 64 }).notNull(),
  name: varchar("name", { length: 256 }).notNull(),
  type: varchar("type", { length: 64 }),
  district: varchar("district", { length: 128 }),
  taluka: varchar("taluka", { length: 128 }),
  chainage: varchar("chainage", { length: 64 }),
  cost: bigint("cost", { mode: "bigint" }),
  active: boolean("active").notNull().default(true),
  version: integer("version").notNull().default(1),
});

export const workDescriptionTypes = works.table("work_description_types", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  workTypeId: uuid("work_type_id").notNull(),
  keyword: varchar("keyword", { length: 256 }).notNull(),
  active: boolean("active").notNull().default(true),
  version: integer("version").notNull().default(1),
});

export const srItems = works.table("sr_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  zone: varchar("zone", { length: 64 }).notNull(),
  srYear: varchar("sr_year", { length: 16 }).notNull(),
  itemCode: varchar("item_code", { length: 64 }).notNull(),
  description: varchar("description", { length: 1024 }).notNull(),
  unit: varchar("unit", { length: 64 }).notNull(),
  rate: bigint("rate", { mode: "bigint" }).notNull(),
  active: boolean("active").notNull().default(true),
  version: integer("version").notNull().default(1),
});

export const schema = {
  authorities,
  workTypes,
  workSubTypes,
  proposerTypes,
  programs,
  publicationLevels,
  repairTypes,
  schemes,
  scopes,
  tenderTypes,
  userDepartments,
  contractorClasses,
  issueTypes,
  issueDescriptionTypes,
  assets,
  workDescriptionTypes,
  srItems,
};
