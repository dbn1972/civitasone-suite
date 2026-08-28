import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { AccountSummary } from "@civitasone/types";

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
});
