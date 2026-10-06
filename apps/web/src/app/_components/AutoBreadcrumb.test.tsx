import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { AutoBreadcrumb } from "./AutoBreadcrumb";

let mockPathname = "/";
vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
}));
// next/link -> plain anchor so we can assert on the rendered <a href>.
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

beforeEach(() => {
  mockPathname = "/";
});

describe("AutoBreadcrumb", () => {
  it("shows the brand at the app root", () => {
    mockPathname = "/";
    render(<AutoBreadcrumb />);
    expect(screen.getByText("CivitasOne")).toBeInTheDocument();
  });

  it("shows a single bold crumb (no links) for a top-level module", () => {
    mockPathname = "/finance";
    const { container } = render(<AutoBreadcrumb />);
    expect(screen.getByText("Finance")).toBeInTheDocument();
    expect(container.querySelector("a")).toBeNull();
  });

  it("links real intermediate crumbs and marks the last as current", () => {
    mockPathname = "/hr/payroll/register";
    render(<AutoBreadcrumb />);
    // /hr and /hr/payroll both have index pages -> real links
    const hr = screen.getByText("HR & Payroll").closest("a");
    const payroll = screen.getByText("Payroll").closest("a");
    expect(hr).toHaveAttribute("href", "/hr");
    expect(payroll).toHaveAttribute("href", "/hr/payroll");
    // last crumb is the current page: bold, aria-current, NOT a link
    const last = screen.getByText("Register");
    expect(last.closest("a")).toBeNull();
    expect(last).toHaveAttribute("aria-current", "page");
  });

  // Fails-before / passes-after. Before the fix, EVERY non-last crumb was a
  // <Link>, so "/finance/budget" (a grouping with children but no index page)
  // was a clickable link that 404'd. It must now render as plain context text.
  it("does NOT link an intermediate crumb whose path has no index route", () => {
    mockPathname = "/finance/budget/prepare";
    render(<AutoBreadcrumb />);

    // /finance is real -> still a link
    expect(screen.getByText("Finance").closest("a")).toHaveAttribute("href", "/finance");

    // /finance/budget has NO index route -> must be text, never an anchor
    const budget = screen.getByText("Budget");
    expect(budget.closest("a")).toBeNull();
    expect(budget.tagName).toBe("SPAN");
  });

  it("skips numeric / UUID id segments", () => {
    mockPathname = "/finance/bills/9f8c7b6a-1234-5678-9abc-def012345678";
    render(<AutoBreadcrumb />);
    // the id is not shown as its own crumb
    expect(screen.queryByText(/def012345678/)).toBeNull();
  });

  // GAP-INSTALL-STEPS-05: /install/<child> now has controlled SEGMENT_LABELS
  // and /install is a linkable intermediate crumb, so the trail reads
  // Install / Modules with Install linking to its own index page. Fails on the
  // old code (where "install" had no label entry — it still title-cased to
  // "Install", but this pins the label + the resolving link so a future
  // rename can't silently break it).
  it("renders a linked Install crumb and a current Modules crumb for /install/modules", () => {
    mockPathname = "/install/modules";
    render(<AutoBreadcrumb />);
    const install = screen.getByText("Install").closest("a");
    expect(install).toHaveAttribute("href", "/install");
    const modules = screen.getByText("Modules");
    expect(modules.closest("a")).toBeNull();
    expect(modules).toHaveAttribute("aria-current", "page");
  });
});
