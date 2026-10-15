import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import type { MLDomainEvaluation } from "../_data";

const state = vi.hoisted(() => ({ roles: [] as string[] }));
vi.mock("@/lib/auth/roleGuard", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth/roleGuard")>()),
  getSessionRoles: () => state.roles,
}));

const evaluation: MLDomainEvaluation = {
  totalPredictions: 5,
  accuracy: 0.8,
  fallbackRate: 0.1,
  topFactor: "tenure",
  accuracyTrend: [],
  factorBreakdown: [],
  recentPredictions: [
    { id: "p1", entityId: "c0ffee00-0000-4000-8000-000000000001", entityLabel: "Asha Rao", parentId: null, prediction: 0.7, confidence: 0.9, outcome: null, createdAt: "2026-03-01T00:00:00Z" },
  ],
};
vi.mock("../_data", () => ({ getMLDomainEvaluation: async () => ({ data: evaluation, source: "api" }) }));

const Page = (await import("./page")).default;

async function show() {
  const ui = await Page();
  return render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
}

// GAP-ANALYTICS-ML-INSIGHTS-LEADS-05 (DPDP): the scored person is one click from
// a CRM contact record; offer that path only to viewers holding a CRM read role.
describe("ML leads drill-through is CRM-role gated", () => {
  beforeEach(() => { state.roles = []; });

  it("an analytics/ML admin WITHOUT a CRM role sees the score but no link to the contact", async () => {
    state.roles = ["ml_admin"];
    await show();
    expect(screen.getByText("Asha Rao").closest("a")).toBeNull();
  });

  it("a viewer with a CRM read role gets the contact link", async () => {
    state.roles = ["ml_admin", "crm_user"];
    await show();
    const link = screen.getByText("Asha Rao").closest("a") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/crm/contacts/c0ffee00-0000-4000-8000-000000000001");
  });
});
