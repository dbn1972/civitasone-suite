import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../../../../../_data/loaders", () => ({ getContactById: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
// The form itself is exercised in EditContactForm.test.tsx; stub it here and
// capture the props so the DPDP prefill behaviour can be asserted.
const formProps = vi.fn();
vi.mock("./EditContactForm", () => ({ default: (p: unknown) => { formProps(p); return <div data-testid="edit-form" />; } }));
const mockRoles = vi.fn<() => string[]>();
vi.mock("@/lib/auth/roleGuard", async (orig) => {
  const actual = await orig<typeof import("@/lib/auth/roleGuard")>();
  return { ...actual, getSessionRoles: () => mockRoles() };
});

import Page from "./page";
import { getContactById } from "../../../../../_data/loaders";

const contact = { id: "c1", name: "Asha", email: "asha@example.com", phone: "9876543210" } as never;
const mContact = vi.mocked(getContactById);

beforeEach(() => {
  formProps.mockReset();
  mContact.mockReset();
  mockRoles.mockReturnValue(["crm_user"]);
  mContact.mockResolvedValue({ data: contact, source: "api" } as never);
});

describe("Edit contact PII prefill (DPDP)", () => {
  it("does NOT prefill clear email/phone for a plain crm_user; passes masked placeholders", async () => {
    mockRoles.mockReturnValue(["crm_user"]);
    render(await Page({ params: { id: "c1" } }));
    const p = formProps.mock.calls[0]![0] as { initial: Record<string, unknown>; maskedPii?: { email?: string; phone?: string; hint: string } };
    expect(p.initial.email).toBeUndefined();
    expect(p.initial.phone).toBeUndefined();
    expect(JSON.stringify(p)).not.toContain("asha@example.com");
    expect(JSON.stringify(p)).not.toContain("9876543210");
    expect(p.maskedPii?.phone).toBe("98XXXXX210");
    expect(p.maskedPii?.hint.length).toBeGreaterThan(0);
  });

  it("prefills clear values for a CRM_PII_READ_ROLES role", async () => {
    mockRoles.mockReturnValue(["crm_admin"]);
    render(await Page({ params: { id: "c1" } }));
    const p = formProps.mock.calls[0]![0] as { initial: Record<string, unknown>; maskedPii?: unknown };
    expect(p.initial.email).toBe("asha@example.com");
    expect(p.maskedPii).toBeUndefined();
  });
});

describe("Edit contact page failure vs not-found (GAP-CRM-CONTACTS-DETAIL-EDIT-04)", () => {
  it("a 500 shows an error/retry state, not 'Contact not found'", async () => {
    mContact.mockResolvedValue({ data: null, source: "error", status: 500 } as never);
    render(await Page({ params: { id: "c-1" } }));
    expect(screen.queryByText("Contact not found")).not.toBeInTheDocument();
  });

  it("a 404 shows 'Contact not found'", async () => {
    mContact.mockResolvedValue({ data: null, source: "error", status: 404 } as never);
    render(await Page({ params: { id: "c-1" } }));
    expect(screen.getByText("Contact not found")).toBeInTheDocument();
  });

  it("renders the edit form when the contact loads", async () => {
    mContact.mockResolvedValue({ data: { name: "Asha" }, source: "api", status: 200 } as never);
    render(await Page({ params: { id: "c-1" } }));
    expect(screen.getByTestId("edit-form")).toBeInTheDocument();
  });
});
