import type { ZodTypeAny } from "zod";
import * as v from "./validators.js";
import * as s from "./schema.js";

export type MasterTable =
  | typeof s.authorities | typeof s.workTypes | typeof s.workSubTypes
  | typeof s.proposerTypes | typeof s.programs | typeof s.publicationLevels
  | typeof s.repairTypes | typeof s.schemes | typeof s.scopes
  | typeof s.tenderTypes | typeof s.userDepartments | typeof s.contractorClasses
  | typeof s.issueTypes | typeof s.issueDescriptionTypes | typeof s.assets
  | typeof s.workDescriptionTypes | typeof s.srItems;

export interface MasterConfig {
  table: MasterTable;
  prefix: string;
  createSchema: ZodTypeAny;
  /** Fields carrying money in MINOR units — decoded via parseMinor before insert. */
  moneyFields?: string[];
}

/**
 * Single source of truth for master type <-> table <-> validator wiring.
 * Shared by masters/routes.ts (HTTP, publishes COMMANDS.masterCreate) and
 * masters/consumer.ts (CQRS persistence) so a master type can never be wired
 * on one side and forgotten on the other.
 */
export const masters: MasterConfig[] = [
  { table: s.authorities, prefix: "authorities", createSchema: v.createAuthoritySchema },
  { table: s.workTypes, prefix: "work-types", createSchema: v.createWorkTypeSchema },
  { table: s.workSubTypes, prefix: "work-sub-types", createSchema: v.createWorkSubTypeSchema },
  { table: s.proposerTypes, prefix: "proposer-types", createSchema: v.createMasterSchema },
  { table: s.programs, prefix: "programs", createSchema: v.createMasterSchema },
  { table: s.publicationLevels, prefix: "publication-levels", createSchema: v.createMasterSchema },
  { table: s.repairTypes, prefix: "repair-types", createSchema: v.createRepairTypeSchema },
  { table: s.schemes, prefix: "schemes", createSchema: v.createSchemeSchema },
  { table: s.scopes, prefix: "scopes", createSchema: v.createScopeSchema },
  { table: s.tenderTypes, prefix: "tender-types", createSchema: v.createTenderTypeSchema },
  { table: s.userDepartments, prefix: "user-departments", createSchema: v.createMasterSchema },
  { table: s.contractorClasses, prefix: "contractor-classes", createSchema: v.createMasterSchema },
  { table: s.issueTypes, prefix: "issue-types", createSchema: v.createMasterSchema },
  { table: s.issueDescriptionTypes, prefix: "issue-description-types", createSchema: v.createMasterSchema },
  { table: s.assets, prefix: "assets", createSchema: v.createAssetSchema, moneyFields: ["cost"] },
  { table: s.workDescriptionTypes, prefix: "work-description-types", createSchema: v.createMasterSchema },
  { table: s.srItems, prefix: "sr-items", createSchema: v.createSrItemSchema, moneyFields: ["rate"] },
];

export const masterTableByPrefix: Record<string, MasterTable> = Object.fromEntries(
  masters.map((m) => [m.prefix, m.table]),
);

export const masterMoneyFieldsByPrefix: Record<string, string[]> = Object.fromEntries(
  masters.map((m) => [m.prefix, m.moneyFields ?? []]),
);
