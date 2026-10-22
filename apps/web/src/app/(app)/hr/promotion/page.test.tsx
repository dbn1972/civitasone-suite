import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const render = (ui: ReactElement) =>
  rtlRender(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({ fetchJson: (...a: unknown[]) => fetchJsonMock(...a) }));
let mockRoles: string[] = [];
vi.mock("@/lib/auth/roleGuard", () => ({ getSessionRoles: () => mockRoles }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/app/_components/ds/Toast", () => ({ useToast: () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }) }));

import PromotionPage from "./page";

// The row shape of GET /v1/hrms/promotions (lifecycle/m7-list-routes.ts): names and grades already
// resolved, "—" for anything it could not resolve, newBasicMinor a decimal string.
const ROW = {
  id: "p1", employee: "Asha Rao", department: "Home Department", fromGrade: "Section Officer", toGrade: "Under Secretary",
  effectiveDate: "2026-04-01", orderNo: "PROMO/2026/014", orderRef: "PROMO/2026/014", newBasicMinor: "4550000", currency: "INR", status: "pending_effective",
};

// fetchJson(url, fallback, { mapResponse }) -- apply the page's own mapper to a raw payload.
function respondWith(payload: unknown, extra: Record<string, unknown> = {}) {
  fetchJsonMock.mockImplementation(async (_url: string, fallback: unknown, opts: { mapResponse?: (p: unknown) => unknown }) => {
    const mapped = opts.mapResponse?.(payload);
    return { data: mapped ?? fallback, source: mapped == null ? "error" : "api", ...extra };
  });
}

describe("PromotionPage (GAP-HR-PROMOTION-01)", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    mockRoles = ["hr_admin"];
  });

  it("reads the enriched /hrms/promotions list as its ONE source -- never the raw lifecycle list", async () => {
    respondWith({ data: [ROW], hasMore: false });
    render(await PromotionPage());
    expect(fetchJsonMock).toHaveBeenCalledTimes(1);
    expect(fetchJsonMock.mock.calls[0]![0]).toBe("/api/v1/hrms/promotions");
  });

  it("once a promotion exists, the table shows the employee, department, grades and order no. (no blanks, no UUIDs)", async () => {
    respondWith({ data: [ROW], hasMore: false });
    render(await PromotionPage());
    const table = screen.getByRole("table");
    const cells = within(table).getAllByRole("row")[1]!;
    for (const text of ["Asha Rao", "Home Department", "Section Officer", "Under Secretary", "PROMO/2026/014"]) {
      expect(within(cells).getByText(text), text).toBeInTheDocument();
    }
    expect(document.body.textContent).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
  });

  it("shows '—' (not an id) for an employee or grade the list could not resolve", async () => {
    respondWith({ data: [{ ...ROW, employee: "—", fromGrade: "—", toGrade: "—", orderNo: "—", orderRef: null }], hasMore: false });
    render(await PromotionPage());
    const cells = within(screen.getByRole("table")).getAllByRole("row")[1]!;
    expect(within(cells).getAllByText("—").length).toBeGreaterThanOrEqual(4);
  });

  it("with zero rows the empty state still appears", async () => {
    respondWith({ data: [] });
    render(await PromotionPage());
    expect(screen.getByText("No promotion orders")).toBeInTheDocument();
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  it("surfaces the 500-row cap instead of silently dropping the rest", async () => {
    respondWith({ data: [ROW], hasMore: true });
    render(await PromotionPage());
    expect(screen.getByRole("note")).toHaveTextContent(enMessages.promotion.hasMoreNotice);
  });

  it("does not show the cap notice when everything fit", async () => {
    respondWith({ data: [ROW], hasMore: false });
    render(await PromotionPage());
    expect(screen.queryByText(enMessages.promotion.hasMoreNotice)).not.toBeInTheDocument();
  });

  it("a failed load is an error state, not an empty list", async () => {
    fetchJsonMock.mockResolvedValue({ data: { rows: [], hasMore: false }, source: "error" });
    render(await PromotionPage());
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.queryByText("No promotion orders")).not.toBeInTheDocument();
  });

  it("offers '+ Promotion with approval' only to the HR roles the backend accepts", async () => {
    respondWith({ data: [ROW], hasMore: false });
    render(await PromotionPage());
    expect(screen.getByRole("button", { name: "+ Promotion with approval" })).toBeInTheDocument();
  });

  it("hides the wizard from a manager", async () => {
    mockRoles = ["manager"];
    respondWith({ data: [ROW], hasMore: false });
    render(await PromotionPage());
    expect(screen.queryByRole("button", { name: "+ Promotion with approval" })).not.toBeInTheDocument();
  });

  it("takes the back-link label from the promotion namespace", async () => {
    respondWith({ data: [ROW], hasMore: false });
    render(await PromotionPage());
    expect(screen.getByText(enMessages.promotion.backLabel)).toBeInTheDocument();
  });
});
