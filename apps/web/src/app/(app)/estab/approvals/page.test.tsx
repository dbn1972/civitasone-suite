import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

const requireAnyRole = vi.fn();
vi.mock("@/lib/auth/roleGuard", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/roleGuard")>("@/lib/auth/roleGuard");
  return { ...actual, requireAnyRole: (...a: unknown[]) => requireAnyRole(...a) };
});

// The panel itself fetches on mount; stub it so the page test stays focused on the gate.
vi.mock("./EstabApprovalsPanel", () => ({ EstabApprovalsPanel: () => <div>panel</div> }));

import Page from "./page";
import { ESTAB_APPROVER_ROLES } from "@/lib/auth/roleGuard";

describe("eOffice Approvals page gate (GAP-ESTAB-APPROVALS-04)", () => {
  beforeEach(() => requireAnyRole.mockReset());

  it("gates the page on the establishment approver roles", () => {
    render(Page());
    expect(requireAnyRole).toHaveBeenCalledWith(ESTAB_APPROVER_ROLES);
  });

  it("subtitle makes no false 'e-Signed' claim (GAP-ESTAB-APPROVALS-02)", () => {
    const { container } = render(Page());
    expect(container.textContent).not.toMatch(/e-Signed/i);
  });
});
