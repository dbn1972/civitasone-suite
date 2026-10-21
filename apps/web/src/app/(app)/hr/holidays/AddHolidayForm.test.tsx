import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";
import { AddHolidayForm } from "./AddHolidayForm";

/**
 * UX-016: this used to show the raw backend `message` (falling back to
 * `Failed (${res.status})`) verbatim — the same class of leak useFormError
 * closes fleet-wide (UX-003).
 *
 * GAP-HR-HOLIDAYS-04: AddHolidayForm now reads its copy through next-intl
 * (useTranslations) instead of hard-coded English, so it needs a real
 * provider in the tree — same pattern as finance/pfms/ConfigPanel.test.tsx.
 * GAP-HR-HOLIDAYS-02: the form now takes a required `year` prop (bounds the
 * date input to the year being viewed).
 */
describe("AddHolidayForm — UX-016 clerk-safe errors", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  function openAndFillForm() {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <AddHolidayForm year={2027} />
      </NextIntlClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /add holiday/i }));
    fireEvent.change(screen.getByLabelText(/holiday name/i), { target: { value: "Republic Day" } });
    fireEvent.change(screen.getByLabelText(/^date/i), { target: { value: "2027-01-26" } });
    fireEvent.click(screen.getByRole("button", { name: /^add holiday$/i }));
  }

  it("shows a clerk-safe message, never the raw HTTP status, when creation fails", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 500 }));
    openAndFillForm();

    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(alert).toHaveTextContent(/couldn't save/i));
    expect(alert.textContent).not.toMatch(/\b500\b/);
  });

  it("never surfaces a raw server error message on a JSON error body", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ message: "duplicate holiday date" }), {
        status: 409,
        headers: { "content-type": "application/json" },
      }),
    );
    openAndFillForm();

    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(alert).toHaveTextContent(/This holiday was changed by someone else\. Refresh to see the latest version, then try again\./));
    expect(alert.textContent).not.toMatch(/duplicate holiday date/);
  });
});

/**
 * GAP-HR-HOLIDAYS-04 acceptance: "Switch locale to hi: ... form labels are
 * translated" and "no English literals remain in AddHolidayForm". hi.json used
 * to lack every form key (request.ts loads only the active locale file, so
 * next-intl fell back to printing the key path), and the Applicable To
 * placeholder was a literal.
 */
describe("AddHolidayForm — GAP-HR-HOLIDAYS-04 Hindi locale", () => {
  const fetchMock = vi.fn();
  beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
  afterEach(() => vi.unstubAllGlobals());

  function renderHi() {
    return render(
      <NextIntlClientProvider locale="hi" messages={hiMessages}>
        <AddHolidayForm year={2027} />
      </NextIntlClientProvider>,
    );
  }

  it("shows every label, option, placeholder and button in Hindi", () => {
    renderHi();
    fireEvent.click(screen.getByRole("button", { name: "+ अवकाश जोड़ें" }));

    expect(screen.getByLabelText(/अवकाश का नाम/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^दिनांक/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^प्रकार/)).toBeInTheDocument();
    expect(screen.getByLabelText(/इन पर लागू/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText("उदा. गणतंत्र दिवस")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("उदा. all")).toBeInTheDocument();
    for (const label of ["राजपत्रित", "प्रतिबंधित", "वैकल्पिक", "साप्ताहिक अवकाश"]) {
      expect(screen.getByRole("option", { name: label })).toBeInTheDocument();
    }
    // The submit button and the toggle (now "cancel") are Hindi too.
    expect(screen.getByRole("button", { name: "✕ रद्द करें" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "अवकाश जोड़ें" })).toBeInTheDocument();

    // None of the English strings the form used to hard-code are present.
    for (const english of [/holiday name/i, /applicable to/i, /^gazetted$/i, /^restricted$/i, /add holiday/i, /cancel/i]) {
      expect(screen.queryByText(english)).not.toBeInTheDocument();
    }
  });

  it("validation message and the saving state are Hindi", async () => {
    renderHi();
    fireEvent.click(screen.getByRole("button", { name: "+ अवकाश जोड़ें" }));
    fireEvent.click(screen.getByRole("button", { name: "अवकाश जोड़ें" }));
    expect(await screen.findByText("अवकाश का नाम आवश्यक है।")).toBeInTheDocument();
    expect(screen.getByText("दिनांक आवश्यक है।")).toBeInTheDocument();
  });

  it("the success message after a queued create is Hindi", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "x", status: "accepted" }), { status: 202 }));
    renderHi();
    fireEvent.click(screen.getByRole("button", { name: "+ अवकाश जोड़ें" }));
    fireEvent.change(screen.getByLabelText(/अवकाश का नाम/), { target: { value: "गणतंत्र दिवस" } });
    fireEvent.change(screen.getByLabelText(/^दिनांक/), { target: { value: "2027-01-26" } });
    fireEvent.click(screen.getByRole("button", { name: "अवकाश जोड़ें" }));
    expect(await screen.findByText(/जमा किया गया/)).toBeInTheDocument();
  });
});
