/**
 * Vitest setup file for services that render official documents (UAT P3 #2463 delta: resolveDocIdentity
 * fails closed). Those suites run without a tenant-service, so each test file starts with a tenant-service
 * that ANSWERS for every tenant with no documentIdentity and no name ("tenant exists, nothing configured"),
 * which is the identity the suites always saw when the read used to fail open. Only tenant-service
 * GET /v1/tenants/:id is answered; every other URL goes to the real fetch. A suite that tests the read itself
 * calls vi.unstubAllGlobals() / stubs fetch on its own.
 *
 * Use from a service vitest.config.ts: setupFiles: ["../../packages/render/test-support/tenant-identity-setup.ts"]
 */
import { beforeAll, vi } from "vitest";

beforeAll(() => {
  const realFetch = globalThis.fetch;
  vi.stubGlobal("fetch", (async (input: unknown, init?: unknown) => {
    const url = String(input);
    const base = (process.env.TENANT_SERVICE_URL ?? "http://127.0.0.1:3002").replace(/\/$/, "");
    const prefix = `${base}/v1/tenants/`;
    if (url.startsWith(prefix) && !/[/?]/.test(url.slice(prefix.length))) {
      return new Response(JSON.stringify({ data: { id: decodeURIComponent(url.slice(prefix.length)), settings: {} } }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    }
    return realFetch(input as never, init as never);
  }) as typeof fetch);
});
