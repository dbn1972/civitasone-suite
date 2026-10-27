/**
 * GAP-LOCATIONS-LIST-04: the hrms employee-count client reads the owning service over the internal
 * boundary and fails CLOSED on anything it cannot trust.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { countActiveEmployeesAt } from "../src/shared/hrms-client.js";

const TENANT = randomUUID();
const LOC = randomUUID();

afterEach(() => vi.restoreAllMocks());

describe("countActiveEmployeesAt", () => {
  it("returns the owning service's total and sends the internal tenant-scoped headers", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: [], total: 4 }), { status: 200 }));
    expect(await countActiveEmployeesAt(TENANT, LOC)).toEqual({ ok: true, total: 4 });
    const [url, init] = f.mock.calls[0]!;
    expect(String(url)).toContain(`/v1/hrms/locations/${LOC}/employees?limit=1&status=active`);
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers["x-internal"]).toBe("1");
    expect(headers["x-tenant-id"]).toBe(TENANT);
  });

  it.each([
    ["a non-2xx answer", () => new Response("{}", { status: 502 })],
    ["a 404", () => new Response("{}", { status: 404 })],
    ["a body without a numeric total", () => new Response(JSON.stringify({ data: [] }), { status: 200 })],
    ["a negative total", () => new Response(JSON.stringify({ total: -1 }), { status: 200 })],
    ["a fractional total", () => new Response(JSON.stringify({ total: 1.5 }), { status: 200 })],
  ])("fails closed on %s", async (_name, make) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(make());
    expect(await countActiveEmployeesAt(TENANT, LOC)).toEqual({ ok: false, reason: "unavailable" });
  });

  it("fails closed on a network error or timeout", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));
    expect(await countActiveEmployeesAt(TENANT, LOC)).toEqual({ ok: false, reason: "unavailable" });
  });
});
