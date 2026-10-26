import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { render } from "@/test-utils/intl-render";

let roles: string[] = [];
const { getSessionById } = vi.hoisted(() => ({ getSessionById: vi.fn() }));
vi.mock("next/navigation", () => ({ notFound: vi.fn(), useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/auth/roleGuard", () => ({ getSessionUserId: () => "admin-1", getSessionRoles: () => roles }));
vi.mock("@/app/_data/loaders", () => ({ getSessionById: (id: string) => getSessionById(id) }));

import SessionDetailPage from "./page";

const session = {
  id: "s1", userId: "u-9", userEmail: "asha@gov.in", userName: "Asha Rao", ipAddress: "10.1.*.*",
  userAgent: "Chrome on Windows", mfaVerified: true, status: "active", lastActiveAt: "2026-09-01T09:05:00Z",
};

describe("session detail IP reveal gating (owner decision #21)", () => {
  beforeEach(() => { roles = []; getSessionById.mockResolvedValue({ source: "api", data: session }); });

  it("tenant_admin sees the masked IP and the short device, with no reveal control", async () => {
    roles = ["tenant_admin"];
    render(await SessionDetailPage({ params: Promise.resolve({ id: "s1" }) }));
    expect(screen.getByText("10.1.*.*")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reveal" })).toBeNull();
    expect(screen.getByText("Chrome · Windows")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/AppleWebKit|Mozilla/);
  });

  it("security_admin gets the reveal control", async () => {
    roles = ["security_admin"];
    render(await SessionDetailPage({ params: Promise.resolve({ id: "s1" }) }));
    expect(screen.getByRole("button", { name: "Reveal" })).toBeInTheDocument();
  });
});
