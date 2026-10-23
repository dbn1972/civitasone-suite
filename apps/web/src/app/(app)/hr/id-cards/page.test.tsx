import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

const getSessionRolesMock = vi.fn(() => ["hr_admin"] as string[]);
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => getSessionRolesMock(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

import IdCardsPage from "./page";

async function renderPage() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {await IdCardsPage({ searchParams: Promise.resolve({}) })}
    </NextIntlClientProvider>,
  );
}

const EMPTY = { data: { items: [], total: 0, meta: {} }, source: "api" };

// GAP-HR-ID-CARDS-06: the register is deliberately hr_admin / security_admin / super_admin only
// (the API's six requireRole calls use the same list); an excluded role must be told WHY.
describe("IdCardsPage role gate (GAP-HR-ID-CARDS-06)", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset().mockResolvedValue(EMPTY);
    getSessionRolesMock.mockReset().mockReturnValue(["hr_admin"]);
  });

  it("an hr_officer sees Access restricted WITH the reason, and no request is made", async () => {
    getSessionRolesMock.mockReturnValue(["hr_officer"]);
    await renderPage();
    expect(screen.getByRole("heading", { name: "Access restricted" })).toBeInTheDocument();
    expect(
      screen.getByText("ID cards include physical access-zone data, so this register is limited to HR administrators and security administrators."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to HR" })).toHaveAttribute("href", "/hr");
    expect(fetchJsonMock).not.toHaveBeenCalled();
  });

  it("the explanation never leaks role slugs", async () => {
    getSessionRolesMock.mockReturnValue(["hr_officer"]);
    const { container } = await renderPage();
    expect(container.textContent).not.toMatch(/hr_admin|security_admin|super_admin|hr_officer/);
  });

  it.each(["employee", "manager", "payroll_admin"])("a %s is refused the same way", async (role) => {
    getSessionRolesMock.mockReturnValue([role]);
    await renderPage();
    expect(screen.getByRole("heading", { name: "Access restricted" })).toBeInTheDocument();
    expect(fetchJsonMock).not.toHaveBeenCalled();
  });

  it.each(["hr_admin", "security_admin", "super_admin"])("a %s gets the register and the API is called", async (role) => {
    getSessionRolesMock.mockReturnValue([role]);
    await renderPage();
    expect(screen.queryByRole("heading", { name: "Access restricted" })).not.toBeInTheDocument();
    expect(fetchJsonMock).toHaveBeenCalled();
  });

  it("the explanation exists in Hindi too", () => {
    expect(hiMessages.idCards.accessRestrictedReason.length).toBeGreaterThan(10);
    expect(Object.keys(hiMessages.idCards)).toEqual(expect.arrayContaining(Object.keys(enMessages.idCards)));
  });
});
