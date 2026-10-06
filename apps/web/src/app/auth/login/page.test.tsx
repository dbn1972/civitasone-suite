import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { redirect } from "next/navigation";
import LoginPage from "./page";

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
  useSearchParams: vi.fn(() => new URLSearchParams()),
}));

describe("LoginPage (GAP-AUTH-LOGIN-02/04)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("LOGIN-02: redirects to Keycloak carrying a validated next", () => {
    LoginPage({ searchParams: { next: "/dashboard/x" } });
    expect(redirect).toHaveBeenCalledWith("/api/auth/login?next=%2Fdashboard%2Fx");
  });

  it("LOGIN-02: ignores an open-redirect next", () => {
    LoginPage({ searchParams: { next: "//evil.com" } });
    expect(redirect).toHaveBeenCalledWith("/api/auth/login");
  });

  it("renders the error client (not a redirect) when error is present", () => {
    const ui = LoginPage({ searchParams: { error: "invalid_state" } });
    render(ui as React.ReactElement);
    expect(redirect).not.toHaveBeenCalled();
    expect(screen.getByText(/sign-in unsuccessful/i)).toBeInTheDocument();
  });
});
