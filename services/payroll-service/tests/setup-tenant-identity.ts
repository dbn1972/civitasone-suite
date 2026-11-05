/**
 * Vitest global setup (UAT P3 b19 D-15, fail-closed deductor read).
 *
 * The deductor identity is read from tenant-service and a failed read is a 503 (never an empty
 * identity). The suites that build Form 16 / 24Q / 26Q / 12BA for throwaway tenants have no
 * tenant-service, so each test file starts with a tenant-service that ANSWERS for every tenant with
 * no documentIdentity ("tenant exists, nothing configured"); together with the single-tenant env
 * (vitest.config.ts: PAYROLL_DEDUCTOR_ENV_FALLBACK + EMPLOYER_*) the deductor is the test deployment
 * identity, exactly as before. Only tenant-service GETs are answered; every other URL goes to the
 * real fetch. A suite that tests the read itself (tests/uat-p3-b19-d15-*) calls
 * vi.unstubAllGlobals() in its own beforeAll and stubs what it needs.
 */
import { beforeAll, vi } from "vitest";

beforeAll(() => {
  const realFetch = globalThis.fetch;
  const base = (process.env.TENANT_SERVICE_URL ?? "").replace(/\/$/, "");
  vi.stubGlobal("fetch", (async (input: unknown, init?: unknown) => {
    const url = String(input);
    const prefix = `${base}/v1/tenants/`;
    if (base && url.startsWith(prefix) && !/[/?]/.test(url.slice(prefix.length))) {
      return new Response(JSON.stringify({ data: { id: decodeURIComponent(url.slice(prefix.length)), name: "Test Tenant", settings: {} } }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    }
    return realFetch(input as never, init as never);
  }) as typeof fetch);
});
