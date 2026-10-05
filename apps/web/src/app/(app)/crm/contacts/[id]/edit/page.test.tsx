import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

vi.mock("../../../../../_data/loaders", () => ({ getContactById: vi.fn() }));
const formProps = vi.fn();
vi.mock("./EditContactForm", () => ({ default: (p: unknown) => { formProps(p); return <div />; } }));
const mockRoles = vi.fn<() => string[]>();
vi.mock("@/lib/auth/roleGuard", async (orig) => {
  const actual = await orig<typeof import("@/lib/auth/roleGuard")>();
  return { ...actual, getSessionRoles: () => mockRoles() };
});

import Page from "./page";
import { getContactById } from "../../../../../_data/loaders";

const contact = { id: "c1", name: "Asha", email: "asha@example.com", phone: "9876543210" } as never;

beforeEach(() => {
  formProps.mockReset();
  vi.mocked(getContactById).mockResolvedValue({ data: contact, source: "api" });
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
