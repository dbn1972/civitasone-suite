import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ForgotForm } from "./ForgotForm";

describe("ForgotForm (GAP-AUTH-FORGOT-01/02/03/04)", () => {
  it("does not claim an email was sent (no false-success panel)", () => {
    const { container } = render(<ForgotForm />);
    expect(container.textContent).not.toMatch(/check your inbox/i);
    expect(container.textContent).not.toMatch(/we['’]ve sent/i);
  });

  it("FORGOT-02: does not invent a '30 minutes' expiry claim", () => {
    const { container } = render(<ForgotForm />);
    expect(container.textContent).not.toMatch(/30 minutes/i);
    expect(container.textContent).not.toMatch(/expires in/i);
  });

  it("FORGOT-03: directs the user to SSO recovery and to contact IT", () => {
    render(<ForgotForm />);
    const recover = screen.getByRole("link", { name: /recover account access/i });
    expect(recover.getAttribute("href")).toBe("/api/auth/forgot");
    expect(screen.getByText(/contact your it administrator/i)).toBeInTheDocument();
  });
});
