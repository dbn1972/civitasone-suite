import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { AccountSummary } from "@civitasone/types";
import { formatMoney } from "@/lib/formatters";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { JournalEntryForm, voucherNoError } from "./JournalEntryForm";

const accounts: AccountSummary[] = [
  { code: "2202-cash", name: "Cash", type: "asset", currency: "INR", balanceDisplay: "0", status: "active" },
  { code: "2202-exp", name: "Office Expense", type: "expense", currency: "INR", balanceDisplay: "0", status: "active" },
];

function fillBalancedLines() {
  // "Voucher Number" label wraps a nested HelpTip button (aria-label "What is
  // Voucher?"), so the plain text query needs to be scoped to the input.
  fireEvent.change(screen.getByLabelText("Voucher Number", { selector: "input" }), { target: { value: "JV-TEST-001" } });
  fireEvent.change(screen.getByLabelText("Posting Date"), { target: { value: "2026-04-15" } });
  fireEvent.change(screen.getByLabelText("Narration"), { target: { value: "Test entry" } });
  fireEvent.change(screen.getByLabelText("Account code, line 1"), { target: { value: "2202-exp" } });
  fireEvent.change(screen.getByLabelText("Debit amount, line 1"), { target: { value: "5000" } });
  fireEvent.change(screen.getByLabelText("Account code, line 2"), { target: { value: "2202-cash" } });
  fireEvent.change(screen.getByLabelText("Credit amount, line 2"), { target: { value: "5000" } });
}

describe("JournalEntryForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // Regression test for the bug where debitMinor/creditMinor were sent as
  // JSON numbers: the backend's zMoneyMinor validator (gl/validators.ts)
  // only accepts a digit-string or a real bigint, and JSON has neither a
  // bigint type nor an implicit number->string coercion — so every real
  // submission 400'd with "Invalid input" on both fields (reproduced live
  // against the gateway during this audit). This asserts the actual request
  // body sent over the wire, not just the UI's happy-path rendering, which
  // is exactly what let the bug ship unnoticed.
  it("serializes line amounts as bigint-safe minor-unit strings, not numbers", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "jrn-1", status: "accepted" }), { status: 202 }),
    );

    render(<JournalEntryForm accounts={accounts} />);
    fillBalancedLines();

    fireEvent.click(screen.getByRole("button", { name: "Post Journal Entry" }));
    await waitFor(() => expect(screen.getByText("Post this journal entry?")).toBeInTheDocument());

    // The confirm button is disabled until a reason is entered (maker-checker) —
    // verifies this irreversible action is actually gated, not just decorated.
    const confirmButton = screen.getByRole("button", { name: "Post entry" });
    expect(confirmButton).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Reason / authority for posting (maker-checker)"), {
      target: { value: "Month-end accrual" },
    });
    expect(confirmButton).not.toBeDisabled();
    fireEvent.click(confirmButton);

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/proxy/v1/finance/journals");
    const body = JSON.parse((init as RequestInit).body as string);

    expect(body.lines).toHaveLength(2);
    for (const line of body.lines) {
      expect(typeof line.debitMinor).toBe("string");
      expect(typeof line.creditMinor).toBe("string");
      expect(line.debitMinor).toMatch(/^\d+$/);
      expect(line.creditMinor).toMatch(/^\d+$/);
    }
    // 5000 rupees -> 500000 paise
    expect(body.lines[0].debitMinor).toBe("500000");
    expect(body.lines[1].creditMinor).toBe("500000");

    await waitFor(() => {
      expect(screen.getByText(/Journal entry accepted for processing \(202\)\./)).toBeInTheDocument();
    });
  });

  // Medium finding: the running Debit/Credit totals indicator was reported
  // as never updating as the clerk typed. Guards the derived state
  // (totalDebitPaise/totalCreditPaise in JournalEntryForm.tsx) actually
  // tracking `lines` on every keystroke, not just at submit/validate time --
  // exactly the gap a fetch-mock test like the ones above can't catch, since
  // it only asserts on the request body built from state at submit, never on
  // what the totals row displays while a clerk is still typing.
  it("updates the running debit/credit totals live as amounts are typed", () => {
    render(<JournalEntryForm accounts={accounts} />);

    // Both sides start at zero.
    expect(screen.getAllByText(formatMoney(0)).length).toBeGreaterThanOrEqual(2);

    fireEvent.change(screen.getByLabelText("Debit amount, line 1"), { target: { value: "1250.50" } });
    expect(screen.getByText(formatMoney(125050))).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Credit amount, line 2"), { target: { value: "999.25" } });
    expect(screen.getByText(formatMoney(99925))).toBeInTheDocument();
    // The earlier debit keystroke's total is still showing too -- this is
    // the exact regression this test guards against: a stale derived total
    // would freeze at whatever it first rendered instead of tracking every
    // keystroke on every line.
    expect(screen.getByText(formatMoney(125050))).toBeInTheDocument();

    // Typing again on the SAME field updates it again, not just the first keystroke.
    fireEvent.change(screen.getByLabelText("Debit amount, line 1"), { target: { value: "2000" } });
    expect(screen.getByText(formatMoney(200000))).toBeInTheDocument();
    expect(screen.queryByText(formatMoney(125050))).not.toBeInTheDocument();
  });

  it("rejects submission with an out-of-balance error before ever calling fetch", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    render(<JournalEntryForm accounts={accounts} />);
    fireEvent.change(screen.getByLabelText("Voucher Number", { selector: "input" }), { target: { value: "JV-TEST-002" } });
    fireEvent.change(screen.getByLabelText("Posting Date"), { target: { value: "2026-04-15" } });
    fireEvent.change(screen.getByLabelText("Narration"), { target: { value: "Unbalanced test" } });
    fireEvent.change(screen.getByLabelText("Account code, line 1"), { target: { value: "2202-exp" } });
    fireEvent.change(screen.getByLabelText("Debit amount, line 1"), { target: { value: "5000" } });
    fireEvent.change(screen.getByLabelText("Account code, line 2"), { target: { value: "2202-cash" } });
    fireEvent.change(screen.getByLabelText("Credit amount, line 2"), { target: { value: "1000" } });

    fireEvent.click(screen.getByRole("button", { name: "Post Journal Entry" }));

    // GAP-FINANCE-JOURNAL-ENTRY-05: one alert (the balance one), no second generic banner.
    expect(screen.queryByText("Please correct the highlighted fields before posting.")).not.toBeInTheDocument();
    const alerts = screen.getAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveTextContent(`Debit and credit differ by ${formatMoney(400000)}`);
    expect(alerts[0]).toHaveTextContent(`debit ${formatMoney(500000)}, credit ${formatMoney(100000)}`);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // UX-016: the failed-post branch used to build `msg` from the backend's
  // own `message`/`error` field, the raw response text, or a literal
  // `Request failed (${res.status})` -- both the same class of leak
  // useFormError/toHumanError closes fleet-wide (UX-003). Proves the fix: a
  // failed post shows a clerk-safe catalogued message, never the raw status
  // or raw backend text.
  it("shows a clerk-safe error when posting fails, never the raw status or backend text", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ message: "gl_period_closed: posting period is closed" }), { status: 409 }),
    );

    render(<JournalEntryForm accounts={accounts} />);
    fillBalancedLines();

    fireEvent.click(screen.getByRole("button", { name: "Post Journal Entry" }));
    await waitFor(() => expect(screen.getByText("Post this journal entry?")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Reason / authority for posting (maker-checker)"), {
      target: { value: "Month-end accrual" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Post entry" }));

    // Both the form's own top-level banner AND ConfirmDialog's errorMessage
    // render the same clerk-safe text with role="alert" while the dialog is
    // still open on a failed post -- assert every alert is clean, not just
    // the first one findByRole would grab.
    await waitFor(async () => {
      const alerts = await screen.findAllByRole("alert");
      expect(alerts.some((a) => /This journal entry was changed by someone else\. Refresh to see the latest version, then try again\./.test(a.textContent ?? ""))).toBe(true);
    });
    const alerts = screen.getAllByRole("alert");
    for (const alert of alerts) {
      expect(alert.textContent).not.toMatch(/\b409\b/);
      expect(alert.textContent).not.toMatch(/gl_period_closed/i);
      expect(alert.textContent).not.toMatch(/request failed/i);
    }
  });

  // GAP-FINANCE-JOURNAL-ENTRY-01 / VOUCHERS-NEW-01
  it("renders no form and no free-text account input when there are no accounts", () => {
    render(<JournalEntryForm accounts={[]} />);
    expect(screen.getByText("No accounts configured")).toBeInTheDocument();
    expect(screen.queryByLabelText(/Account code/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Post Journal Entry" })).not.toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain("1000");
    expect(document.body.innerHTML).not.toContain("2000");
  });

  it("does not offer inactive accounts and rejects a code that is not in the list", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<JournalEntryForm accounts={[...accounts, { code: "9999-old", name: "Closed", type: "asset", currency: "INR", balanceDisplay: "0", status: "inactive" }]} />);
    expect(screen.queryByText(/9999-old/)).not.toBeInTheDocument();
    fillBalancedLines();
    // tamper: force a code that is not a postable account
    const select = screen.getByLabelText("Account code, line 1") as HTMLSelectElement;
    const opt = document.createElement("option");
    opt.value = "NOPE"; opt.textContent = "NOPE";
    select.appendChild(opt);
    fireEvent.change(select, { target: { value: "NOPE" } });
    fireEvent.click(screen.getByRole("button", { name: "Post Journal Entry" }));
    expect(screen.getByText("Select an account from the list.")).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // GAP-FINANCE-JOURNAL-ENTRY-02
  it("rejects an amount with more than 2 decimals instead of rounding it", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<JournalEntryForm accounts={accounts} />);
    fillBalancedLines();
    fireEvent.change(screen.getByLabelText("Debit amount, line 1"), { target: { value: "0.285" } });
    expect(screen.getAllByText("Enter an amount with at most 2 decimals.").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Post Journal Entry" }));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("totals 0.1 + 0.2 exactly and shows a lakh-grouped preview under the field", () => {
    render(<JournalEntryForm accounts={accounts} />);
    fireEvent.change(screen.getByLabelText("Debit amount, line 1"), { target: { value: "0.1" } });
    fireEvent.change(screen.getByLabelText("Debit amount, line 2"), { target: { value: "0.2" } });
    fireEvent.change(screen.getByLabelText("Credit amount, line 1"), { target: { value: "0.30" } });
    expect(screen.getAllByText(formatMoney(30n)).length).toBeGreaterThanOrEqual(2); // both totals
    fireEvent.change(screen.getByLabelText("Debit amount, line 1"), { target: { value: "1234567.89" } });
    expect(screen.getByText("= ₹12,34,567.89")).toBeInTheDocument();
  });

  // GAP-FINANCE-VOUCHERS-NEW-02
  it("keeps the success message visible after a 202 and does not navigate until the user chooses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: "jrn-1" }), { status: 202 }));
    const assign = vi.fn();
    Object.defineProperty(window, "location", { value: { ...window.location, assign }, writable: true });

    render(<JournalEntryForm accounts={accounts} redirectTo="/finance/accounting/general-ledger" />);
    fillBalancedLines();
    fireEvent.click(screen.getByRole("button", { name: "Post Journal Entry" }));
    await waitFor(() => expect(screen.getByText("Post this journal entry?")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Reason / authority for posting (maker-checker)"), { target: { value: "Month-end" } });
    fireEvent.click(screen.getByRole("button", { name: "Post entry" }));

    await waitFor(() => expect(screen.getByText(/accepted for processing/)).toBeInTheDocument());
    expect(assign).not.toHaveBeenCalled();
    const link = screen.getByRole("link", { name: "View in General Ledger" });
    expect(link.getAttribute("href")).toBe("/finance/accounting/general-ledger?posted=JV-TEST-001&state=queued");
    expect(screen.getByRole("button", { name: "Post another" })).toBeInTheDocument();
  });

  it("shows 'posted successfully' with a GL link after a 201", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({}), { status: 201 }));
    render(<JournalEntryForm accounts={accounts} redirectTo="/finance/accounting/general-ledger" />);
    fillBalancedLines();
    fireEvent.click(screen.getByRole("button", { name: "Post Journal Entry" }));
    await waitFor(() => expect(screen.getByText("Post this journal entry?")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Reason / authority for posting (maker-checker)"), { target: { value: "Month-end" } });
    fireEvent.click(screen.getByRole("button", { name: "Post entry" }));
    await waitFor(() => expect(screen.getByText("Journal entry posted successfully.")).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "View in General Ledger" }).getAttribute("href")).toContain("state=posted");
  });

  // Review M3: group heads (some other head's parent) are not postable.
  it("does not offer group heads (heads that have children) in the account dropdown", () => {
    render(
      <JournalEntryForm
        accounts={[
          { id: "g1", code: "2000", name: "Liabilities", type: "liability", currency: "INR", balanceDisplay: "0", status: "active" },
          { id: "c1", parentId: "g1", code: "2100", name: "Creditors", type: "liability", currency: "INR", balanceDisplay: "0", status: "active" },
        ]}
      />,
    );
    const select = screen.getByLabelText("Account code, line 1") as HTMLSelectElement;
    const values = [...select.options].map((o) => o.value);
    expect(values).toContain("2100");
    expect(values).not.toContain("2000");
  });

  // Review M4: default posting date is the IST calendar date, not UTC.
  it("defaults the posting date to the IST date (00:30 IST on 1 April is still 1 April)", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-03-31T19:00:00.000Z")); // 00:30 IST, 1 April 2026
      render(<JournalEntryForm accounts={accounts} />);
      expect((screen.getByLabelText("Posting Date") as HTMLInputElement).value).toBe("2026-04-01");
    } finally {
      vi.useRealTimers();
    }
  });

  // Review L1
  it("explains commas instead of blaming decimals", () => {
    render(<JournalEntryForm accounts={accounts} />);
    fireEvent.change(screen.getByLabelText("Debit amount, line 1"), { target: { value: "1,00,000" } });
    expect(screen.getAllByText(/remove the commas/).length).toBeGreaterThan(0);
    expect(screen.queryByText("Enter an amount with at most 2 decimals.")).not.toBeInTheDocument();
  });
});

describe("voucherNoError (GAP-FINANCE-ACCOUNTING-VOUCHERS-NEW-05)", () => {
  it("accepts ordinary series formats", () => {
    expect(voucherNoError("JV-2026-001")).toBeNull();
    expect(voucherNoError("PV/26-27/0042")).toBeNull();
  });
  it("rejects empty, over-long and odd-character references", () => {
    expect(voucherNoError("  ")).toMatch(/required/);
    expect(voucherNoError("A".repeat(65))).toMatch(/at most 64/);
    expect(voucherNoError("-bad")).toMatch(/letters, numbers/);
    expect(voucherNoError("JV<script>")).toMatch(/letters, numbers/);
  });
  it("shows the error under the field and blocks posting", () => {
    render(<JournalEntryForm accounts={accounts} />);
    fireEvent.change(screen.getByLabelText("Voucher Number", { selector: "input" }), { target: { value: "bad#no" } });
    fireEvent.click(screen.getByRole("button", { name: "Post Journal Entry" }));
    expect(screen.getByText(/Use letters, numbers and/)).toBeInTheDocument();
  });
});

// GAP-FINANCE-JOURNAL-ENTRY-03: closed-period check on the posting date.
describe("JournalEntryForm posting-date period check (GAP-FINANCE-JOURNAL-ENTRY-03)", () => {
  beforeEach(() => vi.restoreAllMocks());
  const periods = [
    { period: "2026-04", status: "open" },
    { period: "2026-03", status: "hard_close" },
    { period: "2026-02", status: "soft_close" },
  ];

  it("a date in a hard_close period is a field error and no confirm dialog opens", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<JournalEntryForm accounts={accounts} periods={periods} />);
    fillBalancedLines();
    fireEvent.change(screen.getByLabelText("Posting Date"), { target: { value: "2026-03-20" } });
    fireEvent.click(screen.getByRole("button", { name: "Post Journal Entry" }));
    expect(screen.getAllByText(/Period 2026-03 is hard-closed/).length).toBeGreaterThan(0);
    expect(screen.queryByText("Post this journal entry?")).not.toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("a soft_close period blocks posting like a hard close (server refuses journals there)", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<JournalEntryForm accounts={accounts} periods={periods} />);
    fillBalancedLines();
    fireEvent.change(screen.getByLabelText("Posting Date"), { target: { value: "2026-02-10" } });
    fireEvent.click(screen.getByRole("button", { name: "Post Journal Entry" }));
    expect(screen.getAllByText(/only adjustment\/closing journals are accepted in a soft-closed period/).length).toBeGreaterThan(0);
    expect(screen.queryByText("Post this journal entry?")).not.toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("an open period shows an open pill", () => {
    render(<JournalEntryForm accounts={accounts} periods={periods} />);
    fireEvent.change(screen.getByLabelText("Posting Date"), { target: { value: "2026-04-15" } });
    expect(screen.getByText("Period 2026-04 is open.")).toBeInTheDocument();
  });

  it("when the periods failed to load, status is shown as unverified rather than silently allowed", () => {
    render(<JournalEntryForm accounts={accounts} periods={null} />);
    fireEvent.change(screen.getByLabelText("Posting Date"), { target: { value: "2026-04-15" } });
    expect(screen.getByText(/could not be loaded, so 2026-04 is unverified/)).toBeInTheDocument();
  });
});

// GAP-FINANCE-JOURNAL-ENTRY-04
describe("JournalEntryForm account picker (GAP-FINANCE-JOURNAL-ENTRY-04)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("groups accounts by type and filters them as the user types", () => {
    render(<JournalEntryForm accounts={accounts} />);
    const select = screen.getByLabelText("Account code, line 1") as HTMLSelectElement;
    expect(Array.from(select.querySelectorAll("optgroup")).map((g) => g.label)).toEqual(["Assets", "Expenses"]);
    fireEvent.change(screen.getByLabelText("Filter accounts"), { target: { value: "cash" } });
    const names = Array.from((screen.getByLabelText("Account code, line 1") as HTMLSelectElement).options).map((o) => o.textContent);
    expect(names).toContain("2202-cash — Cash");
    expect(names).not.toContain("2202-exp — Office Expense");
    // line 2 is already set to Office Expense: a filter never blanks an existing selection.
    expect(Array.from((screen.getByLabelText("Account code, line 2") as HTMLSelectElement).options).map((o) => o.textContent)).toContain("2202-exp — Office Expense");
  });
});

// GAP-FINANCE-JOURNAL-ENTRY-06
describe("JournalEntryForm voucher number (GAP-FINANCE-JOURNAL-ENTRY-06)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("a blank voucher number is allowed and sent as AUTO (server allocates it)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({}), { status: 202 }));
    render(<JournalEntryForm accounts={accounts} />);
    fillBalancedLines();
    fireEvent.change(screen.getByLabelText("Voucher Number", { selector: "input" }), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Post Journal Entry" }));
    await waitFor(() => expect(screen.getByText("Post this journal entry?")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Reason / authority for posting (maker-checker)"), { target: { value: "Month-end" } });
    fireEvent.click(screen.getByRole("button", { name: "Post entry" }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.voucherNo).toBe("AUTO");
  });
});
