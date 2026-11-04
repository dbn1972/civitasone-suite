/**
 * UAT P3 b19 D-15: where the TDS deductor identity comes from (review
 * decision 1: ONE source, shared with the official documents of PR #2463).
 *
 *   1. the tenant document identity: tenant-service settings.documentIdentity
 *      { orgName, tan, pan, address, deductorCategory } (tenant-identity.ts,
 *      fail-open read). orgName absent -> the tenant name, as #2463 does;
 *   2. only when documentIdentity has none of name / TAN / PAN: the
 *      deployment-wide EMPLOYER_NAME / EMPLOYER_TAN / EMPLOYER_PAN env (a
 *      single-deductor installation). The two are never mixed field by field.
 *
 * Either way the identity is validated (domain.ts deductorProblems); there is
 * no placeholder default. requireDeductor() refuses with 422
 * FORM16_EMPLOYER_NOT_CONFIGURED, the #2463 code.
 */
import { HttpError } from "../../shared/context.js";
import {
  FORM16_EMPLOYER_NOT_CONFIGURED, deductorNotConfiguredMessage, deductorProblems, normaliseDeductor, type DeductorIdentity,
} from "./domain.js";
import { readTenantDocIdentity } from "./tenant-identity.js";

export type DeductorSource = "documentIdentity" | "env" | null;

/** The effective deductor (GET /v1/payroll/settings/deductor). */
export interface ResolvedDeductor {
  source: DeductorSource;
  name: string | null; tan: string | null; pan: string | null;
  address: string | null;
  deductorCategory: string | null;
  configured: boolean;
  problems: string[];
}

export async function resolveDeductor(tenantId: string): Promise<ResolvedDeductor> {
  const ident = await readTenantDocIdentity(tenantId);
  const hasIdent = ident.orgName !== null || ident.tan !== null || ident.pan !== null;
  if (hasIdent) {
    const v = normaliseDeductor({ name: ident.orgName ?? ident.tenantName, tan: ident.tan, pan: ident.pan });
    const problems = deductorProblems({ ...v, deductorCategory: ident.deductorCategory });
    return {
      source: "documentIdentity", ...v, address: ident.address, deductorCategory: ident.deductorCategory,
      configured: problems.length === 0, problems,
    };
  }
  const env = normaliseDeductor({ name: process.env.EMPLOYER_NAME, tan: process.env.EMPLOYER_TAN, pan: process.env.EMPLOYER_PAN });
  const hasEnv = env.name !== null || env.tan !== null || env.pan !== null;
  // The env fallback has no deductor category: PANNOTREQD needs documentIdentity.deductorCategory.
  const problems = deductorProblems(env);
  return {
    source: hasEnv ? "env" : null, ...env, address: null, deductorCategory: null,
    configured: problems.length === 0, problems,
  };
}

/**
 * The deductor identity for a TDS return / certificate (`what`, e.g. "Form 24Q"),
 * or 422 FORM16_EMPLOYER_NOT_CONFIGURED naming each missing / invalid field.
 */
export async function requireDeductor(tenantId: string, what: string): Promise<DeductorIdentity> {
  const d = await resolveDeductor(tenantId);
  if (!d.configured) throw new HttpError(422, FORM16_EMPLOYER_NOT_CONFIGURED, deductorNotConfiguredMessage(what, d.problems));
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
