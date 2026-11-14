/**
 * fetchLocation (employee location assignment): maps location-service answers to found / not_found /
 * unavailable and fails CLOSED on anything it cannot verify.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchLocation } from "../shared/location-client.js";

const TENANT = "c0de0000-0000-4000-8000-000000000001";
const LOC = "c0de0000-0000-4000-8000-0000000000a1";

const reply = (status: number, body?: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response;

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("fetchLocation", () => {
  it("returns the id and status of a location in the caller tenant, sending the tenant header", async () => {
    const f = vi.fn(async () => reply(200, { location: { id: LOC, tenantId: TENANT, status: "active" } }));
    vi.stubGlobal("fetch", f);
    await expect(fetchLocation(TENANT, LOC)).resolves.toEqual({ ok: true, id: LOC, status: "active" });
    const [url, init] = f.mock.calls[0] as unknown as [string, { headers: Record<string, string> }];
    expect(url).toContain(`/v1/locations/${LOC}/hierarchy`);
    expect(init.headers["x-tenant-id"]).toBe(TENANT);
  });

  it("a 404 is not_found (unknown id and another tenant look the same)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply(404)));
    await expect(fetchLocation(TENANT, LOC)).resolves.toEqual({ ok: false, reason: "not_found" });
  });

  it("a tenant mismatch in the body is not_found (never trust the owning side alone)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply(200, { location: { id: LOC, tenantId: "other-tenant", status: "active" } })));
    await expect(fetchLocation(TENANT, LOC)).resolves.toEqual({ ok: false, reason: "not_found" });
  });

  it("5xx, malformed body, wrong id and network errors are unavailable (fail closed)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply(500)));
    await expect(fetchLocation(TENANT, LOC)).resolves.toEqual({ ok: false, reason: "unavailable" });

    vi.stubGlobal("fetch", vi.fn(async () => reply(200, {})));
    await expect(fetchLocation(TENANT, LOC)).resolves.toEqual({ ok: false, reason: "unavailable" });

    vi.stubGlobal("fetch", vi.fn(async () => reply(200, { location: { id: "different", status: "active" } })));
    await expect(fetchLocation(TENANT, LOC)).resolves.toEqual({ ok: false, reason: "unavailable" });

    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));
    await expect(fetchLocation(TENANT, LOC)).resolves.toEqual({ ok: false, reason: "unavailable" });
  });
});
