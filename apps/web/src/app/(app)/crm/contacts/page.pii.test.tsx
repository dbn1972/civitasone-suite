import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

vi.mock("../../../_data/loaders", () => ({ getCrmContacts: vi.fn() }));
const tableProps = vi.fn();
vi.mock("./ContactsTable", () => ({ ContactsTable: (p: unknown) => { tableProps(p); return <div />; } }));
vi.mock("./ContactToolbar", () => ({ ContactToolbar: () => <div /> }));
vi.mock("../../../_components/crm/LeadFilters", () => ({ LeadFilters: () => <div /> }));
vi.mock("../../../_components/crm/MergeButton", () => ({ MergeButton: () => <div /> }));
const mockRoles = vi.fn<() => string[]>();
vi.mock("@/lib/auth/roleGuard", async (orig) => {
  const actual = await orig<typeof import("@/lib/auth/roleGuard")>();
  return { ...actual, getSessionRoles: () => mockRoles() };
});

import Page from "./page";
import { getCrmContacts } from "../../../_data/loaders";

const contacts = [{ id: "c1", name: "Asha Rao", phone: "9876543210", email: "asha@example.com" }];

beforeEach(() => {
  tableProps.mockReset();
  vi.mocked(getCrmContacts).mockResolvedValue({ data: contacts as never, source: "api" });
});

describe("Contacts list server-side PII masking (DPDP)", () => {
  it("passes MASKED phone/email into the client table for a plain crm_user", async () => {
    mockRoles.mockReturnValue(["crm_user"]);
    render(await Page({ searchParams: {} }));
    const props = tableProps.mock.calls[0]![0] as { contacts: Array<{ phone: string; email: string }> };
    expect(JSON.stringify(props)).not.toContain("9876543210");
    expect(JSON.stringify(props)).not.toContain("asha@example.com");
    expect(props.contacts[0]!.phone).toBe("98XXXXX210");
  });

  it("passes clear values for a CRM_PII_READ_ROLES role", async () => {
    mockRoles.mockReturnValue(["crm_admin"]);
    render(await Page({ searchParams: {} }));
    const props = tableProps.mock.calls[0]![0] as { contacts: Array<{ phone: string; email: string }> };
    expect(props.contacts[0]!.phone).toBe("9876543210");
    expect(props.contacts[0]!.email).toBe("asha@example.com");
  });
});
