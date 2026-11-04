import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { YearEndClosePanel } from "./YearEndClosePanel";

const render = (ui: React.ReactElement, locale: "en" | "hi" = "en") =>
  rtlRender(<NextIntlClientProvider locale={locale} messages={locale === "en" ? enMessages : hiMessages}>{ui}</NextIntlClientProvider>);

const NOT_RUN = {
  fiscalYear: "2025-26", nextFiscalYear: "2026-27", status: "not_run", runAt: null, runBy: null,
  openingBalanceCount: 0, lapseTotalMinor: "0", fundCarriedMinor: "0",
};
const DONE = {
  ...NOT_RUN, status: "done", runAt: "2026-04-01T04:30:00.000Z", runBy: "Asha Rao", openingBalanceCount: 14,
  lapseTotalMinor: "123456789", fundCarriedMinor: "500000",
};

function mockApi(status: unknown, close: Response = new Response(JSON.stringify({ status: "accepted" }), { status: 202 })) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    if ((init as RequestInit | undefined)?.method === "POST") return close;
    if (status === "fail") return new Response(null, { status: 503 });
    return new Response(JSON.stringify(status), { status: 200 });
  });
}

describe("YearEndClosePanel (fx-p3)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("explains what the close does: lapse statement, opening balances for carry-forward heads only, safe to re-run, needs a reason", async () => {
    mockApi(NOT_RUN);
    render(<YearEndClosePanel years={["2025-26", "2026-27"]} defaultFy="2025-26" canRun />);
    expect(screen.getByRole("heading", { name: "Year-end close" })).toBeInTheDocument();
    const text = document.body.textContent ?? "";
    expect(text).toMatch(/lapse statement/i);
    expect(text).toMatch(/balance-sheet, deposit, advance, suspense and Public Account heads/);
    expect(text).toMatch(/revenue and expenditure heads start the new year at zero/i);
    expect(text).toMatch(/run it again safely/i);
    expect(await screen.findByText("Not run yet for FY 2025-26.")).toBeInTheDocument();
  });

  it("asks for the selected financial year and shows a done status with who/when and the figures", async () => {
    const fetchMock = mockApi(DONE);
    render(<YearEndClosePanel years={["2025-26", "2026-27"]} defaultFy="2025-26" canRun />);
    expect(await screen.findByText(/Done for FY 2025-26 on 01 Apr 2026, 10:00 am by Asha Rao\./i)).toBeInTheDocument();
    expect(String(fetchMock.mock.calls[0]![0])).toBe("/api/proxy/v1/finance/year-end/2025-26");
    expect(screen.getByText("14")).toBeInTheDocument();
    expect(screen.getByText("₹12,34,567.89")).toBeInTheDocument();
    expect(screen.getByText("₹5,000.00")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run again" })).toBeInTheDocument();
  });

  it("changing the year fetches that year", async () => {
    const fetchMock = mockApi(NOT_RUN);
    render(<YearEndClosePanel years={["2025-26", "2026-27"]} defaultFy="2025-26" canRun />);
    await screen.findByText(/Not run yet/);
    fireEvent.change(screen.getByLabelText("Financial year to close"), { target: { value: "2026-27" } });
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith("/year-end/2026-27"))).toBe(true));
  });

  it("needs a reason of at least 10 characters and POSTs it; 202 says accepted", async () => {
    const fetchMock = mockApi(NOT_RUN);
    render(<YearEndClosePanel years={["2025-26"]} defaultFy="2025-26" canRun />);
    await screen.findByText(/Not run yet/);
    fireEvent.click(screen.getByRole("button", { name: "Run year-end close" }));
    expect(await screen.findByText("Run the year-end close for FY 2025-26?")).toBeInTheDocument();
    const confirm = screen.getAllByRole("button", { name: "Run year-end close" }).at(-1)!;
    fireEvent.change(screen.getByLabelText("Reason for the year-end close"), { target: { value: "short" } });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Reason for the year-end close"), { target: { value: "Annual accounts closed for 2025-26" } });
    expect(confirm).not.toBeDisabled();
    fireEvent.click(confirm);
    await waitFor(() => expect(fetchMock.mock.calls.some(([, i]) => (i as RequestInit | undefined)?.method === "POST")).toBe(true));
    const post = fetchMock.mock.calls.find(([, i]) => (i as RequestInit | undefined)?.method === "POST")!;
    expect(String(post[0])).toBe("/api/proxy/v1/finance/year-end/2025-26/close");
    expect(JSON.parse(String((post[1] as RequestInit).body))).toEqual({ reason: "Annual accounts closed for 2025-26" });
    expect(await screen.findByText(/Year-end close for FY 2025-26 accepted/)).toBeInTheDocument();
  });

  it.each([
    ["FY_OPEN_PERIODS", /Every month of this financial year must be hard-closed first/],
    ["OPENING_BALANCES_MANUAL", /entered by hand/],
  ])("409 %s is explained through the catalogue, never the raw code", async (code, re) => {
    mockApi(NOT_RUN, new Response(JSON.stringify({ code, message: "raw server text" }), { status: 409 }));
    render(<YearEndClosePanel years={["2025-26"]} defaultFy="2025-26" canRun />);
    await screen.findByText(/Not run yet/);
    fireEvent.click(screen.getByRole("button", { name: "Run year-end close" }));
    fireEvent.change(await screen.findByLabelText("Reason for the year-end close"), { target: { value: "Annual accounts closed for 2025-26" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Run year-end close" }).at(-1)!);
    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(alert).toHaveTextContent(re));
    expect(alert.textContent).not.toMatch(new RegExp(`${code}|raw server text`));
  });

  it("a failed status read is an error state, and the run button is not offered", async () => {
    mockApi("fail");
    render(<YearEndClosePanel years={["2025-26"]} defaultFy="2025-26" canRun />);
    expect(await screen.findByText(/could not check the year-end status/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Run year-end close" })).not.toBeInTheDocument();
  });

  it("a non-admin sees the status but no run button", async () => {
    mockApi(NOT_RUN);
    render(<YearEndClosePanel years={["2025-26"]} defaultFy="2025-26" canRun={false} />);
    await screen.findByText(/Not run yet/);
    expect(screen.queryByRole("button", { name: /Run/ })).not.toBeInTheDocument();
    expect(screen.getByText("Only a finance administrator can run the year-end close.")).toBeInTheDocument();
  });

  it("renders in Hindi", async () => {
    mockApi(NOT_RUN);
    render(<YearEndClosePanel years={["2025-26"]} defaultFy="2025-26" canRun />, "hi");
    expect(screen.getByRole("heading", { name: hiMessages.financeYearEnd.title })).toBeInTheDocument();
    expect(hiMessages.financeYearEnd.title).not.toBe(enMessages.financeYearEnd.title);
    expect(Object.keys(hiMessages.financeYearEnd).sort()).toEqual(Object.keys(enMessages.financeYearEnd).sort());
  });
});
