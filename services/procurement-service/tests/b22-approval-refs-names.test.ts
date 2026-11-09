/**
 * Bundle 22 W3 (approvals inbox): requester names on ref summaries resolve HRMS-first,
 * so UAT personas absent from identity's directory still get a name.
 */
import { describe, it, expect, afterEach, vi } from "vitest";

const INDENT = { id: "c2c2c2c2-4444-4000-8000-000000000001", indentNo: "IND-2627-000014", totalMinor: 1250000, createdBy: "0a82f891-2b3c-43c3-af76-a5418f2c658f" };
vi.mock("../src/modules/approvals/repo.js", () => ({
  findIndentsByIds: vi.fn(async () => [INDENT]),
  findPosByIds: vi.fn(async () => []),
  findAmendmentsByIds: vi.fn(async () => []),
}));
import { resolveApprovalRefs } from "../src/modules/approvals/queries.js";

afterEach(() => vi.restoreAllMocks());

describe("resolveApprovalRefs requester name", () => {
  it("uses the HRMS employee linked to the login, with identity as fallback", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/v1/hrms/internal/employee-summaries")) return new Response(JSON.stringify([{ userRef: INDENT.createdBy, fullName: "UX Tester Two" }]));
      if (url.includes("/identity/internal/user-summaries")) return new Response("[]");
      throw new Error(`unexpected fetch ${url}`);
    });
    const [row] = await resolveApprovalRefs("c2c2c2c2-1111-4000-8000-000000000001", [{ refType: "procurement_indent", refId: INDENT.id }]);
    expect(row?.requestedBy).toBe("UX Tester Two");
  });
});
