import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";
import { ServicePageClient } from "./ServicePageClient";
import type { PublishedServiceRuntime } from "../_data/runtimeApi";

// GAP-CITIZEN-SERVICES-SERVICEKEY-04 (i18n) and -05 (UX): the service landing
// page must localise SLA days, the fee line and the resume-draft banner, drop
// the misleading ☐ checkbox glyph on required-document rows, and expose only a
// single resume target (the primary CTA, not a second banner link).

const BASE: PublishedServiceRuntime = {
  id: "svc-1",
  serviceKey: "trade-license",
  name: "Trade License",
  servicePattern: "certificate",
  description: "Apply for a trade license",
  slaDays: 1,
  channels: ["portal"],
  allowedApplicantTypes: ["citizen"],
  applicantTypeRejectMessage: null,
  requiredDocuments: [{ docType: "pan", label: "PAN card", mandatory: true }],
  feeFromMinor: 150000,
  feeCurrency: "INR",
  formDesign: null,
};

function renderClient(service: PublishedServiceRuntime, locale: "en" | "hi" = "en") {
  const messages = locale === "hi" ? hiMessages : enMessages;
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <ServicePageClient service={service} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  // listDraftsForService() calls fetch(); default: no drafts.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({ data: [] }) })) as unknown as typeof fetch,
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ServicePageClient i18n + UX", () => {
  it("localises the SLA working-day count (singular) via ICU plural", () => {
    renderClient(BASE);
    expect(screen.getByText("1 working day")).toBeInTheDocument();
  });

  it("pluralises the SLA count for >1 day", () => {
    renderClient({ ...BASE, slaDays: 12 });
    expect(screen.getByText("12 working days")).toBeInTheDocument();
  });

  it("renders the fee via shared formatter with localised 'from' wording", () => {
    renderClient(BASE);
    expect(screen.getByText("from ₹1,500")).toBeInTheDocument();
  });

  it("renders localised 'Fee on approval' when no fee", () => {
    renderClient({ ...BASE, feeFromMinor: null });
    expect(screen.getByText("Fee on approval")).toBeInTheDocument();
  });

  it("does NOT render the misleading ☐ checkbox glyph", () => {
    const { container } = renderClient(BASE);
    expect(container.textContent).not.toContain("☐");
  });

  it("renders the fee line in Hindi locale", () => {
    renderClient(BASE, "hi");
    // feeFrom: "{amount} से"
    expect(screen.getByText("₹1,500 से")).toBeInTheDocument();
  });

  it("shows a single resume target (the CTA) and no second banner link when a draft exists", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ data: [{ id: "d1", serviceId: "svc-1", status: "draft" }] }),
      })) as unknown as typeof fetch,
    );
    renderClient(BASE);
    await waitFor(() => {
      // CTA switches to "Resume application"
      expect(screen.getByText("Resume application")).toBeInTheDocument();
    });
    // The old banner used "Resume draft" as a second link — it must be gone.
    expect(screen.queryByText("Resume draft")).not.toBeInTheDocument();
    // Only one link points at the apply route.
    const applyLinks = screen
      .getAllByRole("link")
      .filter((a) => a.getAttribute("href")?.includes("/apply"));
    expect(applyLinks).toHaveLength(1);
  });
});
