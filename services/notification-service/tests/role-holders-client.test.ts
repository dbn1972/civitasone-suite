import { describe, it, expect, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { fetchRoleHolders, RoleHolderLookupError } from "../src/modules/deliveries/role-holders-client.js";

const T = randomUUID();
const q = { scope: "tenant" as const, roles: ["security_admin"], tenantId: T, correlationId: randomUUID(), max: 5000 };
const page = (ids: string[], next: string | null) =>
  new Response(JSON.stringify({ data: ids.map((userId) => ({ userId, tenantId: T })), nextCursor: next }), { status: 200 });

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("fetchRoleHolders", () => {
  it("follows the cursor across pages, sends the internal credential and dedupes users", async () => {
    vi.stubEnv("INTERNAL_SERVICE_SECRET", randomUUID());
    const [a, b, c] = [randomUUID(), randomUUID(), randomUUID()];
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: { headers: Record<string, string> }) => {
      calls.push(url);
      expect(init.headers["x-internal"]).toBe("1");
      expect(init.headers["x-tenant-id"]).toBe(T);
      return calls.length === 1 ? page([a, b], b) : page([b, c], null);
    }));
    const r = await fetchRoleHolders(q);
    expect(r.holders.map((h) => h.userId)).toEqual([a, b, c]);
    expect(r.truncated).toBe(false);
    expect(calls[0]).toContain("scope=tenant");
    expect(calls[0]).toContain("roles=security_admin");
    expect(calls[1]).toContain(`after=${b}`);
  });

  it("stops at the hard cap and says it truncated", async () => {
    vi.stubEnv("INTERNAL_SERVICE_SECRET", randomUUID());
    vi.stubGlobal("fetch", vi.fn(async () => page([randomUUID(), randomUUID(), randomUUID()], null)));
    const r = await fetchRoleHolders({ ...q, max: 2 });
    expect(r.holders).toHaveLength(2);
    expect(r.truncated).toBe(true);
  });

  it("fails loudly (never an empty audience) when identity is down, refuses, or the secret is missing", async () => {
    vi.stubEnv("INTERNAL_SERVICE_SECRET", randomUUID());
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));
    await expect(fetchRoleHolders(q)).rejects.toBeInstanceOf(RoleHolderLookupError);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 403 })));
    await expect(fetchRoleHolders(q)).rejects.toBeInstanceOf(RoleHolderLookupError);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    await expect(fetchRoleHolders(q)).rejects.toBeInstanceOf(RoleHolderLookupError);
    vi.stubEnv("INTERNAL_SERVICE_SECRET", "");
    await expect(fetchRoleHolders(q)).rejects.toBeInstanceOf(RoleHolderLookupError);
  });
});
