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
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
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
  attendanceMode: varchar("attendance_mode", { length: 16 }).notNull().default("muster_lop"),
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
  attendanceMode: varchar("attendance_mode", { length: 16 }).notNull().default("muster_lop"),
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
  /** muster_lop | informational | none — see attendanceLopApplies. */
  attendanceMode: string;
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
    attendanceMode: String(row.attendanceMode ?? "muster_lop"),
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
  attendanceMode: "muster_lop",
  defaultProbationMonths: 0, maxContractMonths: null,
};

/**
 * Does attendance / approved-LOP-leave absence drive SALARY Loss-of-Pay for this
 * engagement policy? True only for payroll-salaried types on a muster
 * (`muster_lop`). Consultants (invoice-billed), third-party staff (agency-paid),
 * and apprentices (NAPS stipend) may still have their attendance tracked for
 * compliance / agency billing, but it must never dock a DIC salary they are not
 * paid through. The payroll-input feed uses this to scope its LOP accrual. Pure.
 */
export function attendanceLopApplies(p: EngagementPolicy): boolean {
  return p.eligibleForPayroll && p.attendanceMode === "muster_lop";
}

/**
 * Is this engagement type entitled to the salaried (CCS / statutory) leave
 * scheme? Consultants (invoice-billed) and third-party staff (agency-deployed)
 * take leave under their own contract / the agency, never the DIC leave ledger,
 * so `eligible_for_leave` is false for them; pay_scale / contractual / apprentice
 * are eligible. The leave apply flow uses this to reject an ineligible type up
 * front. Pure. (Un-categorised / legacy types are permissive via DEFAULT_POLICY.)
 */
export function leaveEligible(p: EngagementPolicy): boolean {
  return p.eligibleForLeave;
}

/**
 * Build a pure resolver: employeeType code → EngagementPolicy for the payroll
 * feed. A policy is imposed ONLY when the type is explicitly categorised into a
 * canonical engagement category (consultant / third_party / apprentice / …); the
 * canonical catalogue is authoritative for that category. Un-categorised types
 * (a tenant row with the migration-default category 'other', or an unknown code)
 * stay permissive (DEFAULT_POLICY).
 *
 * Why not trust a tenant row's own statutory flags: migration 0065 back-filled
 * the new columns on every pre-existing type row with plain defaults (e.g.
 * statutory_nps=false), which are NOT intentional configuration. Keying the
 * policy off the canonical *category* avoids regressing existing NPS/EPF
 * employees while still letting a tenant activate branching by categorising a
 * type (or by naming employeeType as a canonical category directly).
 */
export function buildTypeResolver(tenantTypes: PolicyRow[], canonical: PolicyRow[]): (typeCode: string) => EngagementPolicy {
  const byCode = new Map<string, PolicyRow>();
  for (const t of tenantTypes) byCode.set(String(t.code), t);
  const byCategory = new Map<string, PolicyRow>();
  for (const c of canonical) byCategory.set(String(c.category), c);
  return (typeCode: string): EngagementPolicy => {
    const t = byCode.get(typeCode);
    if (t) {
      const category = String(t.category ?? "other");
      // Explicitly categorised into a canonical engagement category → the
      // canonical catalogue is authoritative for that category.
      if (category !== "other") {
        const c = byCategory.get(category);
        if (c) return toPolicy(c);
      }
      // Un-categorised CUSTOM tenant type (e.g. "Visiting Faculty") → trust the
      // admin's own flags on the row. Migration 0066 has made pre-existing
      // back-filled 'other' rows permissive, so trusting them cannot regress
      // employees that predate engagement-typing.
      return toPolicy(t);
    }
    // No tenant row → treat the code itself as a canonical category, else default.
    const c = byCategory.get(typeCode);
    if (c) return toPolicy(c);
    return DEFAULT_POLICY;
  };
}

/** Load a type→policy resolver for a tenant (tenant master + canonical catalogue). */
export async function loadTypeResolver(tenantId: string): Promise<(typeCode: string) => EngagementPolicy> {
  // SEQUENTIAL reads (not Promise.all): two concurrent tenant transactions on the
  // pooled connection clash and return non-iterable results (this manifested once
  // as "tenantTypes is not iterable"). Same constraint as assertKnownEngagementType.
  const tenantTypes = await scopedRead((tx) => tx.select().from(employeeTypeMaster).where(eq(employeeTypeMaster.tenantId, tenantId)));
  const canonical = await scopedRead((tx) => tx.select().from(engagementCatalogue));
  return buildTypeResolver(tenantTypes as unknown as PolicyRow[], canonical as unknown as PolicyRow[]);
}

/**
 * Legacy employeeType codes that predate engagement-typing. Accepted at create
 * time for backward compatibility (existing tenants/integrations use these);
 * they resolve to a permissive policy via buildTypeResolver.
 */
const LEGACY_EMPLOYEE_TYPES = new Set(["permanent", "temporary", "contract", "deputation", "intern", "apprentice", "volunteer"]);

/**
 * Pure: is `code` a recognised employee type given the known canonical
 * engagement categories and the tenant's own type-master codes? Legacy defaults
 * are always accepted.
 */
export function isKnownEngagementType(code: string, canonicalCategories: Set<string>, tenantCodes: Set<string>): boolean {
  return LEGACY_EMPLOYEE_TYPES.has(code) || canonicalCategories.has(code) || tenantCodes.has(code);
}

/**
 * Enforce at CREATE time that an employeeType is a recognised engagement type —
 * a canonical engagement category (pay_scale / contractual / consultant /
 * third_party / apprentice), a tenant-defined type-master code, or a legacy
 * default — so downstream payroll / statutory / F&F branching resolves correctly
 * and a typo cannot silently become a permissive "unknown" type. Throws 400.
 *
 * Reads are SEQUENTIAL (never Promise.all): two concurrent tenant transactions
 * on the pooled connection clash and return non-iterable results.
 */
export async function assertKnownEngagementType(tenantId: string, code: string): Promise<void> {
  const canonRows = await scopedRead((tx) => tx.select({ c: engagementCatalogue.category }).from(engagementCatalogue));
  const ttRows = await scopedRead((tx) =>
    tx.select({ c: employeeTypeMaster.code }).from(employeeTypeMaster).where(eq(employeeTypeMaster.tenantId, tenantId)),
  );
  const known = isKnownEngagementType(
    code,
    new Set(canonRows.map((r) => String(r.c))),
    new Set(ttRows.map((r) => String(r.c))),
  );
  if (!known) {
    throw new HttpError(
      400,
      "UNKNOWN_EMPLOYEE_TYPE",
      `unknown employee type '${code}' — use an engagement category (e.g. consultant, third_party, apprentice) or a defined employee-type`,
    );
  }
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
