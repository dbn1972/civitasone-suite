import { describe, it, expect, vi, beforeEach } from "vitest";

// Admin user list paging (UAT 11 Nov 2026). The identity user list answers at most 200 rows per call, so the
// loaders that want everyone must walk the pages, and the admin users screen must read the search endpoint that
// carries a real total. fetchJson is stubbed per URL; each loader's own mapResponse runs on a realistic payload.
const fetchedUrls: string[] = [];
let handler: (url: string) => { payload: unknown } | { fail: number };

vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (url: string, fallback: unknown, opts: { mapResponse: (p: unknown) => unknown }) => {
    fetchedUrls.push(url);
    const r = handler(url);
    if ("fail" in r) return Promise.resolve({ data: fallback, source: "error", status: r.fail });
    return Promise.resolve({ data: opts.mapResponse(r.payload), source: "api" });
  },
}));

import { getLoaderFallbackEvents } from "./loaderTelemetry";
import { getAdminUsers, getAdminUsersPage, getTenantUsers, getMfaUsers, ADMIN_USERS_PAGE_SIZE } from "./loaders";

const user = (n: number) => ({ id: `u-${n}`, tenantId: "t", email: `u${n}@dept.gov.in`, name: `User ${n}`, empCode: null, status: "active", mfaEnabled: false, version: 1 });
const page = (from: number, count: number) => Array.from({ length: count }, (_, i) => user(from + i));
const offsetOf = (url: string) => Number(new URL(url, "http://x").searchParams.get("offset"));

beforeEach(() => { fetchedUrls.length = 0; });

describe("getAdminUsersPage reads the search endpoint with a real total", () => {
  it("maps identity-service's { rows, total, counts } and asks for the right window", async () => {
    handler = () => ({ payload: { rows: page(26, 25), total: 1240, counts: { active: 1100, suspended: 100, locked: 0, deactivated: 40 } } });
    const res = await getAdminUsersPage({ page: 2 });
    expect(fetchedUrls[0]).toContain("/api/v1/admin/users/search?");
    expect(new URL(fetchedUrls[0]!, "http://x").searchParams.get("limit")).toBe(String(ADMIN_USERS_PAGE_SIZE));
    expect(offsetOf(fetchedUrls[0]!)).toBe(ADMIN_USERS_PAGE_SIZE);
    expect(res.data.rows).toHaveLength(25);
    expect(res.data.total).toBe(1240);
    expect(res.data.counts).toEqual({ active: 1100, suspended: 100, locked: 0, deactivated: 40 });
    expect(res.data.page).toBe(2);
  });

  it("still reads the admin-service { data, meta } envelope", async () => {
    handler = () => ({ payload: { data: page(1, 3), meta: { total: 3, counts: { active: 3, suspended: 0, locked: 0, deactivated: 0 } } } });
    const res = await getAdminUsersPage();
    expect(res.data.rows).toHaveLength(3);
    expect(res.data.total).toBe(3);
  });
});

describe("getAdminUsers / getTenantUsers walk the 200-row pages", () => {
  it("the 200/201 boundary: a full first page triggers a second request and the 201st user is kept", async () => {
    handler = (url) => ({ payload: offsetOf(url) === 0 ? page(1, 200) : page(201, 1) });
    const res = await getAdminUsers();
    expect(res.source).toBe("api");
    expect(res.data).toHaveLength(201);
    expect(fetchedUrls.map(offsetOf)).toEqual([0, 200]);
    expect(fetchedUrls.every((u) => new URL(u, "http://x").searchParams.get("limit") === "200")).toBe(true);
  });

  it("fewer than 200 users costs a single request", async () => {
    handler = () => ({ payload: page(1, 12) });
    const res = await getTenantUsers();
    expect(res.data).toHaveLength(12);
    expect(fetchedUrls).toHaveLength(1);
  });

  it("a failing later page is an error result, never a silently truncated list", async () => {
    handler = (url) => (offsetOf(url) === 0 ? { payload: page(1, 200) } : { fail: 503 });
    const res = await getAdminUsers();
    expect(res.source).toBe("error");
    expect(res.status).toBe(503);
    expect(res.data).toEqual([]);
  });
});

describe("getMfaUsers walks the pages instead of showing only the endpoint's default 20", () => {
  const mfa = (n: number) => ({ id: `m-${n}`, name: `M ${n}`, email: `m${n}@dept.gov.in`, department: "", mfaStatus: "enabled", enrolledAt: null });
  it("requests limit=200 and follows the 200/201 boundary", async () => {
    handler = (url) => ({ payload: { data: offsetOf(url) === 0 ? Array.from({ length: 200 }, (_, i) => mfa(i)) : [mfa(200)], meta: {} } });
    const res = await getMfaUsers();
    expect(res.data).toHaveLength(201);
    expect(res.truncated).toBeUndefined();
    expect(fetchedUrls.every((u) => u.startsWith("/api/v1/admin/mfa/users?limit=200&offset="))).toBe(true);
    expect(fetchedUrls.map(offsetOf)).toEqual([0, 200]);
  });
});

describe("page cap: a truncated list is flagged and logged, never silent", () => {
  it("returns truncated: true and warns when the last allowed page is still full", async () => {
    handler = () => ({ payload: page(1, 200) });
    const res = await getAdminUsers();
    expect(res.source).toBe("api");
    expect(res.truncated).toBe(true);
    expect(res.data).toHaveLength(5000);
    expect(fetchedUrls).toHaveLength(25);
    expect(getLoaderFallbackEvents().some((e) => e.reason === "truncated" && e.key === "admin.users")).toBe(true);
  });
});
