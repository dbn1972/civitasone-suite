import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => ["hr_admin"],
}));
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import LeavePoliciesPage from "./page";

function renderPage() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <LeavePoliciesPage />
    </NextIntlClientProvider>,
  );
}

const POLICY = {
  id: "p1",
  leaveTypeCode: "EL",
  leaveTypeName: "Earned Leave",
  employeeType: "permanent",
  maxDaysPerYear: 30,
  carryForward: true,
  maxAccumulation: 60,
  encashable: true,
  countMethod: "calendar",
  maxContinuousDays: 365,
  minServiceMonths: 0,
  genderRestriction: null,
  requiresMedicalCert: false,
  requiresMedicalCertAfterDays: 3,
  prefixSuffixRule: false,
  sandwichRule: false,
  proRataOnJoining: true,
  isActive: true,
};

/**
 * UX-016: both the initial list load and a row save used to throw the raw
 * backend response text (falling back to `Failed to load policies
 * (${res.status})` / `Update failed (${res.status})`) verbatim — the same
 * class of leak useFormError closes fleet-wide (UX-003).
 */
describe("LeavePoliciesPage — UX-016 clerk-safe errors", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("shows a clerk-safe message, never the raw HTTP status, when the initial list load fails", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 500 }));
    renderPage();

    // Scoped to the toHumanError "area" text (not just /couldn't load/i) since
    // the page's own DataSourceBadge also shows a generic "Couldn't load —
    // showing nothing" pill on this same error state.
    await waitFor(() => expect(screen.getByText(/couldn't load this leave policy/i)).toBeInTheDocument());
    expect(screen.queryByText(/\b500\b/)).not.toBeInTheDocument();
  });

  it("shows a clerk-safe message, never the raw server text, when saving an edit fails", async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (!init || init.method === undefined) {
        return Promise.resolve(new Response(JSON.stringify({ data: [POLICY] }), { status: 200 }));
      }
      return Promise.resolve(new Response("policy-service: PATCH trace at line 40", { status: 500 }));
    });
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /^edit$/i }));
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(dialog).toHaveTextContent(/couldn't save/i));
    expect(dialog.textContent).not.toMatch(/policy-service/);
    expect(dialog.textContent).not.toMatch(/\b500\b/);
  });
});
