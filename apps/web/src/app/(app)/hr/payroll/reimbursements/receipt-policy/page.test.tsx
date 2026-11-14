import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({ fetchJson: (...a: unknown[]) => fetchJsonMock(...a) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
let roles: string[] = ["payroll_admin"];
vi.mock("@/lib/auth/roleGuard", () => ({ getSessionRoles: () => roles }));

import ReceiptPolicyPage from "./page";

async function renderPage() {
  const ui = await ReceiptPolicyPage();
  render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
}

describe("ReceiptPolicyPage", () => {
  beforeEach(() => { fetchJsonMock.mockReset(); roles = ["payroll_admin"]; });

  it.each([["payroll_officer"], ["hr_admin"], ["employee"]])("%s is shown a permission explanation, not the form, and nothing is fetched", async (role) => {
    roles = [role];
    await renderPage();
    expect(screen.queryByRole("button", { name: "Save receipt rules" })).not.toBeInTheDocument();
    expect(fetchJsonMock).not.toHaveBeenCalled();
  });

  it.each([["payroll_admin"], ["super_admin"]])("%s sees the form with the saved rule", async (role) => {
    roles = [role];
    fetchJsonMock.mockResolvedValue({
      source: "api",
      data: { isDefault: false, policy: { categories: { food: { mode: "always", thresholdMinor: null, selfDeclarationUpToMinor: null } } } },
    });
    await renderPage();
    expect((screen.getByLabelText("Receipt rule for Food") as HTMLSelectElement).value).toBe("always");
    expect(screen.getByRole("button", { name: "Save receipt rules" })).toBeInTheDocument();
  });
});
