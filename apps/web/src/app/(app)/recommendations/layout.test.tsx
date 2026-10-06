import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/auth/roleGuard", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/roleGuard")>("@/lib/auth/roleGuard");
  return { ...actual, getSessionRoles: vi.fn() };
});
// ModuleGate is an async Server Component that reaches the network; stub it.
vi.mock("../ModuleGate", () => ({
  ModuleGate: ({ children }: { children: React.ReactNode }) => <div data-testid="gate">{children}</div>,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { getSessionRoles } from "@/lib/auth/roleGuard";
import Layout from "./layout";

const mRoles = vi.mocked(getSessionRoles);

describe("recommendations layout role gate (GAP-RECOMMENDATIONS-HEALTH-02)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders PermissionDenied for a role without recommendation access", () => {
    mRoles.mockReturnValue(["employee"]);
    render(<Layout><div>secret</div></Layout>);
    expect(screen.queryByTestId("gate")).not.toBeInTheDocument();
    expect(screen.queryByText("secret")).not.toBeInTheDocument();
    expect(screen.getByText(/Access restricted/i)).toBeInTheDocument();
  });

  it("admits a user with a recommendation role to the module gate", () => {
    mRoles.mockReturnValue(["crm_user"]);
    render(<Layout><div>secret</div></Layout>);
    expect(screen.getByTestId("gate")).toBeInTheDocument();
    expect(screen.getByText("secret")).toBeInTheDocument();
  });
});
