import { describe, it, expect, vi, beforeEach } from "vitest";

const revalidateTag = vi.fn();
vi.mock("next/cache", () => ({ revalidateTag: (t: string) => revalidateTag(t) }));

import { shouldPurgeAfterWrite, cachedFetchOptions, capRevalidate, dataCacheTags, purgeTenantDataCache, ALL_TAG } from "./dataCache";

function jwt(claims: Record<string, unknown>): string {
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${enc({ alg: "RS256" })}.${enc(claims)}.sig`;
}

const TENANT_A = "11111111-0000-0000-0000-000000000001";
const TENANT_B = "22222222-0000-0000-0000-000000000002";

describe("web data cache tagging and purge (UAT b23 P1/M4)", () => {
  beforeEach(() => revalidateTag.mockReset());

  it("tags reads with the caller's tenant, never another tenant's", () => {
    expect(dataCacheTags(jwt({ tid: TENANT_A }))).toEqual([`civ:t:${TENANT_A}`]);
    expect(dataCacheTags(jwt({ tid: TENANT_B }))).toEqual([`civ:t:${TENANT_B}`]);
  });

  it("falls back to the shared tag for a missing, garbled or hostile tid", () => {
    expect(dataCacheTags(undefined)).toEqual([ALL_TAG]);
    expect(dataCacheTags("not-a-jwt")).toEqual([ALL_TAG]);
    expect(dataCacheTags(jwt({ tid: "a,b" }))).toEqual([ALL_TAG]);
    expect(dataCacheTags(jwt({}))).toEqual([ALL_TAG]);
  });

  it("a write purges only the writer's tenant tag", () => {
    purgeTenantDataCache(jwt({ tid: TENANT_A }));
    expect(revalidateTag).toHaveBeenCalledTimes(1);
    expect(revalidateTag).toHaveBeenCalledWith(`civ:t:${TENANT_A}`);
  });

  it("a purge failure never throws", () => {
    revalidateTag.mockImplementationOnce(() => { throw new Error("static generation store missing"); });
    expect(() => purgeTenantDataCache(jwt({ tid: TENANT_A }))).not.toThrow();
  });

  it("caps dynamic revalidate windows but leaves static master data alone", () => {
    expect(capRevalidate(30)).toBe(5);
    expect(capRevalidate(15)).toBe(5);
    expect(capRevalidate(3)).toBe(3);
    expect(capRevalidate(600)).toBe(600);
    expect(cachedFetchOptions(60, jwt({ tid: TENANT_A }))).toEqual({ revalidate: 5, tags: [`civ:t:${TENANT_A}`] });
  });
});

describe("shouldPurgeAfterWrite allow-list", () => {
  it("purges for authenticated state-changing writes", () => {
    expect(shouldPurgeAfterWrite("POST", "v1/procurement/indents/i1/approve")).toBe(true);
    expect(shouldPurgeAfterWrite("PATCH", "v1/hrms/leave-applications/l1")).toBe(true);
    expect(shouldPurgeAfterWrite("DELETE", "v1/x/y")).toBe(true);
    expect(shouldPurgeAfterWrite("POST", "v1/payments/verify")).toBe(true);
  });
  it("skips reads, read-only POSTs and public routes", () => {
    expect(shouldPurgeAfterWrite("GET", "v1/a")).toBe(false);
    expect(shouldPurgeAfterWrite("POST", "v1/documents/search")).toBe(false);
    expect(shouldPurgeAfterWrite("POST", "v1/finance/budget/lines/validate")).toBe(false);
    expect(shouldPurgeAfterWrite("POST", "v1/careers/apply")).toBe(false);
    expect(shouldPurgeAfterWrite("POST", "identity/auth/login")).toBe(false);
    expect(shouldPurgeAfterWrite("POST", "v1/crm/public/leads")).toBe(false);
  });
  it("a forged-tid token on a public route cannot purge any tenant", () => {
    revalidateTag.mockReset();
    const forged = jwt({ tid: TENANT_B });
    if (shouldPurgeAfterWrite("POST", "v1/crm/public/leads")) purgeTenantDataCache(forged);
    expect(revalidateTag).not.toHaveBeenCalled();
  });
});
