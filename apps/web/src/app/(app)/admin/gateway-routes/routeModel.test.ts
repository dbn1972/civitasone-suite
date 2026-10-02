import { describe, it, expect } from "vitest";
import { mapGatewayRoutes } from "./routeModel";

// GAP-ADMIN-GATEWAY-ROUTES-03
describe("mapGatewayRoutes", () => {
  const payload = {
    data: [
      { id: "11111111-1111-4000-8000-000000000001", name: "hrms-leave-requests", module: "hrms", method: "post", path: "/v1/hrms/leave/requests", upstream: "http://hrms:3000", status: "active", updatedAt: "2024-01-15T19:00:00.000Z" },
      { id: "22222222-1111-4000-8000-000000000002", name: "hrms-leave-approvals", module: "hrms", method: "GET", path: "/v1/hrms/leave/approvals", status: "draft" },
      "junk",
    ],
  };
  it("keeps method/path/upstream/status and formats the date", () => {
    const rows = mapGatewayRoutes(payload);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ method: "POST", path: "/v1/hrms/leave/requests", upstream: "http://hrms:3000", status: "active", updated: "16 Jan 2024, 12:30 am" });
    expect(rows[1]).toMatchObject({ upstream: "", updated: "—" });
  });
  it("never invents a 'row-N' id; falls back to method+path+name", () => {
    const rows = mapGatewayRoutes([{ name: "x", method: "GET", path: "/p" }]);
    expect(rows[0]!.id).toBe("GET /p x");
    expect(mapGatewayRoutes(null)).toEqual([]);
  });
});
