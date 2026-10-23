import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../../../_data/loaders", () => ({ getCrmContacts: vi.fn() }));
vi.mock("./ContactsTable", () => ({ ContactsTable: () => <div /> }));
vi.mock("./ContactToolbar", () => ({ ContactToolbar: () => <div /> }));
vi.mock("../../../_components/crm/LeadFilters", () => ({ LeadFilters: () => <div /> }));
vi.mock("../../../_components/crm/MergeButton", () => ({ MergeButton: () => <div data-testid="merge" /> }));
const mockRoles = vi.fn<() => string[]>();
vi.mock("@/lib/auth/roleGuard", async (orig) => {
  const actual = await orig<typeof import("@/lib/auth/roleGuard")>();
  return { ...actual, getSessionRoles: () => mockRoles() };
});

import Page from "./page";
import { getCrmContacts } from "../../../_data/loaders";

const twoContacts = [
  { id: "1", name: "A", account: "x", email: "a@x.gov.in", phone: "", temperature: "hot", priority: "high" },
  { id: "2", name: "B", account: "y", email: "", phone: "", temperature: "cold", priority: "low" },
];

beforeEach(() => {
  mockRoles.mockReset();
  vi.mocked(getCrmContacts).mockResolvedValue({ data: twoContacts as never, source: "api" });
});

// POST /v1/crm/contacts/merge is crm_admin / super_admin only (the contacts service ADMIN_ROLES; the web
// CRM_MERGE_ROLES is pinned to it in lib/auth/crmRoles.test.ts) and the merge is irreversible. The control used to be
// rendered to every CRM role, so a crm_user was walked through the danger confirmation and then refused with a 403.
describe("Contacts list page: Merge duplicate contacts is role-gated like the endpoint", () => {
  it.each([["crm_admin"], ["super_admin"]])("offers the merge control to %s", async (role) => {
    mockRoles.mockReturnValue([role]);
    render(await Page({ searchParams: Promise.resolve({}) }));
    expect(screen.getByTestId("merge")).toBeInTheDocument();
  });

  it.each([["crm_user"], ["tenant_admin"], ["platform_admin"], ["admin"], []])(
    "does not offer the merge control to a session with roles %j (the endpoint would 403)",
    async (...roles) => {
      mockRoles.mockReturnValue(roles.flat() as string[]);
      render(await Page({ searchParams: Promise.resolve({}) }));
      expect(screen.queryByTestId("merge")).not.toBeInTheDocument();
    },
  );

  it("still needs two contacts to merge, even for an admin", async () => {
    mockRoles.mockReturnValue(["crm_admin"]);
    vi.mocked(getCrmContacts).mockResolvedValue({ data: [twoContacts[0]] as never, source: "api" });
    render(await Page({ searchParams: Promise.resolve({}) }));
    expect(screen.queryByTestId("merge")).not.toBeInTheDocument();
  });
});
