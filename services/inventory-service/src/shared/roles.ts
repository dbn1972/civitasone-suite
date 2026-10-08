/**
 * Canonical inventory role vocabularies.
 *
 * GAP2-INVENTORY-FORECAST-02: the inventory read endpoints must share ONE
 * reader-role list so "who may read an inventory register" is applied
 * consistently. Previously the forecast endpoint omitted `audit_officer`
 * (while adding `procurement_officer`/`tenant_admin`), so an audit officer who
 * can read every other inventory register could not read the demand forecast.
 *
 * `INVENTORY_WRITE_ROLES` mirrors the item/movement/batch write list;
 * `INVENTORY_READER_ROLES` is the write list plus the read-only oversight roles
 * (`audit_officer`, `finance_officer`). The procurement/tenant-admin oversight
 * roles that the forecast endpoint historically allowed are retained centrally.
 */
export const INVENTORY_WRITE_ROLES = [
  "inventory_user",
  "inventory_manager",
  "inventory_admin",
  "store_keeper",
  "super_admin",
] as const;

export const INVENTORY_READER_ROLES = [
  ...INVENTORY_WRITE_ROLES,
  "audit_officer",
  "finance_officer",
  "procurement_officer",
  "tenant_admin",
] as const;
