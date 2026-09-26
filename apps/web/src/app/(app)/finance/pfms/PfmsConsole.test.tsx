import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { PfmsConsole } from "./PfmsConsole";
import type { PfmsBatchRow, PfmsConfig } from "./types";

// UX-017: PfmsConsole (and every panel it renders) now reads its copy
// through next-intl (useTranslations), so it needs a real provider in the
// tree -- same pattern as hr/leave/apply/ApplyLeaveForm.test.tsx.
function renderConsole(props: { batches: PfmsBatchRow[]; config: PfmsConfig | null }) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <PfmsConsole {...props} />
    </NextIntlClientProvider>,
  );
}

const batches: PfmsBatchRow[] = [
  {
    id: "b1", pfmsId: "PFMS-0001", type: "salary", channel: "treasury_batch", amountMinor: "150000000",
    agencyCode: "AG01", schemeCode: "SCH01", ddoCode: "DDO01",
    submissionStatus: "pending", signedAt: null,
  },
];

describe("PfmsConsole", () => {
  it("shows the Batches tab by default", () => {
    renderConsole({ batches, config: { agencyCode: "AG01", defaultDdo: "DDO01" } });
    expect(screen.getByText("PFMS-0001")).toBeInTheDocument();
  });

  it("switches to the Config tab", () => {
    renderConsole({ batches, config: { agencyCode: "AG01", defaultDdo: "DDO01" } });
    fireEvent.click(screen.getByText("Config"));
    expect(screen.getByText("AG01")).toBeInTheDocument();
  });

  it("switches to the Payments tab", () => {
    renderConsole({ batches, config: null });
    fireEvent.click(screen.getByText("Payments"));
    expect(screen.getByText("Submit Payment to PFMS")).toBeInTheDocument();
  });
});
