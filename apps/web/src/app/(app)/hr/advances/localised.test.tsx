import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider, createTranslator } from "next-intl";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { RequestAdvanceForm } from "./RequestAdvanceForm";
import { ApproveAdvanceButton } from "./ApproveAdvanceButton";
import ErrorBoundary from "./error";
import Loading from "./loading";
import { mapAdvances } from "./mapAdvances";

/**
 * GAP-HR-ADVANCES-07 acceptance: "Switch locale to hi: form labels, toast and
 * error text render in Hindi; no English literals remain. Screen reader
 * announces the translated loading label." Every surface here renders under
 * locale "hi" and is checked for the Hindi text from hi.json.
 */
const hi = hiMessages.advances;

function inHindi(ui: React.ReactElement) {
  return render(<NextIntlClientProvider locale="hi" messages={hiMessages}>{ui}</NextIntlClientProvider>);
}

describe("advances under the Hindi locale (GAP-HR-ADVANCES-07)", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    refreshMock.mockReset();
    fetchMock.mockReset().mockResolvedValue(new Response(JSON.stringify({ id: "a1" }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("the request form's heading, toggle, labels and validation errors are Hindi", async () => {
    inHindi(<RequestAdvanceForm selfServiceOnly />);
    expect(screen.getByRole("heading", { name: hi.formHeading })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: hi.formNewRequest }));
    expect(await screen.findByLabelText(hi.formLabelAmount, { exact: false })).toBeInTheDocument();
    expect(screen.getByText(hi.formLabelPurpose, { exact: false })).toBeInTheDocument();
    // submit empty -> Hindi validation text, no English
    fireEvent.click(screen.getByRole("button", { name: hi.formSubmit }));
    expect(await screen.findByText(hi.formAmountInvalid)).toBeInTheDocument();
    expect(screen.getByText(hi.formPurposeInvalid)).toBeInTheDocument();
    expect(screen.queryByText(/Enter a valid amount|Purpose must be/i)).toBeNull();
  });

  it("the success toast is Hindi", async () => {
    inHindi(<RequestAdvanceForm selfServiceOnly />);
    fireEvent.click(screen.getByRole("button", { name: hi.formNewRequest }));
    const amount = await screen.findByLabelText(hi.formLabelAmount, { exact: false });
    fireEvent.change(amount, { target: { value: "5000" } });
    fireEvent.change(screen.getByPlaceholderText(hi.formPlaceholderPurpose), { target: { value: "चिकित्सा व्यय" } });
    fireEvent.click(screen.getByRole("button", { name: hi.formSubmit }));
    expect(await screen.findByText(hi.formSuccessMessage)).toBeInTheDocument();
    expect(screen.queryByText(/Advance request submitted/i)).toBeNull();
  });

  it("the approve / reject controls and their confirm dialogs are Hindi", async () => {
    inHindi(<ApproveAdvanceButton id="adv-1" />);
    expect(screen.getByRole("button", { name: hi.approveBtn })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: hi.rejectBtn })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: hi.approveBtn }));
    const approve = await screen.findByRole("alertdialog");
    expect(within(approve).getByText(hi.approveDialogTitle)).toBeInTheDocument();
    expect(within(approve).getByText(hi.approveDialogDescription)).toBeInTheDocument();
  });

  it("the reject dialog asks for the reason in Hindi", async () => {
    inHindi(<ApproveAdvanceButton id="adv-1" />);
    fireEvent.click(screen.getByRole("button", { name: hi.rejectBtn }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(hi.rejectDialogTitle)).toBeInTheDocument();
    expect(within(dialog).getByLabelText(hi.rejectReasonLabel)).toBeInTheDocument();
  });

  it("the route error boundary's back link is Hindi", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    inHindi(<ErrorBoundary error={new Error("boom")} reset={() => {}} />);
    expect(screen.getByRole("link", { name: hi.backToHr })).toHaveAttribute("href", "/hr");
    expect(screen.queryByRole("link", { name: "Back to HR" })).toBeNull();
  });

  it("the loading skeleton announces the translated label to a screen reader", () => {
    const { container } = inHindi(<Loading />);
    const region = container.querySelector("[aria-busy='true'][aria-label]");
    expect(region).not.toBeNull();
    expect(region!.getAttribute("aria-label")).toBe(hiMessages.msg.loading);
    expect(region!.getAttribute("aria-label")).not.toBe("Loading…");
  });
});

describe("Recovery column wording (GAP-HR-ADVANCES-07)", () => {
  const row = { id: "a", employeeId: "e", amountMinor: 1, purpose: "x", status: "pending" };

  it("is an ICU plural per locale: '1 month' / '6 months' in English, '6 माह' in Hindi", () => {
    const en = createTranslator({ locale: "en", messages: enMessages, namespace: "advances" });
    const hiT = createTranslator({ locale: "hi", messages: hiMessages, namespace: "advances" });
    const [one] = mapAdvances([{ ...row, recoveryMonths: 1 }], (count) => en("recoveryMonthsValue", { count }));
    const [six] = mapAdvances([{ ...row, recoveryMonths: 6 }], (count) => en("recoveryMonthsValue", { count }));
    const [sixHi] = mapAdvances([{ ...row, recoveryMonths: 6 }], (count) => hiT("recoveryMonthsValue", { count }));
    expect(one!.recoveryMonths).toBe("1 month");
    expect(six!.recoveryMonths).toBe("6 months");
    expect(sixHi!.recoveryMonths).toBe("6 माह");
  });

  it("a non-numeric month count is a dash, whatever the locale", () => {
    const [r] = mapAdvances([{ ...row, recoveryMonths: Number.NaN }], () => "never called");
    expect(r!.recoveryMonths).toBe("—");
  });
});

describe("advances locale parity", () => {
  it("hi has every key en has (no raw key shown to a Hindi user)", () => {
    expect(Object.keys(hiMessages.advances).sort()).toEqual(Object.keys(enMessages.advances).sort());
  });
});
