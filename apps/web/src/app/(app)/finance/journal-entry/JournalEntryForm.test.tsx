import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { AccountSummary } from "@civitasone/types";
import { formatMoney } from "@/lib/formatters";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { JournalEntryForm } from "./JournalEntryForm";

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

    expect(screen.getByText("Please correct the highlighted fields before posting.")).toBeInTheDocument();
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
      expect(alerts.some((a) => /couldn't save/i.test(a.textContent ?? ""))).toBe(true);
    });
    const alerts = screen.getAllByRole("alert");
    for (const alert of alerts) {
      expect(alert.textContent).not.toMatch(/\b409\b/);
      expect(alert.textContent).not.toMatch(/gl_period_closed/i);
      expect(alert.textContent).not.toMatch(/request failed/i);
    }
  });
});
