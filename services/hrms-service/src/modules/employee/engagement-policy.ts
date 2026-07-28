/**
 * Engagement-type POLICY resolution (DIC keystone).
 *
 * Each employee type carries a full policy pack — whether it runs through
 * payroll, its income-tax section, statutory eligibility (PF/ESI/NPS), gratuity
 * / bonus / leave-encashment, and leave applicability — so downstream modules
 * (payroll, statutory, leave, separation) branch per engagement type instead of
 * treating everyone as one uniform employee.
 *
 * Source of truth precedence: a tenant's own `hrms_employee_types` row (the
 * customised master) wins; otherwise the GLOBAL canonical catalogue seeded with
 * the 5 legally-distinct DIC types (migration 0065) provides the default. Pure
 * resolver + read-only routes; no writes here (the master CRUD lives in
 * employee-types-routes.ts).
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { pgSchema, varchar, integer, boolean } from "drizzle-orm/pg-core";
import { resolveContext, requireRole } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";

const employeeSchema = pgSchema("employee");

export const engagementCatalogue = employeeSchema.table("engagement_type_catalogue", {
  category: varchar("category", { length: 24 }).primaryKey(),
  label: varchar("label", { length: 80 }).notNull(),
  description: varchar("description", { length: 300 }).notNull().default(""),
  eligibleForLeave: boolean("eligible_for_leave").notNull().default(true),
  eligibleForPayroll: boolean("eligible_for_payroll").notNull().default(true),
  eligibleForAppraisal: boolean("eligible_for_appraisal").notNull().default(true),
  paymentRoute: varchar("payment_route", { length: 16 }).notNull().default("payroll"),
  payMode: varchar("pay_mode", { length: 16 }).notNull().default("monthly"),
  taxSection: varchar("tax_section", { length: 8 }).notNull().default("192"),
  statutoryPf: boolean("statutory_pf").notNull().default(true),
  statutoryEsi: boolean("statutory_esi").notNull().default(true),
  statutoryNps: boolean("statutory_nps").notNull().default(false),
  eligibleForGratuity: boolean("eligible_for_gratuity").notNull().default(true),
  eligibleForBonus: boolean("eligible_for_bonus").notNull().default(false),
  leaveEncashment: boolean("leave_encashment").notNull().default(false),
  defaultProbationMonths: integer("default_probation_months").notNull().default(0),
  maxContractMonths: integer("max_contract_months"),
  sortOrder: integer("sort_order").notNull().default(0),
});

// Minimal view of the per-tenant type master this resolver reads.
const employeeTypeMaster = employeeSchema.table("hrms_employee_types", {
  tenantId: varchar("tenant_id").notNull(),
  code: varchar("code", { length: 24 }).notNull(),
  name: varchar("name", { length: 120 }).notNull(),
  category: varchar("category", { length: 24 }).notNull().default("other"),
  eligibleForLeave: boolean("eligible_for_leave").notNull().default(true),
  eligibleForPayroll: boolean("eligible_for_payroll").notNull().default(true),
  eligibleForAppraisal: boolean("eligible_for_appraisal").notNull().default(true),
  paymentRoute: varchar("payment_route", { length: 16 }).notNull().default("payroll"),
  payMode: varchar("pay_mode", { length: 16 }).notNull().default("monthly"),
  taxSection: varchar("tax_section", { length: 8 }).notNull().default("192"),
  statutoryPf: boolean("statutory_pf").notNull().default(true),
  statutoryEsi: boolean("statutory_esi").notNull().default(true),
  statutoryNps: boolean("statutory_nps").notNull().default(false),
  eligibleForGratuity: boolean("eligible_for_gratuity").notNull().default(true),
  eligibleForBonus: boolean("eligible_for_bonus").notNull().default(false),
  leaveEncashment: boolean("leave_encashment").notNull().default(false),
  defaultProbationMonths: integer("default_probation_months").notNull().default(0),
  maxContractMonths: integer("max_contract_months"),
});

export interface EngagementPolicy {
  eligibleForLeave: boolean;
  eligibleForPayroll: boolean;
  eligibleForAppraisal: boolean;
  paymentRoute: string;
  payMode: string;
  taxSection: string;
  statutoryPf: boolean;
  statutoryEsi: boolean;
  statutoryNps: boolean;
  eligibleForGratuity: boolean;
  eligibleForBonus: boolean;
  leaveEncashment: boolean;
  defaultProbationMonths: number;
  maxContractMonths: number | null;
}

type PolicyRow = Record<string, unknown>;

/** Normalise any policy-bearing row (catalogue or tenant master) into a policy. */
export function toPolicy(row: PolicyRow): EngagementPolicy {
  return {
    eligibleForLeave: !!row.eligibleForLeave,
    eligibleForPayroll: !!row.eligibleForPayroll,
    eligibleForAppraisal: !!row.eligibleForAppraisal,
    paymentRoute: String(row.paymentRoute ?? "payroll"),
    payMode: String(row.payMode ?? "monthly"),
    taxSection: String(row.taxSection ?? "192"),
    statutoryPf: !!row.statutoryPf,
    statutoryEsi: !!row.statutoryEsi,
    statutoryNps: !!row.statutoryNps,
    eligibleForGratuity: !!row.eligibleForGratuity,
    eligibleForBonus: !!row.eligibleForBonus,
    leaveEncashment: !!row.leaveEncashment,
    defaultProbationMonths: Number(row.defaultProbationMonths ?? 0),
    maxContractMonths: row.maxContractMonths == null ? null : Number(row.maxContractMonths),
  };
}

export interface ResolvedPolicy {
  code: string;
  category: string;
  source: "tenant" | "canonical";
  policy: EngagementPolicy;
}

/**
 * Effective policy for a type code: the tenant's own master row wins; else fall
 * back to the canonical catalogue (matched by code == category). Returns null
 * when neither exists. Pure.
 */
export function resolvePolicy(
  code: string,
  tenantRow: PolicyRow | null,
  canonicalRow: PolicyRow | null,
): ResolvedPolicy | null {
  if (tenantRow) {
    return { code, category: String(tenantRow.category ?? "other"), source: "tenant", policy: toPolicy(tenantRow) };
  }
  if (canonicalRow) {
    return { code, category: String(canonicalRow.category ?? code), source: "canonical", policy: toPolicy(canonicalRow) };
  }
  return null;
}

/**
 * Permissive default for an employee type that matches neither a tenant master
 * row nor a canonical category (e.g. legacy "permanent" / "contract" codes).
 * Fully payroll-eligible with all statutory heads on, so employees that predate
 * engagement-typing are paid exactly as before — engagement branching is opt-in
 * per employee (set employeeType to a canonical category or define a type master).
 */
export const DEFAULT_POLICY: EngagementPolicy = {
  eligibleForLeave: true, eligibleForPayroll: true, eligibleForAppraisal: true,
  paymentRoute: "payroll", payMode: "monthly", taxSection: "192",
  statutoryPf: true, statutoryEsi: true, statutoryNps: true,
  eligibleForGratuity: true, eligibleForBonus: false, leaveEncashment: true,
  defaultProbationMonths: 0, maxContractMonths: null,
};

/**
 * Build a pure resolver: employeeType code → EngagementPolicy. Precedence:
 * tenant master row (by code) → canonical catalogue (by category) → permissive
 * default. Used to project each employee's policy into the payroll-input feed.
 */
export function buildTypeResolver(tenantTypes: PolicyRow[], canonical: PolicyRow[]): (typeCode: string) => EngagementPolicy {
  const byCode = new Map<string, PolicyRow>();
  for (const t of tenantTypes) byCode.set(String(t.code), t);
  const byCategory = new Map<string, PolicyRow>();
  for (const c of canonical) byCategory.set(String(c.category), c);
  return (typeCode: string): EngagementPolicy => {
    const t = byCode.get(typeCode);
    if (t) return toPolicy(t);
    const c = byCategory.get(typeCode); // treat the code itself as a canonical category
    if (c) return toPolicy(c);
    return DEFAULT_POLICY;
  };
}

/** Load a type→policy resolver for a tenant (tenant master + canonical catalogue). */
export async function loadTypeResolver(tenantId: string): Promise<(typeCode: string) => EngagementPolicy> {
  const [tenantTypes, canonical] = await Promise.all([
    scopedRead((tx) => tx.select().from(employeeTypeMaster).where(eq(employeeTypeMaster.tenantId, tenantId))),
    scopedRead((tx) => tx.select().from(engagementCatalogue)),
  ]);
  return buildTypeResolver(tenantTypes as unknown as PolicyRow[], canonical as unknown as PolicyRow[]);
}

const HR_VIEW_ROLES = ["hr_admin", "super_admin", "admin", "manager", "officer", "employee"];
const codeParam = z.object({ code: z.string().min(1).max(24) });

export async function engagementPolicyRoutes(app: FastifyInstance): Promise<void> {
  // Canonical 5-type engagement catalogue (global reference).
  app.get("/v1/hrms/engagement-types", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_VIEW_ROLES);
    const rows = await scopedRead((tx) => tx.select().from(engagementCatalogue));
    rows.sort((a, b) => a.sortOrder - b.sortOrder || a.category.localeCompare(b.category));
    return reply.send({ data: rows });
  });

  // Effective policy for a given employee-type code (tenant master over canonical).
  app.get("/v1/hrms/employee-types/:code/policy", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_VIEW_ROLES);
    const { code } = codeParam.parse(req.params);
    const tenantRows = await scopedRead((tx) =>
      tx.select().from(employeeTypeMaster).where(and(eq(employeeTypeMaster.tenantId, ctx.tenantId), eq(employeeTypeMaster.code, code))).limit(1),
    );
    const tenantRow = tenantRows[0] ?? null;
    // canonical matched by the tenant row's category, else by the code itself
    const cat = tenantRow ? String(tenantRow.category) : code;
    const canonRows = await scopedRead((tx) => tx.select().from(engagementCatalogue).where(eq(engagementCatalogue.category, cat)).limit(1));
    const resolved = resolvePolicy(code, tenantRow as PolicyRow | null, (canonRows[0] as PolicyRow) ?? null);
    if (!resolved) return reply.code(404).send({ code: "UNKNOWN_TYPE", message: `no engagement policy for type '${code}'` });
    return reply.send(resolved);
  });
}
