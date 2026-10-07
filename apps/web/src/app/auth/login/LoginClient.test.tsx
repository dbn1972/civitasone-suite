import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { useSearchParams } from "next/navigation";
import LoginClient from "./LoginClient";

vi.mock("next/navigation", () => ({
  useSearchParams: vi.fn(() => new URLSearchParams()),
}));

describe("LoginClient (GAP-AUTH-LOGIN-01/02/03)", () => {
  beforeEach(() => {
    vi.mocked(useSearchParams).mockReturnValue(new URLSearchParams() as ReturnType<typeof useSearchParams>);
  });

  it("LOGIN-03: renders friendly copy for a known OIDC error and shows the raw code only as a reference", () => {
    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams("error=invalid_state") as ReturnType<typeof useSearchParams>,
    );
    render(<LoginClient />);
    expect(screen.getByText(/could not be verified/i)).toBeInTheDocument();
    expect(screen.getByText(/Reference: invalid_state/)).toBeInTheDocument();
  });

  it("LOGIN-03: unknown codes fall back to a generic message", () => {
    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams("error=some_unmapped_code") as ReturnType<typeof useSearchParams>,
    );
    render(<LoginClient />);
    expect(screen.getByText(/didn['’]t complete/i)).toBeInTheDocument();
  });

  it("LOGIN-03: exposes a contact-IT channel (mailto link)", () => {
    render(<LoginClient />);
    const contact = screen.getByRole("link", { name: /contact it/i });
    expect(contact.getAttribute("href")).toMatch(/^mailto:/);
  });

  it("LOGIN-01: reset-password link points to the (now working) /auth/forgot flow", () => {
    render(<LoginClient />);
    const reset = screen.getByRole("link", { name: /reset password/i });
    expect(reset.getAttribute("href")).toBe("/auth/forgot");
  });

  it("LOGIN-02: 'Try again' carries the validated next destination", () => {
    render(<LoginClient next="/dashboard/x" />);
    const retry = screen.getByRole("link", { name: /try again/i });
    expect(retry.getAttribute("href")).toBe("/api/auth/login?next=%2Fdashboard%2Fx");
  });
});
