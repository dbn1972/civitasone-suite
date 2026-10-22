import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

vi.mock("../../../_data/loaders", () => ({ getCrmContacts: vi.fn() }));
vi.mock("./ContactsTable", () => ({ ContactsTable: () => <div /> }));
const toolbarProps = vi.fn();
vi.mock("./ContactToolbar", () => ({ ContactToolbar: (p: unknown) => { toolbarProps(p); return <div />; } }));
vi.mock("../../../_components/crm/LeadFilters", () => ({ LeadFilters: () => <div /> }));
vi.mock("../../../_components/crm/MergeButton", () => ({ MergeButton: () => <div /> }));
const mockRoles = vi.fn<() => string[]>();
vi.mock("@/lib/auth/roleGuard", async (orig) => {
  const actual = await orig<typeof import("@/lib/auth/roleGuard")>();
  return { ...actual, getSessionRoles: () => mockRoles() };
});

import Page from "./page";
import { getCrmContacts } from "../../../_data/loaders";

type ToolbarProps = { canExport: boolean; exportQuery: Record<string, string> };

beforeEach(() => {
  toolbarProps.mockReset();
  vi.mocked(getCrmContacts).mockResolvedValue({ data: [] as never, source: "api" });
});

async function canExportFor(roles: string[]): Promise<boolean> {
  mockRoles.mockReturnValue(roles);
  render(await Page({ searchParams: {} }));
  return (toolbarProps.mock.calls[0]![0] as ToolbarProps).canExport;
}

// GAP-CRM-CONTACTS-01: crm-service's GET /v1/crm/contacts/export admits only
// crm_user / crm_admin / super_admin by exact role string, and the registry-egress
// policy keeps the whole-registry download away from a plain crm_user. The button
// must therefore be offered to exactly crm_admin and super_admin: any other
// admin-class string (admin, platform_admin, tenant_admin) would be shown a
// button that always 403s.
describe("Contacts list export affordance matches the export endpoint's roles", () => {
  it.each(["crm_admin", "super_admin"])("offers the export to %s", async (role) => {
    expect(await canExportFor([role])).toBe(true);
  });

  it.each(["crm_user", "tenant_admin", "admin", "platform_admin"])(
    "does not offer the export to %s (policy-narrow or the endpoint would 403)",
    async (role) => {
      expect(await canExportFor([role])).toBe(false);
    },
  );

  it("forwards the Mine / Recent view (segment) with the other active filters to the export", async () => {
    mockRoles.mockReturnValue(["crm_admin"]);
    render(await Page({ searchParams: { segment: "mine", search: "rao", temperature: "hot" } }));
    const props = toolbarProps.mock.calls[0]![0] as ToolbarProps;
    expect(props.exportQuery).toEqual({ segment: "mine", search: "rao", temperature: "hot" });
  });
});
