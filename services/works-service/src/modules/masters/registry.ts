import type { ZodTypeAny } from "zod";
import * as v from "./validators.js";
import * as s from "./schema.js";

export type MasterTable =
  | typeof s.authorities | typeof s.workTypes | typeof s.workSubTypes
  | typeof s.proposerTypes | typeof s.programs | typeof s.publicationLevels
  | typeof s.repairTypes | typeof s.schemes | typeof s.scopes
  | typeof s.tenderTypes | typeof s.userDepartments | typeof s.contractorClasses
  | typeof s.issueTypes | typeof s.issueDescriptionTypes | typeof s.assets
  | typeof s.workDescriptionTypes | typeof s.srItems | typeof s.divisions;

export interface MasterConfig {
  table: MasterTable;
  prefix: string;
  createSchema: ZodTypeAny;
  /**
   * PATCH body schema (strict). REQUIRED per type (UAT F76 / B9-works): a
   * shared default (name/code/active) used to be applied to tables with no
   * code (or no name) column, so such an edit was 202-accepted and silently
   * changed nothing. Every key must be a column of `table`
   * (tests/masters-registry.test.ts).
   */
  patchSchema: ZodTypeAny;
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
  { table: s.authorities, prefix: "authorities", createSchema: v.createAuthoritySchema, patchSchema: v.patchMasterSchema },
  { table: s.workTypes, prefix: "work-types", createSchema: v.createWorkTypeSchema, patchSchema: v.patchMasterSchema },
  { table: s.workSubTypes, prefix: "work-sub-types", createSchema: v.createWorkSubTypeSchema, patchSchema: v.patchMasterSchema },
  { table: s.proposerTypes, prefix: "proposer-types", createSchema: v.createMasterSchema, patchSchema: v.patchNameMasterSchema },
  { table: s.programs, prefix: "programs", createSchema: v.createMasterSchema, patchSchema: v.patchNameMasterSchema },
  { table: s.publicationLevels, prefix: "publication-levels", createSchema: v.createMasterSchema, patchSchema: v.patchNameMasterSchema },
  { table: s.repairTypes, prefix: "repair-types", createSchema: v.createRepairTypeSchema, patchSchema: v.patchNameMasterSchema },
  { table: s.schemes, prefix: "schemes", createSchema: v.createSchemeSchema, patchSchema: v.patchNameMasterSchema },
  { table: s.scopes, prefix: "scopes", createSchema: v.createScopeSchema, patchSchema: v.patchNameMasterSchema },
  { table: s.tenderTypes, prefix: "tender-types", createSchema: v.createTenderTypeSchema, patchSchema: v.patchNameMasterSchema },
  { table: s.userDepartments, prefix: "user-departments", createSchema: v.createUserDepartmentSchema, patchSchema: v.patchUserDepartmentSchema },
  { table: s.contractorClasses, prefix: "contractor-classes", createSchema: v.createContractorClassSchema, patchSchema: v.patchContractorClassSchema },
  { table: s.issueTypes, prefix: "issue-types", createSchema: v.createMasterSchema, patchSchema: v.patchNameMasterSchema },
  { table: s.issueDescriptionTypes, prefix: "issue-description-types", createSchema: v.createIssueDescriptionTypeSchema, patchSchema: v.patchNameMasterSchema },
  { table: s.assets, prefix: "assets", createSchema: v.createAssetSchema, patchSchema: v.patchMasterSchema, moneyFields: ["cost"] },
  {
    table: s.workDescriptionTypes,
    prefix: "work-description-types",
    createSchema: v.createWorkDescriptionTypeSchema,
    patchSchema: v.patchWorkDescriptionTypeSchema,
  },
  { table: s.srItems, prefix: "sr-items", createSchema: v.createSrItemSchema, patchSchema: v.patchSrItemSchema, moneyFields: ["rate"] },
  { table: s.divisions, prefix: "divisions", createSchema: v.createDivisionSchema, patchSchema: v.patchMasterSchema },
];

export const masterTableByPrefix: Record<string, MasterTable> = Object.fromEntries(
  masters.map((m) => [m.prefix, m.table]),
);

export const masterMoneyFieldsByPrefix: Record<string, string[]> = Object.fromEntries(
  masters.map((m) => [m.prefix, m.moneyFields ?? []]),
);
