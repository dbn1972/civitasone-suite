/**
 * resolveUserNames() caching (GAP-CRM-CONTACTS-DETAIL-01 follow-up). A FAILED or
 * hanging identity lookup is negative-cached for a short window, so
 * GET /v1/crm/teams/agents does not wait out the identity timeout on every
 * request while identity is down; a SUCCESSFUL lookup keeps the longer TTL.
 * Pure unit test (no DB): fetch is stubbed and the clock is faked.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { resolveUserNames, clearDirectoryCache } from "../src/shared/user-directory.js";

const TENANT = "aaaaaaaa-1111-4000-8000-0000000c0203";
const USER = "bbbbbbbb-2222-4000-8000-0000000c0203";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-21T10:00:00Z"));
  clearDirectoryCache();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  clearDirectoryCache();
});

const ok = (rows: unknown) => new Response(JSON.stringify(rows), { status: 200 });

describe("resolveUserNames cache", () => {
  it("does not call identity again within the failure window after a thrown error", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("connect ECONNREFUSED");
    });
    vi.stubGlobal("fetch", fetchMock);

    expect((await resolveUserNames(TENANT, [USER])).size).toBe(0);
    vi.setSystemTime(new Date("2026-10-21T10:00:05Z"));
    expect((await resolveUserNames(TENANT, [USER])).size).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not call identity again within the failure window after a non-2xx answer", async () => {
    const fetchMock = vi.fn(async () => new Response("down", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);

    await resolveUserNames(TENANT, [USER]);
    await resolveUserNames(TENANT, [USER]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries after the failure window and picks names up once identity recovers", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce(ok([{ id: USER, name: "Nita Shah" }]));
    vi.stubGlobal("fetch", fetchMock);

    expect((await resolveUserNames(TENANT, [USER])).get(USER)).toBeUndefined();
    vi.setSystemTime(new Date("2026-10-21T10:00:11Z")); // 11s later: past the 10s failure TTL
    expect((await resolveUserNames(TENANT, [USER])).get(USER)).toBe("Nita Shah");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps a successful lookup for the longer TTL (no refetch at 30s, refetch after 60s)", async () => {
    const fetchMock = vi.fn(async () => ok([{ id: USER, name: "Nita Shah" }]));
    vi.stubGlobal("fetch", fetchMock);

    await resolveUserNames(TENANT, [USER]);
    vi.setSystemTime(new Date("2026-10-21T10:00:30Z"));
    expect((await resolveUserNames(TENANT, [USER])).get(USER)).toBe("Nita Shah");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date("2026-10-21T10:01:01Z"));
    await resolveUserNames(TENANT, [USER]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("concurrent callers during a slow lookup share one identity request", async () => {
    let release: (r: Response) => void = () => {};
    const fetchMock = vi.fn(
      () => new Promise<Response>((resolve) => { release = resolve; }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const a = resolveUserNames(TENANT, [USER]);
    const b = resolveUserNames(TENANT, [USER]);
    release(ok([{ id: USER, name: "Nita Shah" }]));
    expect((await a).get(USER)).toBe("Nita Shah");
    expect((await b).get(USER)).toBe("Nita Shah");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps tenants separate (a failure for one tenant does not blank another)", async () => {
    const OTHER = "aaaaaaaa-1111-4000-8000-0000000c0204";
    const fetchMock = vi.fn(async (_u: string | URL, init?: RequestInit) => {
      const tenant = (init?.headers as Record<string, string>)["x-tenant-id"];
      if (tenant === TENANT) throw new Error("down");
      return ok([{ id: USER, name: "Other Tenant Person" }]);
    });
    vi.stubGlobal("fetch", fetchMock);

    expect((await resolveUserNames(TENANT, [USER])).size).toBe(0);
    expect((await resolveUserNames(OTHER, [USER])).get(USER)).toBe("Other Tenant Person");
  });
});
