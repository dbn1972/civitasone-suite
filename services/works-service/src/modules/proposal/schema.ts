import { pgSchema, uuid, varchar, boolean, integer, bigint, timestamp } from "drizzle-orm/pg-core";

const works = pgSchema("works");

export const workProposals = works.table("work_proposals", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  workNumber: varchar("work_number", { length: 64 }).notNull(),
  category: varchar("category", { length: 32 }).notNull(), // regular | deposit | salary
  description: varchar("description", { length: 2048 }).notNull(),
  workTypeId: uuid("work_type_id").notNull(),
  workSubTypeId: uuid("work_sub_type_id"),
  estimatedCostMinor: bigint("estimated_cost_minor", { mode: "bigint" }).notNull(),
  executingDivisionId: uuid("executing_division_id"),
  executingSubDivisionId: uuid("executing_sub_division_id"),
  executingSectionId: uuid("executing_section_id"),
  district: varchar("district", { length: 128 }),
  taluka: varchar("taluka", { length: 128 }),
  village: varchar("village", { length: 128 }),
  habitation: varchar("habitation", { length: 128 }),
  mlaConstituency: varchar("mla_constituency", { length: 128 }),
  proposerTypeId: uuid("proposer_type_id"),
  sourceDepartmentId: uuid("source_department_id"),
  schemeId: uuid("scheme_id"),
  chargedOrVoted: varchar("charged_or_voted", { length: 16 }),
  tribalOrNonTribal: varchar("tribal_or_non_tribal", { length: 16 }),
  backlogOrNonBacklog: varchar("backlog_or_non_backlog", { length: 16 }),
  planOrNonPlan: varchar("plan_or_non_plan", { length: 16 }),
  demandNumber: varchar("demand_number", { length: 64 }),
  sector: varchar("sector", { length: 128 }),
  budgetMonth: integer("budget_month"),
  budgetYear: integer("budget_year"),
  programId: uuid("program_id"),
  repairTypeId: uuid("repair_type_id"),
  assetId: uuid("asset_id"),
  kmlFileKey: varchar("kml_file_key", { length: 512 }),
  chainage: varchar("chainage", { length: 64 }),
  remarks: varchar("remarks", { length: 2048 }),
  newOrUpgrade: varchar("new_or_upgrade", { length: 16 }),
  status: varchar("status", { length: 32 }).notNull().default("draft"), // draft | dao_finalized | ts_eligible
  daoFinalizedBy: uuid("dao_finalized_by"),
  daoFinalizedAt: timestamp("dao_finalized_at", { withTimezone: true }),
  version: integer("version").notNull().default(1),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const workCoaMappings = works.table("work_coa_mappings", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  workId: uuid("work_id").notNull(),
  majorHead: varchar("major_head", { length: 16 }).notNull(),
  subMajorHead: varchar("sub_major_head", { length: 16 }),
  minorHead: varchar("minor_head", { length: 16 }),
  subHead: varchar("sub_head", { length: 16 }),
  detailHead: varchar("detail_head", { length: 16 }),
  objectHead: varchar("object_head", { length: 16 }),
  version: integer("version").notNull().default(1),
});

export const workSplits = works.table("work_splits", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  parentWorkId: uuid("parent_work_id").notNull(),
  splitNumber: varchar("split_number", { length: 64 }).notNull(),
  description: varchar("description", { length: 2048 }),
  status: varchar("status", { length: 16 }).notNull().default("active"), // active | closed
  version: integer("version").notNull().default(1),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const workOfficeMappings = works.table("work_office_mappings", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  workId: uuid("work_id").notNull(),
  splitId: uuid("split_id"),
  divisionId: uuid("division_id").notNull(),
  subDivisionId: uuid("sub_division_id"),
  sectionId: uuid("section_id"),
  isNodal: boolean("is_nodal").notNull().default(false),
  version: integer("version").notNull().default(1),
});

export const schema = { workProposals, workCoaMappings, workSplits, workOfficeMappings };
