/**
 * POLICY-SEED-1 (UAT bundle 17): the STANDARD role -> permission grants every tenant needs for the approve
 * actions gated by policy-service permission keys. One definition, used by:
 *  - the tenant.tenant.created consumer (tenant-provision/consumer.ts) -- every NEW tenant gets them;
 *  - scripts/backfill-standard-grants.ts (this service) -- existing tenants, dry-run / apply;
 *  - scripts/seed-rbac-policy-store.ts (repo root) -- the dev seed, which used to keep its own copy and
 *    applied it to two hard-coded tenants only, so a new tenant's non-super_admin approvers got 403 from
 *    workflow-service task completion (tasks/routes.ts REF_PERMISSION).
 *
 * Why each grant (backed by the route role-gates, see the seed script history):
 *  - hrms.leave.approve: hr_admin, hr_officer, manager (hrms leave routes send managers to the workflow queue);
 *  - payroll.run.approve: payroll_admin, payroll_officer;
 *  - procurement.indent.approve: procurement_officer, procurement_admin;
 *  - procurement.po / plan / po_amendment .approve: procurement_admin (procurement APPROVE_ROLES convention;
 *    plan / po_amendment are the B9-wf1 workflow tasks -- POLICY-SEED-2: they were in the seed list but never
 *    applied to any tenant).
 * super_admin is deliberately absent: isSuperAdmin() fast-paths before any policy-service call. Pure.
 */
export type StandardGrant = { readonly resource: string; readonly action: string };

export const STANDARD_ROLE_GRANTS: Readonly<Record<string, readonly StandardGrant[]>> = {
  hr_admin:            [{ resource: "hrms.leave", action: "approve" }],
  hr_officer:          [{ resource: "hrms.leave", action: "approve" }],
  manager:             [{ resource: "hrms.leave", action: "approve" }],
  payroll_admin:       [{ resource: "payroll.run", action: "approve" }],
  payroll_officer:     [{ resource: "payroll.run", action: "approve" }],
  procurement_officer: [{ resource: "procurement.indent", action: "approve" }],
  procurement_admin:   [
    { resource: "procurement.indent", action: "approve" },
    { resource: "procurement.po", action: "approve" },
    { resource: "procurement.plan", action: "approve" },
    { resource: "procurement.po_amendment", action: "approve" },
  ],
};

export const STANDARD_ROLE_DESCRIPTION = "Standard approver role (policy-service standard grants, POLICY-SEED-1)";

/** Every (role, resource, action) of the standard set, flattened, in a stable order. */
export function standardGrantList(): Array<{ role: string; resource: string; action: string }> {
  return Object.entries(STANDARD_ROLE_GRANTS).flatMap(([role, grants]) => grants.map((g) => ({ role, resource: g.resource, action: g.action })));
}
