import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";
import type { VigilanceCaseSummary } from "@/app/_data/loaders";

const seeded = vi.fn();
vi.mock("@/lib/sync/resource", () => ({
  useSeededResource: (...args: unknown[]) => seeded(...args),
}));

import { VigilanceTable } from "./VigilanceTable";

const OK: VigilanceCaseSummary = { id: "v1", caseNo: "VC-1", officer: "R ••••", charges: "••••", inquiryStatus: "under_investigation", outcome: "pending" };
const UNKNOWN: VigilanceCaseSummary = {
  id: "v2", caseNo: "VC-2", officer: "S ••••", charges: "••••",
  inquiryStatus: "unknown", outcome: "unknown", rawInquiryStatus: "appeal_pending",
};

function renderTable(rows: VigilanceCaseSummary[], locale: "en" | "hi" = "en") {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === "en" ? enMessages : hiMessages}>
      <VigilanceTable rows={rows} source="api" />
    </NextIntlClientProvider>,
  );
}

describe("VigilanceTable", () => {
  it("GAP-AUDIT-VIGILANCE-05: offline cached data renders the offline badge", () => {
    seeded.mockReturnValue({ data: [OK], provenance: "cached", cachedAt: "2026-01-02T10:00:00.000Z", offline: true });
    renderTable([OK]);
    expect(screen.getByText(/Showing saved data.*you're offline/)).toBeInTheDocument();
  });

  it("GAP-AUDIT-VIGILANCE-04: an unrecognised stage and a null outcome render 'Unrecognised' (neutral), not Preliminary Enquiry / Pending", () => {
    seeded.mockReturnValue({ data: [UNKNOWN], provenance: "live", cachedAt: null, offline: false });
    const { container } = renderTable([UNKNOWN]);
    expect(screen.getAllByText("Unrecognised").length).toBe(2);
    expect(screen.queryByText("Preliminary Enquiry")).not.toBeInTheDocument();
    expect(screen.queryByText("Pending")).not.toBeInTheDocument();
    expect(container.querySelector(".pill.mut")).not.toBeNull();
    expect(container.querySelector('[title="appeal_pending"]')).not.toBeNull();
  });

  it("GAP-AUDIT-VIGILANCE-04: the Unrecognised label is translated in Hindi", () => {
    seeded.mockReturnValue({ data: [UNKNOWN], provenance: "live", cachedAt: null, offline: false });
    renderTable([UNKNOWN], "hi");
    expect(screen.getAllByText("अपरिचित").length).toBe(2);
  });
});
