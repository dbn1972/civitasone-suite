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

  // GAP-CRM-CONTACTS-02: a privileged role is masked by default too. The clear
  // value reaches the browser only through the audited per-value reveal, never
  // in the list payload.
  it("masks phone/email for a CRM_PII_READ_ROLES role too, and enables the audited reveal", async () => {
    mockRoles.mockReturnValue(["crm_admin"]);
    render(await Page({ searchParams: {} }));
    const props = tableProps.mock.calls[0]![0] as { contacts: Array<{ phone: string; email: string }>; canReveal: boolean };
    expect(JSON.stringify(props)).not.toContain("9876543210");
    expect(JSON.stringify(props)).not.toContain("asha@example.com");
    expect(props.contacts[0]!.phone).toBe("98XXXXX210");
    expect(props.canReveal).toBe(true);
  });

  it("gives a plain crm_user no reveal control", async () => {
    mockRoles.mockReturnValue(["crm_user"]);
    render(await Page({ searchParams: {} }));
    const props = tableProps.mock.calls[0]![0] as { canReveal: boolean };
    expect(props.canReveal).toBe(false);
  });

  it("does not double-mask a value crm-service already redacted for the caller", async () => {
    vi.mocked(getCrmContacts).mockResolvedValue({
      data: [{ id: "c2", name: "Ravi", phone: "******3210", email: "r***@example.com" }] as never,
      source: "api",
    });
    mockRoles.mockReturnValue(["crm_user"]);
    render(await Page({ searchParams: {} }));
    const props = tableProps.mock.calls[0]![0] as { contacts: Array<{ phone: string; email: string }> };
    expect(props.contacts[0]!.phone).toBe("******3210");
    expect(props.contacts[0]!.email).toBe("r***@example.com");
  });

  it("states the truth in the banner: masked, and reveal is recorded - never the old 'logged' claim for clear lists", async () => {
    mockRoles.mockReturnValue(["crm_admin"]);
    const { container } = render(await Page({ searchParams: {} }));
    const note = container.querySelector('[role="note"]')!;
    expect(note.textContent).toMatch(/masked/i);
    expect(note.textContent).toMatch(/recorded in the audit trail/i);
    expect(note.textContent).not.toMatch(/Access is role-scoped and logged/);

    mockRoles.mockReturnValue(["crm_user"]);
    const second = render(await Page({ searchParams: {} }));
    const note2 = second.container.querySelector('[role="note"]')!;
    expect(note2.textContent).toMatch(/masked for your role/i);
  });
});
