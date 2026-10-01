import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { LoansTable, humaniseCode, type LoanRow } from "./LoansTable";

const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_OFFICER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

// UX-017: LoansTable is now translated (useTranslations("loansTable")), so
// every render needs a real NextIntlClientProvider in the tree.
function renderTable(rows: LoanRow[], props: { canDisburse?: boolean; currentUserId?: string | null } = { canDisburse: true, currentUserId: ME }) {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <LoansTable rows={rows} {...props} />
    </NextIntlClientProvider>,
  );
}

const rows: LoanRow[] = [
  { id: "l1", loanNo: "LN-1", loanType: "personal", principalMinor: "100000", outstandingMinor: "100000", emiMinor: "10000", tenureMonths: 10, status: "applied", createdBy: OTHER_OFFICER },
];

const twoRows: LoanRow[] = [
  ...rows,
  { id: "l2", loanNo: "LN-2", loanType: "vehicle", principalMinor: "200000", outstandingMinor: "200000", emiMinor: "20000", tenureMonths: 20, status: "applied", createdBy: OTHER_OFFICER },
];

async function confirmDisburse(reason = "Sanction order 42") {
  fireEvent.click(screen.getByRole("button", { name: /^Disburse/ }));
  await waitFor(() => expect(screen.getByText("Disburse this loan?")).toBeInTheDocument());
  fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: reason } });
  fireEvent.click(screen.getByText("Disburse loan"));
}

describe("LoansTable", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("renders loan rows", () => {
    renderTable(rows);
    expect(screen.getByText("LN-1")).toBeInTheDocument();
  });

  it("gives each row's Disburse button a unique accessible name", () => {
    renderTable(twoRows);
    expect(screen.getByRole("button", { name: "Disburse loan LN-1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Disburse loan LN-2" })).toBeInTheDocument();
  });

  it("disburses a loan on confirm with the typed reason (happy path)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "l1", status: "accepted", correlationId: "c1" }), { status: 202 }),
    );

    renderTable(rows);
    await confirmDisburse();

    await waitFor(() => {
      expect(screen.getByText("Loan disbursement queued.")).toBeInTheDocument();
    });
    expect(refreshMock).toHaveBeenCalled();
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toContain("v1/payroll/loans/l1/disburse");
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ reason: "Sanction order 42" });
  });

  it("will not confirm a disbursal without a reason (GAP-PAYROLL-LOANS-02)", async () => {
    renderTable(rows);
    fireEvent.click(screen.getByRole("button", { name: /^Disburse/ }));
    await waitFor(() => expect(screen.getByText("Disburse this loan?")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Disburse loan" })).toBeDisabled();
  });

  it("surfaces a server error on the confirm dialog (error path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 500 }));

    renderTable(rows);
    await confirmDisburse();

    await waitFor(() => {
      expect(screen.getByText(/couldn't save/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/API_ERROR/)).not.toBeInTheDocument();
  });

  it("explains a server-side maker-checker rejection (403 SELF_DISBURSE_FORBIDDEN)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ code: "SELF_DISBURSE_FORBIDDEN", message: "x" }), { status: 403 }),
    );
    renderTable(rows);
    await confirmDisburse();
    await waitFor(() => {
      expect(screen.getByText("You created this loan, so another payroll officer must disburse it.")).toBeInTheDocument();
    });
  });

  it("renders no Disburse action at all when canDisburse=false (GAP-PAYROLL-LOANS-02)", () => {
    renderTable(twoRows, { canDisburse: false, currentUserId: ME });
    expect(screen.queryByRole("button", { name: /^Disburse/ })).not.toBeInTheDocument();
    expect(screen.queryByText("Action")).not.toBeInTheDocument();
  });

  it("does not offer Disburse on a loan the current user created (maker-checker)", () => {
    renderTable([{ ...rows[0]!, createdBy: ME }]);
    expect(screen.queryByRole("button", { name: /^Disburse/ })).not.toBeInTheDocument();
    expect(screen.getByText("Created by you — another officer must disburse")).toBeInTheDocument();
  });

  it("shows translated loan types, humanising unknown codes (GAP-PAYROLL-LOANS-04)", () => {
    renderTable([
      { ...rows[0]!, id: "a", loanNo: "LN-A", loanType: "house_building" },
      { ...rows[0]!, id: "b", loanNo: "LN-B", loanType: "computer_advance" },
    ]);
    expect(screen.getByText("House Building")).toBeInTheDocument();
    expect(screen.getByText("Computer advance")).toBeInTheDocument();
    expect(screen.queryByText("house_building")).not.toBeInTheDocument();
  });
});

describe("humaniseCode", () => {
  it("turns snake/kebab codes into a readable label and tolerates odd input", () => {
    expect(humaniseCode("computer_advance")).toBe("Computer advance");
    expect(humaniseCode("medical-advance")).toBe("Medical advance");
    expect(humaniseCode("")).toBe("");
  });
});
