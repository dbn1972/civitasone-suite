/**
 * GAP-CRM-ESCALATION-RULES-01 -- the server-side tenant directory the escalation
 * editor's pickers and recipient validation are built on (the picker half of the one
 * consolidated crm-service directory, src/shared/user-directory.ts; the display-name
 * half is covered by identity-names-cache.test.ts). Unit-level: fetch is stubbed.
 * Every failure mode must come back as `undefined` (unverifiable -> callers fail
 * closed), never as an empty list that reads as "there are none", and a failure is
 * never cached.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  listDirectoryRoles,
  listDirectoryUsers,
  searchDirectoryUsers,
  resolveUserNames,
  clearDirectoryCache,
  USER_SEARCH_LIMIT,
} from "../src/shared/user-directory.js";

const TENANT = "11111111-2222-4333-8444-555555555555";
const fetchMock = vi.fn();
const savedSecret = process.env.INTERNAL_SERVICE_SECRET;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
const user = (n: number, status = "active") => ({ id: `u-${n}`, name: `User ${n}`, status, email: `u${n}@example.gov.in` });

beforeEach(() => {
  clearDirectoryCache();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  process.env.INTERNAL_SERVICE_SECRET = globalThis.crypto.randomUUID();
});
afterEach(() => {
  vi.unstubAllGlobals();
  if (savedSecret === undefined) delete process.env.INTERNAL_SERVICE_SECRET;
  else process.env.INTERNAL_SERVICE_SECRET = savedSecret;
});

describe("listDirectoryRoles", () => {
  it("returns the names of ACTIVE roles only, asking policy-service as the caller's tenant over the internal path", async () => {
    fetchMock.mockResolvedValue(json([
      { id: "r1", name: "sales_manager", status: "active" },
      { id: "r2", name: "retired_role", status: "inactive" },
      { id: "r3", name: "lead_desk", status: "active" },
    ]));
    // key = the role name a rule stores in recipientRole; sorted by label.
    expect(await listDirectoryRoles(TENANT)).toEqual([
      { key: "lead_desk", label: "lead_desk" },
      { key: "sales_manager", label: "sales_manager" },
    ]);

    const [url, init] = fetchMock.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(url).toMatch(/\/policy\/roles$/);
    expect(init.headers["x-internal"]).toBe("1");
    expect(init.headers["x-tenant-id"]).toBe(TENANT);
    expect(init.headers["x-service-secret"]).toBe(process.env.INTERNAL_SERVICE_SECRET);
  });

  it("tolerates a { data: [...] } wrapper", async () => {
    fetchMock.mockResolvedValue(json({ data: [{ name: "lead_desk", status: "active" }] }));
    expect(await listDirectoryRoles(TENANT)).toEqual([{ key: "lead_desk", label: "lead_desk" }]);
  });

  it("returns an empty list (not undefined) when the tenant genuinely has no roles", async () => {
    fetchMock.mockResolvedValue(json([]));
    expect(await listDirectoryRoles(TENANT)).toEqual([]);
  });

  it.each([
    ["a 403", () => fetchMock.mockResolvedValue(json({}, 403))],
    ["a 500", () => fetchMock.mockResolvedValue(json({}, 500))],
    ["an unexpected body", () => fetchMock.mockResolvedValue(json({ nope: true }))],
    ["a network failure", () => fetchMock.mockRejectedValue(new Error("ECONNREFUSED"))],
  ])("is undefined (unverifiable) on %s", async (_label, arrange) => {
    arrange();
    expect(await listDirectoryRoles(TENANT)).toBeUndefined();
  });
});

describe("listDirectoryUsers", () => {
  it("returns ACTIVE users as id + display name only (no email), and is not truncated on a short page", async () => {
    fetchMock.mockResolvedValue(json([user(1), user(2, "suspended"), user(3)]));
    const got = await listDirectoryUsers(TENANT);
    expect(got).toEqual({ users: [{ id: "u-1", name: "User 1" }, { id: "u-3", name: "User 3" }], truncated: false });
    expect(JSON.stringify(got)).not.toContain("example.gov.in");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(url).toMatch(/\/identity\/users\?limit=200&offset=0$/);
    expect(init.headers["x-tenant-id"]).toBe(TENANT);
  });

  it("falls back to the id when a user has no display name", async () => {
    fetchMock.mockResolvedValue(json([{ id: "u-9", name: "  ", status: "active" }]));
    expect((await listDirectoryUsers(TENANT))?.users).toEqual([{ id: "u-9", name: "u-9" }]);
  });

  it("pages through full pages and reports truncation when the cap is hit", async () => {
    const fullPage = Array.from({ length: 200 }, (_, i) => user(i));
    fetchMock.mockImplementation(async () => json(fullPage));
    const got = await listDirectoryUsers(TENANT);
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(got?.truncated).toBe(true);
    expect(got?.users.length).toBe(1000);
    const offsets = fetchMock.mock.calls.map((c) => new URL(c[0] as string).searchParams.get("offset"));
    expect(offsets).toEqual(["0", "200", "400", "600", "800"]);
  });

  it("stops at the first short page", async () => {
    fetchMock
      .mockResolvedValueOnce(json(Array.from({ length: 200 }, (_, i) => user(i))))
      .mockResolvedValueOnce(json([user(500)]));
    const got = await listDirectoryUsers(TENANT);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(got?.truncated).toBe(false);
    expect(got?.users.length).toBe(201);
  });

  it.each([
    ["a 403", () => fetchMock.mockResolvedValue(json({}, 403))],
    ["an unexpected body", () => fetchMock.mockResolvedValue(json("nope"))],
    ["a network failure", () => fetchMock.mockRejectedValue(new Error("timeout"))],
  ])("is undefined (unverifiable) on %s, even part-way through paging", async (_label, arrange) => {
    arrange();
    expect(await listDirectoryUsers(TENANT)).toBeUndefined();
  });

  it("is undefined if a later page fails after an earlier one succeeded", async () => {
    fetchMock
      .mockResolvedValueOnce(json(Array.from({ length: 200 }, (_, i) => user(i))))
      .mockResolvedValueOnce(json({}, 500));
    expect(await listDirectoryUsers(TENANT)).toBeUndefined();
  });
});

describe("picker caching (60s on success, never on failure)", () => {
  it("serves a repeat read from the cache and refetches after the 60s window", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-10-21T10:00:00Z"));
      fetchMock.mockImplementation(async () => json([user(1)]));
      await listDirectoryUsers(TENANT);
      await listDirectoryUsers(TENANT);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      vi.setSystemTime(new Date("2026-10-21T10:01:01Z"));
      await listDirectoryUsers(TENANT);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("`fresh` skips the cache read (a role or user added a moment ago is seen) and refreshes it", async () => {
    fetchMock.mockImplementation(async () => json([user(1)]));
    await listDirectoryUsers(TENANT);
    fetchMock.mockImplementation(async () => json([user(1), user(2)]));
    expect((await listDirectoryUsers(TENANT))?.users).toHaveLength(1); // cached
    expect((await listDirectoryUsers(TENANT, { fresh: true }))?.users).toHaveLength(2);
    expect((await listDirectoryUsers(TENANT))?.users).toHaveLength(2); // the fresh answer is now the cached one
  });

  it("never caches a failure: the very next read asks again and recovers at once", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    expect(await listDirectoryUsers(TENANT)).toBeUndefined();
    fetchMock.mockResolvedValueOnce(json([user(1)]));
    expect((await listDirectoryUsers(TENANT))?.users).toEqual([{ id: "u-1", name: "User 1" }]);

    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(json({}, 503));
    expect(await listDirectoryRoles(TENANT)).toBeUndefined();
    fetchMock.mockResolvedValueOnce(json([{ name: "lead_desk", status: "active" }]));
    expect(await listDirectoryRoles(TENANT)).toEqual([{ key: "lead_desk", label: "lead_desk" }]);
  });

  it("keeps tenants apart", async () => {
    fetchMock.mockImplementation(async (_u: string, init: { headers: Record<string, string> }) =>
      json(init.headers["x-tenant-id"] === TENANT ? [user(1)] : [user(2)]));
    expect((await listDirectoryUsers(TENANT))?.users[0]?.id).toBe("u-1");
    expect((await listDirectoryUsers("99999999-2222-4333-8444-555555555555"))?.users[0]?.id).toBe("u-2");
  });
});

describe("the two halves of the directory disagree about deactivated users ON PURPOSE", () => {
  it("names a deactivated user (a record they last changed must still say who) but never offers them in a picker", async () => {
    const gone = "bbbbbbbb-2222-4333-8444-000000000009";
    fetchMock.mockImplementation(async (url: string) =>
      url.includes("/identity/internal/user-summaries")
        ? json([{ id: gone, name: "Retired Officer" }, { id: "u-1", name: "User 1" }])
        : json([user(1), { id: gone, name: "Retired Officer", status: "suspended" }]));

    expect((await resolveUserNames(TENANT, [gone])).get(gone)).toBe("Retired Officer");
    const pickers = await listDirectoryUsers(TENANT);
    expect(pickers?.users.map((u) => u.id)).toEqual(["u-1"]);
  });

  it("sorts the picker by name", async () => {
    fetchMock.mockResolvedValue(json([{ id: "u-b", name: "Zoya", status: "active" }, { id: "u-a", name: "Anil", status: "active" }]));
    expect((await listDirectoryUsers(TENANT))?.users.map((u) => u.name)).toEqual(["Anil", "Zoya"]);
  });
});

describe("searchDirectoryUsers (server-side name search past the browse bound)", () => {
  const hit = (n: number) => ({ id: `u-${n}`, displayName: `User ${String(n).padStart(2, "0")}` });

  it("asks identity's shared directory for the encoded query as the caller's tenant over the internal path", async () => {
    fetchMock.mockResolvedValue(json({ data: [hit(1)] }));
    await searchDirectoryUsers(TENANT, "Asha & Rao");
    const [url, init] = fetchMock.mock.calls[0] as [string, { headers: Record<string, string> }];
    const u = new URL(url);
    expect(u.pathname).toBe("/identity/users/directory");
    expect(u.searchParams.get("q")).toBe("Asha & Rao");
    expect(u.searchParams.get("limit")).toBe(String(USER_SEARCH_LIMIT));
    expect(init.headers["x-internal"]).toBe("1");
    expect(init.headers["x-tenant-id"]).toBe(TENANT);
    expect(init.headers["x-service-secret"]).toBe(process.env.INTERNAL_SERVICE_SECRET);
  });

  it("returns { id, name } only, sorted by name, from identity's { id, displayName } rows", async () => {
    fetchMock.mockResolvedValue(json({ data: [
      { id: "u-b", displayName: "Zoya", email: "z@example.gov.in", status: "active" },
      { id: "u-a", displayName: "Anil", phone: "+919876500002" },
    ] }));
    const got = await searchDirectoryUsers(TENANT, "an");
    expect(got).toEqual({ users: [{ id: "u-a", name: "Anil" }, { id: "u-b", name: "Zoya" }], truncated: false });
    expect(JSON.stringify(got)).not.toContain("example.gov.in");
    expect(JSON.stringify(got)).not.toContain("9876500002");
  });

  it("lists a match with no display name by id, and skips a row with no id", async () => {
    fetchMock.mockResolvedValue(json({ data: [{ id: "u-9", displayName: "  " }, { displayName: "No id" }, null] }));
    expect((await searchDirectoryUsers(TENANT, "us"))?.users).toEqual([{ id: "u-9", name: "u-9" }]);
  });

  it("is truncated exactly when the cap was reached (more people may match), not before", async () => {
    fetchMock.mockResolvedValueOnce(json({ data: Array.from({ length: USER_SEARCH_LIMIT - 1 }, (_, i) => hit(i)) }));
    expect((await searchDirectoryUsers(TENANT, "us"))?.truncated).toBe(false);
    fetchMock.mockResolvedValueOnce(json({ data: Array.from({ length: USER_SEARCH_LIMIT }, (_, i) => hit(i)) }));
    expect((await searchDirectoryUsers(TENANT, "us"))?.truncated).toBe(true);
  });

  it("is an empty, NOT truncated, list for a query that matches nobody", async () => {
    fetchMock.mockResolvedValue(json({ data: [] }));
    expect(await searchDirectoryUsers(TENANT, "zzzz")).toEqual({ users: [], truncated: false });
  });

  it.each([
    ["a 400", () => fetchMock.mockResolvedValue(json({}, 400))],
    ["a 500", () => fetchMock.mockResolvedValue(json({}, 500))],
    ["an unexpected body", () => fetchMock.mockResolvedValue(json({ nope: true }))],
    ["a network failure", () => fetchMock.mockRejectedValue(new Error("ECONNREFUSED"))],
  ])("is undefined (unverifiable, fail-closed) on %s", async (_label, arrange) => {
    arrange();
    expect(await searchDirectoryUsers(TENANT, "us")).toBeUndefined();
  });

  it("is never cached: every search sees the directory as it is now", async () => {
    fetchMock.mockResolvedValueOnce(json({ data: [hit(1)] }));
    expect((await searchDirectoryUsers(TENANT, "us"))?.users).toHaveLength(1);
    fetchMock.mockResolvedValueOnce(json({ data: [hit(1), hit(2)] }));
    expect((await searchDirectoryUsers(TENANT, "us"))?.users).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
