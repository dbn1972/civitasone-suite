import { describe, it, expect } from "vitest";
import { toOperatorDto } from "../src/modules/operators/queries.js";

const T = "11111111-1111-1111-1111-111111111111";
const EMP = "22222222-2222-2222-2222-222222222222";

function row(over: Record<string, unknown> = {}) {
  return {
    id: "op-1", tenantId: T, employeeId: EMP, division: "PWD", departmentId: null,
    section: null, deskRole: "dealing_hand", clearanceLevel: 1, canInitiate: true,
    active: true, assignedBy: T, createdAt: new Date(), updatedAt: new Date(),
    createdBy: T, updatedBy: T, version: 1,
    ...over,
  } as Parameters<typeof toOperatorDto>[0];
}

describe("toOperatorDto — officer name enrichment (GAP-ESTAB-OPERATORS-01)", () => {
  it("resolves employeeName/departmentName when the directory map has the id", () => {
    const map = new Map([[EMP, { fullName: "R. Sharma", departmentName: "Public Works" }]]);
    const dto = toOperatorDto(row(), map);
    expect(dto.employeeId).toBe(EMP);
    expect(dto.employeeName).toBe("R. Sharma");
    expect(dto.departmentName).toBe("Public Works");
  });

  it("omits the name (never fabricates) when the id cannot be resolved", () => {
    const dto = toOperatorDto(row(), new Map());
    expect(dto.employeeId).toBe(EMP);
    expect(dto.employeeName).toBeUndefined();
    expect(dto.departmentName).toBeUndefined();
  });
});
