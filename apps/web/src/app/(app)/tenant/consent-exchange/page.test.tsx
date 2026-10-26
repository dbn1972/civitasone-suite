import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@/test-utils/intl-render";

let roles: string[] = [];
vi.mock("@/lib/auth/roleGuard", () => ({ getSessionRoles: () => roles }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("../_data", () => ({
  getTenantConsentExchange: () => Promise.resolve({
    data: [
      { id: "c1", label: "Assess — Revenue", status: "Requested" },
      { id: "c2", label: "Survey — Land", status: "Active" },
    ],
    source: "api" as const,
  }),
}));

import Page from "./page";

describe("consent exchange page (owner decision #19)", () => {
  beforeEach(() => { roles = []; });

  it("tenant_admin is view-only: no approve/reject controls", async () => {
    roles = ["tenant_admin"];
    render(await Page());
    expect(screen.queryByRole("button", { name: /Approve/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Reject/ })).toBeNull();
    expect(screen.getByRole("note").textContent).toMatch(/reserved to the consent officer/i);
  });

  it("consent_officer sees decision controls for pending requests only", async () => {
    roles = ["consent_officer"];
    render(await Page());
    expect(screen.getByRole("button", { name: /Approve: Assess — Revenue/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Approve: Survey/ })).toBeNull();
  });
});
