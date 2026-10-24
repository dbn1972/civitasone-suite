import { describe, it, expect, vi, beforeEach } from "vitest";
import { adminTenantDirectoryResponseSchema } from "@civitasone/schemas";
import fixture from "./__fixtures__/tenants-list.json";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", async () => {
  const actual = await vi.importActual<typeof import("@/app/_data/apiClient")>("@/app/_data/apiClient");
  return { ...actual, fetchJson: (...args: unknown[]) => fetchJsonMock(...args) };
});

import { getSATenants } from "./loaders";

// Contract for GET /v1/tenants (tenant-service). The same fixture is asserted
// against the REAL service response in services/tenant-service/tests/list-all-tenants.test.ts.
describe("getSATenants against the tenant-service directory response", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  it("the fixture is a valid directory response", () => {
    expect(adminTenantDirectoryResponseSchema.safeParse(fixture).success).toBe(true);
  });

  it("calls the gateway tenants list path and maps the { data } envelope to table rows", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    await getSATenants();
    expect(String(fetchJsonMock.mock.calls[0]![0])).toBe("/api/v1/tenants");
    const opts = fetchJsonMock.mock.calls[0]![2] as { mapResponse: (p: unknown) => Array<Record<string, unknown>> | null };
    const rows = opts.mapResponse(fixture)!;
    expect(rows).toHaveLength(1);
    // the columns the TenantsTable reads
    expect(rows[0]).toMatchObject({ id: fixture.data[0]!.id, name: "Directorate of Rural Development", edition: "govt", status: "active", users: null });
    expect(typeof rows[0]!.createdDate).toBe("string");
  });
});
