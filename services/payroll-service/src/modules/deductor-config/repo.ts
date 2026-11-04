/**
 * UAT P3 b19 D-15: where the TDS deductor identity comes from.
 *
 *   1. the tenant configuration: payroll.payroll_settings.deductor_name /
 *      deductor_tan / deductor_pan (migration 0163), set through
 *      PUT /v1/payroll/settings/deductor (audited);
 *   2. only when the tenant has none of the three: the deployment-wide
 *      EMPLOYER_NAME / EMPLOYER_TAN / EMPLOYER_PAN env (a single-deductor
 *      installation). The two are never mixed field by field.
 *
 * Either way the identity is validated (domain.ts); there is no placeholder
 * default any more. requireDeductor() refuses with 422 DEDUCTOR_NOT_CONFIGURED.
 */
import { sql } from "drizzle-orm";
import { scopedRead } from "../../shared/db.js";
import { HttpError } from "../../shared/context.js";
import {
  DEDUCTOR_NOT_CONFIGURED, deductorNotConfiguredMessage, deductorProblems, normaliseDeductor, type DeductorIdentity,
} from "./domain.js";

export type DeductorSource = "tenant" | "env" | null;

export interface ResolvedDeductor {
  source: DeductorSource;
  name: string | null; tan: string | null; pan: string | null;
  problems: string[];
  configured: boolean;
  updatedAt: string | null;
}

type Executor = { execute: (q: ReturnType<typeof sql>) => Promise<unknown> };

/** The tenant stored deductor (normalised; nulls when not set), read through `tx`. */
export async function loadTenantDeductorTx(tx: Executor, tenantId: string): Promise<{ name: string | null; tan: string | null; pan: string | null; updatedAt: string | null }> {
  const rows = (await tx.execute(sql`
    SELECT deductor_name, deductor_tan, deductor_pan, updated_at::text AS updated_at
      FROM payroll.payroll_settings WHERE tenant_id = ${tenantId}::uuid LIMIT 1
  `)) as unknown as Array<{ deductor_name: string | null; deductor_tan: string | null; deductor_pan: string | null; updated_at: string | null }>;
  const r = rows[0];
  return { ...normaliseDeductor({ name: r?.deductor_name, tan: r?.deductor_tan, pan: r?.deductor_pan }), updatedAt: r?.updated_at ?? null };
}

export async function resolveDeductor(tenantId: string): Promise<ResolvedDeductor> {
  const tenant = await scopedRead((tx) => loadTenantDeductorTx(tx, tenantId));
  const hasTenant = tenant.name !== null || tenant.tan !== null || tenant.pan !== null;
  const env = normaliseDeductor({ name: process.env.EMPLOYER_NAME, tan: process.env.EMPLOYER_TAN, pan: process.env.EMPLOYER_PAN });
  const hasEnv = env.name !== null || env.tan !== null || env.pan !== null;
  const source: DeductorSource = hasTenant ? "tenant" : hasEnv ? "env" : null;
  const v = hasTenant ? tenant : env;
  const problems = deductorProblems(v);
  return {
    source, name: v.name, tan: v.tan, pan: v.pan, problems, configured: problems.length === 0,
    updatedAt: hasTenant ? tenant.updatedAt : null,
  };
}

/**
 * The deductor identity for a TDS return / certificate (`what`, e.g. "Form 24Q"),
 * or 422 DEDUCTOR_NOT_CONFIGURED naming each missing / invalid field.
 */
export async function requireDeductor(tenantId: string, what: string): Promise<DeductorIdentity> {
  const d = await resolveDeductor(tenantId);
  if (!d.configured) throw new HttpError(422, DEDUCTOR_NOT_CONFIGURED, deductorNotConfiguredMessage(what, d.problems));
  return { name: d.name!, tan: d.tan!, pan: d.pan! };
}

/**
 * For a file that is not a TDS return (NPS-SCF): the configured identity, or
 * nulls -- never placeholder text, and an invalid identity is not echoed.
 */
export async function optionalDeductor(tenantId: string): Promise<{ name: string | null; tan: string | null; pan: string | null }> {
  const d = await resolveDeductor(tenantId);
  return d.configured ? { name: d.name, tan: d.tan, pan: d.pan } : { name: null, tan: null, pan: null };
}
