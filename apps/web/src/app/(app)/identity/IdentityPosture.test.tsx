import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const data = vi.hoisted(() => ({ getIdentityPosture: vi.fn() }));
vi.mock("./_data", () => data);
const auth = vi.hoisted(() => ({ getSessionRoles: vi.fn(() => ["tenant_admin"]) }));
vi.mock("@/lib/auth/roleGuard", async (orig) => ({ ...(await orig<typeof import("@/lib/auth/roleGuard")>()), ...auth }));

const { IdentityPosture } = await import("./IdentityPosture");

beforeEach(() => {
  vi.clearAllMocks();
  data.getIdentityPosture.mockResolvedValue({ source: "api", data: { activeUsers: 248, mfaAdoptionRate: 83 } });
});

describe("IdentityPosture (GAP-IDENTITY-HOME-03)", () => {
  it("shows active users and MFA % to a tenant_admin", async () => {
    auth.getSessionRoles.mockReturnValue(["tenant_admin"]);
    render(await IdentityPosture());
    expect(screen.getByText("248")).toBeInTheDocument();
    expect(screen.getByText("83%")).toBeInTheDocument();
  });

  it("renders nothing and never fetches for other roles", async () => {
    auth.getSessionRoles.mockReturnValue(["platform_admin"]);
    expect(await IdentityPosture()).toBeNull();
    expect(data.getIdentityPosture).not.toHaveBeenCalled();
  });

  it("shows a dash, not a fabricated zero, when the fetch fails", async () => {
    auth.getSessionRoles.mockReturnValue(["tenant_admin"]);
    data.getIdentityPosture.mockResolvedValue({ source: "error", data: null });
    render(await IdentityPosture());
    expect(screen.getAllByText("\u2014").length).toBe(2);
  });
});
