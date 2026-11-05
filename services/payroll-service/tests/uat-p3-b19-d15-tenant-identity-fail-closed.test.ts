/**
 * UAT P3 b19 D-15 (delta review should-fix 1): readTenantDocIdentity fails CLOSED.
 * A tenant-service error is a TenantIdentityUnavailableError (-> 503 at the route),
 * never an empty identity; a successful read of a tenant with no documentIdentity is
 * a normal empty identity (-> 422 not configured). Pure: the fetch is injected.
 */
import { describe, it, expect, afterEach } from "vitest";
import {
  EMPTY_TENANT_DOC_IDENTITY, TenantIdentityUnavailableError, readTenantDocIdentity, resetTenantDocIdentityCache,
  type FetchLike,
} from "../src/modules/deductor-config/tenant-identity.js";

afterEach(() => resetTenantDocIdentityCache());

const reply = (ok: boolean, body: unknown | (() => never)): ReturnType<FetchLike> =>
  Promise.resolve({ ok, json: async () => (typeof body === "function" ? (body as () => never)() : body) });

describe("readTenantDocIdentity fails closed", () => {
  it("fetch rejection (timeout / connection refused) throws TenantIdentityUnavailableError", async () => {
    const f: FetchLike = () => Promise.reject(new TypeError("fetch failed"));
    await expect(readTenantDocIdentity("t-1", f)).rejects.toBeInstanceOf(TenantIdentityUnavailableError);
  });
  it("non-2xx throws", async () => {
    await expect(readTenantDocIdentity("t-2", () => reply(false, {}))).rejects.toBeInstanceOf(TenantIdentityUnavailableError);
  });
  it("unreadable or non-object body throws", async () => {
    await expect(readTenantDocIdentity("t-3", () => reply(true, () => { throw new SyntaxError("bad json"); }))).rejects.toBeInstanceOf(TenantIdentityUnavailableError);
    await expect(readTenantDocIdentity("t-4", () => reply(true, null))).rejects.toBeInstanceOf(TenantIdentityUnavailableError);
    await expect(readTenantDocIdentity("t-5", () => reply(true, "text"))).rejects.toBeInstanceOf(TenantIdentityUnavailableError);
  });
  it("a failure is never cached", async () => {
    let calls = 0;
    const f: FetchLike = () => { calls += 1; return calls === 1 ? reply(false, {}) : reply(true, { data: { name: "T", settings: { documentIdentity: { tan: "delp12345c" } } } }); };
    await expect(readTenantDocIdentity("t-6", f)).rejects.toBeInstanceOf(TenantIdentityUnavailableError);
    expect((await readTenantDocIdentity("t-6", f)).tan).toBe("DELP12345C");
  });
  it("a successful read with no documentIdentity is an empty identity (not an error)", async () => {
    const got = await readTenantDocIdentity("t-7", () => reply(true, { data: { name: "Tenant", settings: {} } }));
    expect(got).toEqual({ ...EMPTY_TENANT_DOC_IDENTITY, tenantName: "Tenant" });
  });
});
