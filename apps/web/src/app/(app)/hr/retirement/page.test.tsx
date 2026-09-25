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

  // SEC CRITICAL regression (PR #1572 fix-up round): a direct navigation to
  // /hr/retirement?empId=<already-exited-id> used to reach a fully
  // pre-filled, submittable separation form -- this page fetches the full
  // employee record for the name already (getEmployeeById), and now also
  // threads its status through to InitiateSeparationAction so the guarded
  // "already exited" state renders instead. See that component's own tests
  // for the guard logic itself; this test proves the wiring through THIS
  // page actually reaches it.
  it("?empId= for an already-exited employee renders the guarded notice, not a submittable form", async () => {
    fetchJsonMock.mockImplementation((url: string) => {
      if (url.includes("/employees/")) {
        return Promise.resolve({ data: { id: "emp-exited", name: "Already Gone", status: "retired" }, source: "api" });
      }
      return Promise.resolve({ data: [], source: "api" });
    });

    const ui = await RetirementPage({ searchParams: { empId: "emp-exited" } });
    renderPage(ui);

    expect(screen.getByText("Already Gone has already exited (status: retired) and cannot be separated again.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "+ Initiate Separation" })).not.toBeInTheDocument();
  });

  it("?empId= for a non-exited employee still prefills the normal submittable form", async () => {
    fetchJsonMock.mockImplementation((url: string) => {
      if (url.includes("/employees/")) {
        return Promise.resolve({ data: { id: "emp-active", name: "Still Serving", status: "confirmed" }, source: "api" });
      }
      return Promise.resolve({ data: [], source: "api" });
    });

    const ui = await RetirementPage({ searchParams: { empId: "emp-active" } });
    renderPage(ui);

    expect(screen.getByRole("button", { name: "+ Initiate Separation" })).toBeInTheDocument();
    expect(screen.queryByText(/has already exited/)).not.toBeInTheDocument();
  });
});
