import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const mockGet = vi.fn();
vi.mock("next/headers", () => ({ cookies: () => ({ get: mockGet }) }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  return `${header}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.sig`;
}
const as = (roles: string[]) => mockGet.mockReturnValue({ value: makeJwt({ sub: "u1", roles }) });

import SchemesLayout from "./schemes/layout";
import ApplicationsLayout from "./applications/layout";
import ListLayout from "./list/layout";
import InstallmentsLayout from "./installments/layout";
import ReleasesLayout from "./releases/layout";
import UtilizationLayout from "./utilization/layout";
import GranteesLayout from "./grantees/layout";
import DashboardLayout from "./dashboard/layout";

/**
 * Each grants route admits exactly the roles grant-service admits on its primary read
 * endpoint (scheme/application/disbursement/utilisation/beneficiary READER_ROLES,
 * dashboard ROLES), so no role is offered a page that opens onto a 403.
 */
const cases: Array<[string, (p: { children: React.ReactNode }) => React.ReactNode, string[], string[]]> = [
  ["schemes", SchemesLayout, ["grant_officer", "grant_admin", "super_admin", "audit_officer", "finance_officer", "grant_viewer"], ["grant_reviewer", "finance_admin"]],
  ["applications", ApplicationsLayout, ["grant_reviewer", "grant_officer", "grant_admin", "super_admin", "audit_officer"], ["grant_viewer", "finance_officer", "finance_admin"]],
  ["list", ListLayout, ["grant_reviewer", "grant_officer", "grant_admin", "super_admin", "audit_officer"], ["grant_viewer", "finance_officer", "finance_admin"]],
  ["installments", InstallmentsLayout, ["grant_officer", "grant_admin", "super_admin", "finance_officer", "audit_officer"], ["grant_viewer", "grant_reviewer", "finance_admin"]],
  ["releases", ReleasesLayout, ["grant_officer", "grant_admin", "super_admin", "finance_officer", "audit_officer"], ["grant_viewer", "grant_reviewer", "finance_admin"]],
  ["utilization", UtilizationLayout, ["grant_officer", "grant_admin", "super_admin", "finance_officer", "audit_officer"], ["grant_viewer", "grant_reviewer", "finance_admin"]],
  ["grantees", GranteesLayout, ["grant_officer", "grant_admin", "super_admin", "audit_officer"], ["grant_viewer", "grant_reviewer", "finance_officer", "finance_admin"]],
  ["dashboard", DashboardLayout, ["grant_officer", "grant_admin", "super_admin"], ["grant_viewer", "grant_reviewer", "finance_officer", "finance_admin", "audit_officer"]],
];

describe.each(cases)("grants /%s route gate mirrors the service reader set", (_name, Layout, allowed, denied) => {
  beforeEach(() => mockGet.mockReset());

  it.each(allowed)("admits %s", (role) => {
    as([role]);
    render(<>{Layout({ children: "page body" })}</>);
    expect(screen.getByText("page body")).toBeInTheDocument();
  });

  it.each(denied)("shows Access restricted (link back to /grants) for %s", (role) => {
    as([role]);
    render(<>{Layout({ children: "page body" })}</>);
    expect(screen.queryByText("page body")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /back to grants/i })).toHaveAttribute("href", "/grants");
  });
});
