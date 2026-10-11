import { signToken } from "@civitasone/auth";

// vitest.config.ts generates JWT_SECRET per run and injects it via test.env.
export const SECRET = process.env.JWT_SECRET as string;
if (!SECRET) throw new Error("JWT_SECRET not set; run via vitest (vitest.config.ts generates it).");

export function tokenFor(tenantId: string, actorId: string, roles: string[], jurisdictionUnitIds?: string[]) {
  const claims: Record<string, unknown> = { sub: actorId, tid: tenantId, roles, sid: "sess-st" };
  if (jurisdictionUnitIds) claims.jurisdiction_unit_ids = jurisdictionUnitIds;
  return signToken(claims as never, SECRET, 3600);
}

export function authHeader(tenantId: string, actorId: string, roles: string[], jurisdictionUnitIds?: string[]) {
  return { authorization: `Bearer ${tokenFor(tenantId, actorId, roles, jurisdictionUnitIds)}` };
}

/**
 * Stub global.fetch so the in-service entitlement re-check
 * (shared/entitlement.ts → GET /v1/admin/composition/internal/:tid/modules)
 * resolves without a live admin-service. `decide(tenantId)` returns the body
 * the admin composition endpoint would return, or throws to simulate an outage.
 */
export function stubCompositionFetch(
  decide: (tenantId: string) => { configured?: boolean; data?: Array<{ name: string }> } | "throw",
): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input.toString();
    const m = /\/v1\/admin\/composition\/internal\/([^/]+)\/modules/.exec(url);
    if (!m) throw new Error(`unexpected fetch in test: ${url}`);
    const result = decide(m[1] as string);
    if (result === "throw") throw new Error("admin-service unreachable (stubbed)");
    return new Response(JSON.stringify(result), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}
