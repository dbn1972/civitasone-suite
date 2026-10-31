/**
 * Single source of truth for the works master-data type catalogue on the web
 * side (GAP-WORKS-MASTERS-08). The 17-type list and the human labels used to
 * be duplicated between page.tsx and MasterCreateForm.tsx; both now import
 * from here, so a type can never be listed on one side and forgotten on the
 * other. This mirrors works-service's own registry.ts (the backend source of
 * truth): the backend exposes exactly these 17 prefixes with per-type zod
 * schemas and audits every write (verified against
 * services/works-service/src/modules/masters/registry.ts).
 */

export const MASTER_TYPES = [
  "authorities",
  "work-types",
  "work-sub-types",
  "proposer-types",
  "programs",
  "publication-levels",
  "repair-types",
  "schemes",
  "scopes",
  "tender-types",
  "user-departments",
  "contractor-classes",
  "issue-types",
  "issue-description-types",
  "assets",
  "work-description-types",
  "sr-items",
] as const;

export type MasterType = (typeof MASTER_TYPES)[number];

const LABELS: Record<string, string> = {
  "authorities": "Authorities",
  "work-types": "Work Types",
  "work-sub-types": "Work Sub-Types",
  "proposer-types": "Proposer Types",
  "programs": "Programs",
  "publication-levels": "Publication Levels",
  "repair-types": "Repair Types",
  "schemes": "Schemes",
  "scopes": "Scopes",
  "tender-types": "Tender Types",
  "user-departments": "User Departments",
  "contractor-classes": "Contractor Classes",
  "issue-types": "Issue Types",
  "issue-description-types": "Issue Description Types",
  "assets": "Assets",
  "work-description-types": "Work Description Types",
  "sr-items": "SR Items",
};

export function isMasterType(v: string): v is MasterType {
  return (MASTER_TYPES as readonly string[]).includes(v);
}

export function humanizeMaster(prefix: string): string {
  return LABELS[prefix] ?? prefix;
}

/**
 * The parent master a type references, if any — used to render a Parent column
 * and (in the create form) a picker instead of a raw UUID text box
 * (GAP-WORKS-MASTERS-03). Keyed by the field on the row that holds the parent
 * id. `optionsType` is the master type to fetch the picker options from.
 */
export const PARENT_FIELD: Partial<Record<MasterType, { field: string; optionsType: MasterType; label: string }>> = {
  "work-sub-types": { field: "workTypeId", optionsType: "work-types", label: "Work Type" },
  "scopes": { field: "workTypeId", optionsType: "work-types", label: "Work Type" },
  "work-description-types": { field: "workTypeId", optionsType: "work-types", label: "Work Type" },
  "repair-types": { field: "programId", optionsType: "programs", label: "Program" },
  "issue-description-types": { field: "issueTypeId", optionsType: "issue-types", label: "Issue Type" },
};

/**
 * Per-type display column config for the registry table (GAP-WORKS-MASTERS-07).
 * `money: true` means the value is minor units (paise) and must be rendered
 * with formatMoney. When a type has no entry here the generic Name/Code/Active
 * columns are used.
 */
export interface MasterColumn {
  key: string;
  label: string;
  money?: boolean;
}

// UAT B9-works: these tables have a name but no code column; show what they store.
const NAME_ONLY: MasterColumn[] = [{ key: "name", label: "Name" }];

export const TYPE_COLUMNS: Partial<Record<MasterType, MasterColumn[]>> = {
  "proposer-types": NAME_ONLY,
  "programs": NAME_ONLY,
  "publication-levels": NAME_ONLY,
  "repair-types": NAME_ONLY,
  "issue-types": NAME_ONLY,
  "issue-description-types": NAME_ONLY,
  "schemes": [
    { key: "name", label: "Name" },
    { key: "sponsor", label: "Sponsor" },
  ],
  "tender-types": [
    { key: "name", label: "Name" },
    { key: "rateType", label: "Rate Type" },
  ],
  "user-departments": [
    { key: "name", label: "Name" },
    { key: "demandNumber", label: "Demand Number" },
  ],
  "contractor-classes": [
    { key: "name", label: "Name" },
    { key: "description", label: "Description" },
  ],
  // GAP-WORKS-MASTERS-04: scopes carry a mandatory unit; show it (scopes have no code).
  "scopes": [
    { key: "name", label: "Name" },
    { key: "unit", label: "Unit" },
  ],
  "sr-items": [
    { key: "itemCode", label: "Item Code" },
    { key: "description", label: "Description" },
    { key: "unit", label: "Unit" },
    { key: "rate", label: "Rate", money: true },
    { key: "zone", label: "Zone" },
    { key: "srYear", label: "SR Year" },
  ],
  // UAT F76: work description types have a keyword, not a name/code.
  "work-description-types": [
    { key: "keyword", label: "Keyword" },
  ],
  "assets": [
    { key: "code", label: "Code" },
    { key: "name", label: "Name" },
    { key: "type", label: "Type" },
    { key: "district", label: "District" },
    { key: "cost", label: "Cost", money: true },
  ],
};

/**
 * UAT F76 / B9-works: the fields each type's PATCH accepts, mirroring the
 * per-type strict patch schemas in works-service masters/registry.ts. A field
 * outside this list is rejected (400) by the server, so the edit form must not
 * offer it. Default: name/code/active (tables with both name and code).
 */
const EDITABLE_KEYS: Partial<Record<MasterType, string[]>> = {
  "proposer-types": ["name", "active"],
  "programs": ["name", "active"],
  "publication-levels": ["name", "active"],
  "repair-types": ["name", "active"],
  "schemes": ["name", "active"],
  "scopes": ["name", "active"],
  "tender-types": ["name", "active"],
  "issue-types": ["name", "active"],
  "issue-description-types": ["name", "active"],
  "user-departments": ["name", "demandNumber", "active"],
  "contractor-classes": ["name", "description", "active"],
  "work-description-types": ["keyword", "active"],
  "sr-items": ["active"],
};

export function editableKeys(masterType: string): string[] {
  return EDITABLE_KEYS[masterType as MasterType] ?? ["name", "code", "active"];
}
