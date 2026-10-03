import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { PermissionDenied } from "./PermissionDenied";

const STD = "You don't have permission to do this. Ask your administrator if you need access.";

describe("PermissionDenied", () => {
  afterEach(() => {
    document.cookie = "locale=; expires=Thu, 01 Jan 1970 00:00:00 GMT";
    vi.restoreAllMocks();
  });

  it("renders access restricted heading", () => {
    render(<PermissionDenied />);
    expect(screen.getByRole("heading", { name: "Access restricted" })).toBeInTheDocument();
  });

  it("shows the standard 403 copy, whether or not a module is given", () => {
    const { rerender } = render(<PermissionDenied />);
    expect(screen.getByText(STD)).toBeInTheDocument();
    rerender(<PermissionDenied module="Finance" />);
    expect(screen.getByText(STD)).toBeInTheDocument();
  });

  it("never shows internal role slugs, even when requiredRoles is passed", () => {
    render(<PermissionDenied requiredRoles={["finance_admin", "ddo"]} />);
    expect(screen.queryByText(/finance_admin/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Required:/)).not.toBeInTheDocument();
  });

  it("never renders the backend's own reason; it logs it in development only", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    render(<PermissionDenied reason="requires one of: hr_admin, hr_officer, super_admin" />);
    expect(screen.queryByText(/hr_admin/)).not.toBeInTheDocument();
    expect(screen.getByText(STD)).toBeInTheDocument();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("PermissionDenied"), "requires one of: hr_admin, hr_officer, super_admin");
  });

  it.each(["SELF_APPROVAL", "SELF_APPROVAL_FORBIDDEN"])("a %s code gets the specific self-approval copy", (code) => {
    render(<PermissionDenied code={code} reason="Cannot approve your own expense claim" />);
    expect(screen.getByText("You can't approve your own request. Another approver needs to do this.")).toBeInTheDocument();
    expect(screen.queryByText(/expense claim/)).not.toBeInTheDocument();
  });

  it.each(["MAKER_CHECKER", "MAKER_CHECKER_VIOLATION"])("a %s code says a different person must approve", (code) => {
    render(<PermissionDenied code={code} />);
    expect(
      screen.getByText("This needs approval from someone other than the person who made it. Another approver needs to do this."),
    ).toBeInTheDocument();
  });

  it("is localised in Hindi (heading and body) once the locale cookie says hi", async () => {
    document.cookie = "locale=hi";
    render(<PermissionDenied />);
    expect(await screen.findByRole("heading", { name: "पहुँच प्रतिबंधित" })).toBeInTheDocument();
    expect(screen.getByText("आपको यह कार्य करने की अनुमति नहीं है। पहुँच चाहिए तो अपने व्यवस्थापक से कहें।")).toBeInTheDocument();
  });

  it("renders return link to dashboard", () => {
    render(<PermissionDenied />);
    expect(screen.getByRole("link", { name: "Return to command center" })).toHaveAttribute("href", "/dashboard");
  });

  it("shows lock icon with aria-hidden", () => {
    const { container } = render(<PermissionDenied />);
    expect(container.querySelector("[aria-hidden]")?.textContent).toBe("🔒");
  });

  // GAP-HR-ID-CARDS-07
  it("uses a custom backHref/backLabel when provided", () => {
    render(<PermissionDenied backHref="/hr" backLabel="Back to HR" />);
    expect(screen.getByRole("link", { name: "Back to HR" })).toHaveAttribute("href", "/hr");
  });

  it("still defaults to /dashboard when backHref is not provided", () => {
    render(<PermissionDenied module="ID cards" />);
    expect(screen.getByRole("link", { name: "Return to command center" })).toHaveAttribute("href", "/dashboard");
  });
});
