import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen } from "@testing-library/react";
import { NextIntlClientProvider as __Intl } from "next-intl";
import __enMessages from "@/messages/en.json";
function render(ui: React.ReactElement) {
  return rtlRender(<__Intl locale="en" messages={__enMessages}>{ui}</__Intl>);
}
import type { CRMLeadCaptureForm } from "@civitasone/types";

const getFormsMock = vi.fn();
vi.mock("@/app/_data/loaders", () => ({
  getCrmLeadCaptureForms: (...args: unknown[]) => getFormsMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import LeadFormsPage from "./page";

function form(partial: Partial<CRMLeadCaptureForm> = {}): CRMLeadCaptureForm {
  return {
    id: "f1", tenantId: "t1", formKey: "a".repeat(64), name: "Homepage contact",
    enabled: true, requireConsent: true, allowedOrigins: ["https://example.gov.in"],
    defaultLeadSource: "public_form", campaignId: null, maxPerMinute: 60, version: 1,
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", ...partial,
  };
}

beforeEach(() => getFormsMock.mockReset());

describe("LeadFormsPage", () => {
  // GAP-CRM-LEAD-FORMS-04: an outage shows a retry state, not the empty-registry copy.
  it("shows a retry error state (not 'No website forms registered') on a load error", async () => {
    getFormsMock.mockResolvedValue({ data: [], source: "error" });
    render(await LeadFormsPage());
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
    expect(screen.queryByText(/No website forms registered/i)).not.toBeInTheDocument();
  });

  // GAP-CRM-LEAD-FORMS-04: an empty-but-successful load still shows the empty state.
  it("shows the empty state on an ok-but-empty registry", async () => {
    getFormsMock.mockResolvedValue({ data: [], source: "api" });
    render(await LeadFormsPage());
    expect(screen.getByText(/No website forms registered/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /try again/i })).not.toBeInTheDocument();
  });

  // GAP-CRM-LEAD-FORMS-03: the consent-gap DPDP note shows when a form is unlawful.
  it("shows the consent-gap DPDP note when a form skips consent", async () => {
    getFormsMock.mockResolvedValue({ data: [form({ enabled: true, requireConsent: false })], source: "api" });
    render(await LeadFormsPage());
    expect(screen.getByText(/DPDP Act 2023 requires consent/i)).toBeInTheDocument();
  });

  it("does not show the consent-gap note when every form is lawful", async () => {
    getFormsMock.mockResolvedValue({ data: [form({ requireConsent: true })], source: "api" });
    render(await LeadFormsPage());
    expect(screen.queryByText(/DPDP Act 2023 requires consent/i)).not.toBeInTheDocument();
  });
});
