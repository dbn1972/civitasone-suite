/**
 * Bundle 22 W3: approval-trail actors resolve to names even when identity-service's user
 * directory has no row for the login (UAT personas live in Keycloak + HRMS only).
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { indentApprovalTrail } from "../src/modules/indent/queries.js";

const TENANT = "c2c2c2c2-1111-4000-8000-000000000001";
const INDENT = "c2c2c2c2-4444-4000-8000-000000000001";
const CHECKER = "0a82f891-2b3c-43c3-af76-a5418f2c658f";
const HEAD = "40560d45-deab-4999-a26e-9756ed8ca59e";
const UNKNOWN = "5a5a5a5a-3333-4000-8000-000000000009";

afterEach(() => vi.restoreAllMocks());

function stub(hrms: Array<{ userRef: string; fullName: string }>, identity: Array<{ id: string; name: string }> = []) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes("/v1/workflow/internal/ref-decisions")) {
      return new Response(JSON.stringify({ data: [
        { action: "return", decision: "return", actorId: CHECKER, nodeKey: "proc_officer", reason: "Revise quantity", at: "2026-11-08T12:05:52.230Z" },
        { action: "reject", decision: "reject", actorId: HEAD, nodeKey: "proc_officer", reason: "Not budgeted", at: "2026-11-08T12:09:00.000Z" },
        { action: "complete", decision: "approve", actorId: UNKNOWN, nodeKey: "proc_officer", reason: null, at: "2026-11-08T12:10:00.000Z" },
      ] }));
    }
    if (url.includes("/v1/hrms/internal/employee-summaries")) return new Response(JSON.stringify(hrms));
    if (url.includes("/identity/internal/user-summaries")) return new Response(JSON.stringify(identity));
    throw new Error(`unexpected fetch ${url}`);
  });
}

describe("W3: indent approval trail actor names", () => {
  it("names actors from the HRMS employee linked to the login", async () => {
    stub([{ userRef: CHECKER, fullName: "UX Tester Two" }, { userRef: HEAD, fullName: "Meera Nair" }]);
    const { entries } = await indentApprovalTrail(TENANT, INDENT);
    expect(entries.map((e) => e.actor)).toEqual(["UX Tester Two", "Meera Nair", "Unknown user"]);
    expect(entries.map((e) => e.action)).toEqual(["Returned", "Rejected", "Approved"]);
  });

  it("falls back to identity-service for ids HRMS does not know, then to a non-id label", async () => {
    stub([{ userRef: CHECKER, fullName: "UX Tester Two" }], [{ id: HEAD, name: "Meera Nair" }]);
    const { entries } = await indentApprovalTrail(TENANT, INDENT);
    expect(entries.map((e) => e.actor)).toEqual(["UX Tester Two", "Meera Nair", "Unknown user"]);
    expect(JSON.stringify(entries)).not.toContain(UNKNOWN);
  });
});
