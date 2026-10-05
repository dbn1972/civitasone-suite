import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ExceptionTable } from "./ExceptionTable";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

function row(overrides: Partial<{ id: string; label: string; severity: string; count: number; href: string }> = {}) {
  return {
    id: "ex-1",
    label: "Dormant accounts",
    severity: "high",
    count: 5,
    href: "/crm/accounts",
    ...overrides,
  };
}

describe("ExceptionTable drill-down (GAP-CRM-CONTROL-TOWER-06)", () => {
  it("renders an internal href as a real link with an exception-named aria-label", () => {
    render(<ExceptionTable rows={[row({ label: "Dormant accounts", href: "/crm/accounts" })]} />);
    const link = screen.getByRole("link", { name: "Open Dormant accounts" });
    expect(link).toHaveAttribute("href", "/crm/accounts");
  });

  it("does NOT render a javascript: href as a link", () => {
    render(<ExceptionTable rows={[row({ href: "javascript:alert(1)" })]} />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    // the control is still shown, but disabled and non-navigable
    const span = screen.getByText("Open");
    expect(span).toHaveAttribute("aria-disabled", "true");
  });

  it("does NOT render a protocol-relative //host href as a link", () => {
    render(<ExceptionTable rows={[row({ href: "//evil.example.com" })]} />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText("Open")).toHaveAttribute("aria-disabled", "true");
  });

  it("does NOT render an external https href as a link", () => {
    render(<ExceptionTable rows={[row({ href: "https://evil.example.com" })]} />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
