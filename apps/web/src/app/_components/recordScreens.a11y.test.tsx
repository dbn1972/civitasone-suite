/**
 * UX-R5 / R2 axe checks on the changed record screens and forms (WCAG 2.2 AA rules that jsdom can evaluate;
 * color-contrast needs real layout and is covered by the token audit). Renders the record detail template
 * (RecordHeader + DetailList + ApprovalTrail + SummaryStrip), the form-field standard (Field + DateInput +
 * RequiredLegend), and the JV, indent, PO and GRN forms that adopted it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor, screen, fireEvent } from "@/test-utils/intl-render";
import type { AccountSummary } from "@civitasone/types";
import { RecordHeader } from "./ds/RecordHeader";
import { DetailList } from "./ds/DetailList";
import { ApprovalTrail } from "./ds/ApprovalTrail";
import { SummaryStrip } from "./ds/SummaryStrip";
import { Field } from "./ds/Field";
import { Input } from "./ds/Input";
import { DateInput } from "./ds/DateInput";
import { RequiredLegend } from "./ds/RequiredLegend";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/",
}));

import { JournalEntryForm } from "../(app)/finance/journal-entry/JournalEntryForm";
import { CreateIndentForm } from "../(app)/procurement/indents/new/CreateIndentForm";
import { CreatePOForm } from "../(app)/procurement/orders/new/CreatePOForm";
import { CreateGRNForm } from "../(app)/procurement/grn/new/CreateGRNForm";

async function violations(container: Element): Promise<string[]> {
  const axe = (await import("axe-core")).default;
  const out = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
  return out.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

const accounts: AccountSummary[] = [
  { code: "2202-cash", name: "Cash", type: "asset", currency: "INR", balanceDisplay: "0", status: "active" },
  { code: "2202-exp", name: "Office Expense", type: "expense", currency: "INR", balanceDisplay: "0", status: "active" },
];

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({ data: [] }), { status: 200 }));
});

describe("axe: record detail template (R5)", () => {
  it("header + details + trail + summary strip have no violations", async () => {
    const { container } = render(
      <main>
        <RecordHeader
          kind="Bill"
          recordNo="BILL/2026/0071"
          subtitle="Dell International Services India Pvt Ltd"
          status="pending"
          amountMinor="14445763"
          parties={[{ label: "Vendor", value: "Dell International Services India Pvt Ltd" }, { label: "Raised by", value: "K. Nair, Accounts Clerk" }]}
          primaryAction={<button type="button" className="btn primary">Pass bill</button>}
          back="/finance/expenditure/bills"
          backLabel="Bills"
        />
        <SummaryStrip items={[{ label: "lines", value: 3 }, { label: "matched", value: 3, tone: "good", href: "?m=1" }]} />
        <DetailList ariaLabel="Bill details" items={[{ label: "Gross", value: "₹1,47,406.00" }, { label: "Remarks", value: "", wide: true }]} />
        <ApprovalTrail entries={[{ actor: "K. Nair, Accounts Clerk", action: "submitted", at: "2026-10-28T05:30:00Z", remarks: "As per invoice." }]} />
      </main>,
    );
    expect(await violations(container)).toEqual([]);
  });
});

describe("axe: form-field standard", () => {
  it("label above, hint, required legend, blur error and Indian date input have no violations", async () => {
    const { container } = render(
      <form aria-label="Sample">
        <RequiredLegend />
        <Field label="Department" required hint="As on the establishment order"><Input defaultValue="" /></Field>
        <Field label="Indent date" required><DateInput value="" onChange={() => {}} /></Field>
      </form>,
    );
    fireEvent.blur(screen.getByLabelText(/Department/));
    fireEvent.blur(screen.getByLabelText(/Indent date/));
    expect(screen.getAllByRole("alert").length).toBe(2);
    expect(await violations(container)).toEqual([]);
  });
});

describe("axe: forms that adopted the standard", () => {
  it("journal voucher (out of balance, with the disabled-submit reason)", async () => {
    const { container } = render(<JournalEntryForm accounts={accounts} redirectTo="/finance/accounting/general-ledger" periods={[]} />);
    fireEvent.change(screen.getByLabelText("Debit amount, line 1"), { target: { value: "5000" } });
    expect(await violations(container)).toEqual([]);
  });

  it("purchase indent", async () => {
    const { container } = render(<CreateIndentForm />);
    await waitFor(() => expect(container.querySelector("form")).toBeTruthy());
    expect(await violations(container)).toEqual([]);
  });

  it("purchase order", async () => {
    const { container } = render(<CreatePOForm />);
    await waitFor(() => expect(container.querySelector("form")).toBeTruthy());
    expect(await violations(container)).toEqual([]);
  });

  it("goods receipt note", async () => {
    const { container } = render(<CreateGRNForm />);
    await waitFor(() => expect(container.querySelector("form")).toBeTruthy());
    expect(await violations(container)).toEqual([]);
  });
});
