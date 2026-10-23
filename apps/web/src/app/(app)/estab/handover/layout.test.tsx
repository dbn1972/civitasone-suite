import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// GAP-ESTAB-HANDOVER-02: drive the session roles through the access-token cookie and observe redirect().
const mockGet = vi.fn();
vi.mock("next/headers", () => ({ cookies: () => ({ get: mockGet }) }));
const mockRedirect = vi.fn();
vi.mock("next/navigation", () => ({ redirect: (...a: unknown[]) => mockRedirect(...a) }));

function makeJwt(payload: Record<string, unknown>): string {
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${enc({ alg: "HS256", typ: "JWT" })}.${enc(payload)}.sig`;
}
function sessionWithRoles(roles: string[]) {
  mockGet.mockReturnValue({ value: makeJwt({ sub: "user-1", roles }) });
}

import HandoverLayout from "./layout";

describe("HandoverLayout - bulk charge handover is administrators-only (GAP-ESTAB-HANDOVER-02)", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockRedirect.mockReset();
  });

  it.each(["estab_officer", "audit_officer", "employee"])("sends %s back to /estab: they cannot move another desk's files", (role) => {
    sessionWithRoles([role]);
    render(<HandoverLayout>{"handover form"}</HandoverLayout>);
    expect(mockRedirect).toHaveBeenCalledWith("/estab");
  });

  it("sends a session with no roles back to /estab", () => {
    sessionWithRoles([]);
    render(<HandoverLayout>{"handover form"}</HandoverLayout>);
    expect(mockRedirect).toHaveBeenCalledWith("/estab");
  });

  // The same three roles the estab-service POST /v1/estab/handovers accepts.
  it.each(["estab_division_admin", "estab_admin", "super_admin"])("shows the handover form to %s", (role) => {
    sessionWithRoles([role]);
    render(<HandoverLayout>{"handover form"}</HandoverLayout>);
    expect(mockRedirect).not.toHaveBeenCalled();
    expect(screen.getByText("handover form")).toBeInTheDocument();
  });
});
