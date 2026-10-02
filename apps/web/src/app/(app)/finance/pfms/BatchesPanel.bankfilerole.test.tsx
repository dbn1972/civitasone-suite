import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { BatchesPanel } from "./BatchesPanel";
import type { PfmsBatchRow } from "./types";

const rows: PfmsBatchRow[] = [
  { id: "b1", pfmsId: "PFMS-0001", type: "salary", channel: "treasury_batch", amountMinor: "150000000", agencyCode: "A", schemeCode: "S", ddoCode: "D", submissionStatus: "pending", signedAt: null },
];

// GAP-FINANCE-PFMS-03
describe("BatchesPanel bank-file role gate", () => {
  it("offers no bank-file download when the session may not download it", () => {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <BatchesPanel batches={rows} canDownloadBankFile={false} />
      </NextIntlClientProvider>,
    );
    expect(screen.queryByRole("button", { name: /Download bank file/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign PFMS batch PFMS-0001" })).toBeInTheDocument();
  });
});
