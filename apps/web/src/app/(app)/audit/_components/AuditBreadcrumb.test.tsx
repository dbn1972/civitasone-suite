import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AuditBreadcrumb } from "./AuditBreadcrumb";
import { AUDIT_HOME } from "./auditNav";

describe("AuditBreadcrumb (GAP-AUDIT-DASHBOARD-03)", () => {
  it("the 'Audit' crumb goes to the same route as the sidebar (AUDIT_HOME)", () => {
    render(<AuditBreadcrumb current="Risk Register" />);
    expect(screen.getByRole("link", { name: "Audit" })).toHaveAttribute("href", AUDIT_HOME);
    expect(AUDIT_HOME).toBe("/audit");
  });

  it("an optional parent crumb sits between Audit and the current page", () => {
    render(<AuditBreadcrumb current="OBS-7" parent={{ label: "Observations", href: "/audit/observations" }} />);
    expect(screen.getByRole("link", { name: "Observations" })).toHaveAttribute("href", "/audit/observations");
    expect(screen.getByText("OBS-7")).toHaveAttribute("aria-current", "page");
  });

  it("on the module home the current page is plain text (no link back to itself)", () => {
    render(<AuditBreadcrumb current="Event Log" isHome />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
