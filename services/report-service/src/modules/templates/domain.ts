/**
 * templates domain — pure validation logic for report templates.
 * Validates constraints: ≤20 filters, ≤4 groups, ≤20 parameters, ≤50 templates/tenant.
 * Validates data source exists in whitelisted catalog.
 */
import type { TemplateFilter, TemplateGroup, TemplateParameter } from "./schema.js";

/** Maximum constraints per requirements 18.1, 18.2 */
export const MAX_FILTERS = 20;
export const MAX_GROUPS = 4;
export const MAX_PARAMETERS = 20;
export const MAX_TEMPLATES_PER_TENANT = 50;

/**
 * Whitelisted data source catalog.
 * Only these sources may be referenced by report templates.
 */
export const DATA_SOURCE_CATALOG: ReadonlySet<string> = new Set([
  "finance.bills",
  "finance.vouchers",
  "finance.budget",
  "finance.gl_entries",
  "procurement.purchase_orders",
  "procurement.vendors",
  "procurement.grn",
  "hrms.employees",
  "hrms.attendance",
  "hrms.leave",
  "payroll.pay_runs",
  "payroll.salary_slips",
  "estab.files",
  "estab.notings",
  "asset.assets",
  "asset.movements",
  "inventory.items",
  "inventory.movements",
  "project.tasks",
  "project.milestones",
  "grant.grants",
  "grant.utilizations",
  "citizen.grievances",
  "citizen.rti",
  "legal.matters",
  "legal.hearings",
  "contract.contracts",
  "contract.obligations",
  "helpdesk.tickets",
  "billing.invoices",
  "billing.subscriptions",
  "analytics.fact_events",
]);

export interface ValidationError {
  field: string;
  message: string;
}

/**
 * Validates that a data source ID is in the whitelisted catalog.
 */
export function validateDataSource(dataSourceId: string): ValidationError | null {
  if (!DATA_SOURCE_CATALOG.has(dataSourceId)) {
    return { field: "dataSourceId", message: `data source '${dataSourceId}' is not in the whitelisted catalog` };
  }
  return null;
}

/**
 * Validates filter count ≤ MAX_FILTERS.
 */
export function validateFilters(filters: TemplateFilter[]): ValidationError | null {
  if (filters.length > MAX_FILTERS) {
    return { field: "filters", message: `maximum ${MAX_FILTERS} filters allowed, got ${filters.length}` };
  }
  return null;
}

/**
 * Validates group count ≤ MAX_GROUPS.
 */
export function validateGroups(groups: TemplateGroup[]): ValidationError | null {
  if (groups.length > MAX_GROUPS) {
    return { field: "groups", message: `maximum ${MAX_GROUPS} groups allowed, got ${groups.length}` };
  }
  return null;
}

/**
 * Validates parameter count ≤ MAX_PARAMETERS.
 */
export function validateParameters(parameters: TemplateParameter[]): ValidationError | null {
  if (parameters.length > MAX_PARAMETERS) {
    return { field: "parameters", message: `maximum ${MAX_PARAMETERS} parameters allowed, got ${parameters.length}` };
  }
  return null;
}

/**
 * Validates template count per tenant ≤ MAX_TEMPLATES_PER_TENANT.
 */
export function validateTemplateCount(currentCount: number): ValidationError | null {
  if (currentCount >= MAX_TEMPLATES_PER_TENANT) {
    return { field: "tenantId", message: `maximum ${MAX_TEMPLATES_PER_TENANT} templates per tenant reached` };
  }
  return null;
}

/**
 * Runs all domain validations for a template create/update operation.
 * Returns array of errors (empty if all valid).
 */
export function validateTemplate(input: {
  dataSourceId: string;
  filters: TemplateFilter[];
  groups: TemplateGroup[];
  parameters: TemplateParameter[];
}): ValidationError[] {
  const errors: ValidationError[] = [];

  const dsErr = validateDataSource(input.dataSourceId);
  if (dsErr) errors.push(dsErr);

  const filterErr = validateFilters(input.filters);
  if (filterErr) errors.push(filterErr);

  const groupErr = validateGroups(input.groups);
  if (groupErr) errors.push(groupErr);

  const paramErr = validateParameters(input.parameters);
  if (paramErr) errors.push(paramErr);

  return errors;
}
