import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

// HIGH fix: InitiateSeparationAction (rendered in PageHeader's `actions`
// slot) calls useToast -- same mock TransferWithApproval.test.tsx already
// established for the identical requirement, rather than standing up a
// real ToastProvider this test doesn't otherwise need.
vi.mock("@/app/_components/ds/Toast", () => ({
  useToast: () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }),
}));

import RetirementPage from "./page";

// HIGH fix: RetirementPage's PageHeader now renders InitiateSeparationAction
// (client component) in its `actions` slot, which calls useTranslations --
// needs a NextIntlClientProvider ancestor, same harness WfhRequestsTable.
// test.tsx already established for the identical requirement. The page's
// own getTranslations (server-side) calls needed no such wrapper and still
// don't.
function renderPage(ui: Awaited<ReturnType<typeof RetirementPage>>) {
  return render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
}

describe("RetirementPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("tells the truth on a fetch failure instead of the old 'Showing saved information' copy", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error" });

    // RetirementPage now takes a { searchParams } props object (HIGH fix:
    // ?empId= prefill for the new InitiateSeparationAction) -- {} is the
    // real Next.js shape for "no query params", matching what these tests
    // are actually exercising (neither passes empId).
    const ui = await RetirementPage({});
    renderPage(ui);

    expect(screen.getByText("Couldn't load retirement records — showing nothing")).toBeInTheDocument();
  });

  it("renders the full register and the case workspace together for real data", async () => {
    fetchJsonMock.mockResolvedValue({
      data: [
        { id: "e1", employee: "Meena Iyer", department: "Revenue", designation: "Tehsildar", superannuationDate: "2027-01-15", separationType: "Superannuation", status: "pending" },
      ],
      source: "api",
    });

    // RetirementPage now takes a { searchParams } props object (HIGH fix:
    // ?empId= prefill for the new InitiateSeparationAction) -- {} is the
    // real Next.js shape for "no query params", matching what these tests
    // are actually exercising (neither passes empId).
    const ui = await RetirementPage({});
    renderPage(ui);

    // Appears both in the register table and the upcoming-retirements card.
    expect(screen.getAllByText("Meena Iyer").length).toBeGreaterThan(0);
  });
});
