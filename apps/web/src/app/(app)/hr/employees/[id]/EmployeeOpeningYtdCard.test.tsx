/**
 * PR #2459 review B1: opening year-to-date on the employee profile -- payroll
 * staff enter pre-go-live / previous-employer salary and TDS; a payroll admin
 * other than the maker approves (server-enforced maker-checker).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";
import { EmployeeOpeningYtdCard, financialYearOf } from "./EmployeeOpeningYtdCard";

const EMP = "77777777-7777-4777-8777-777777777777";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const PENDING = { id: "88888888-8888-4888-8888-888888888888", fy: "2026-27", source: "pre_go_live", months: 9, salaryMinor: "208285200", tdsMinor: "30470200", priorEmployerName: null, priorEmployerTan: null, note: "Legacy payroll Apr-Dec", status: "pending", decisionNote: null };

describe("EmployeeOpeningYtdCard", () => {
  const fetchMock = vi.fn();
  beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
  afterEach(() => vi.unstubAllGlobals());

  it("financial year label", () => {
    expect(financialYearOf(new Date(2027, 2, 31))).toBe("2026-27");
    expect(financialYearOf(new Date(2027, 3, 1))).toBe("2027-28");
  });

  it("the maker enters a pre-go-live opening: rupees become paise, months and note required", async () => {
    fetchMock.mockResolvedValueOnce(json({ data: [] })).mockResolvedValueOnce(json({ id: "x", status: "accepted" }, 202)).mockResolvedValueOnce(json({ data: [PENDING] }));
    render(<NextIntlClientProvider locale="en" messages={enMessages}><EmployeeOpeningYtdCard employeeId={EMP} canEnter canDecide={false} /></NextIntlClientProvider>);
    await screen.findByText(/no opening year-to-date recorded/i);
    fireEvent.click(screen.getByRole("button", { name: /add opening year-to-date/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/financial year/i), { target: { value: "2026-27" } });
    fireEvent.change(within(dialog).getByLabelText(/salary paid/i), { target: { value: "2082852" } });
    fireEvent.change(within(dialog).getByLabelText(/tds deducted/i), { target: { value: "304702" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /submit for approval/i }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/number of months covered/i);
    fireEvent.change(within(dialog).getByLabelText(/months covered/i), { target: { value: "9" } });
    fireEvent.change(within(dialog).getByLabelText(/note/i), { target: { value: "Legacy payroll Apr-Dec" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /submit for approval/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    const [url, init] = fetchMock.mock.calls[1]!;
    expect(url).toBe("/api/proxy/v1/payroll/opening-ytd");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ employeeId: EMP, fy: "2026-27", source: "pre_go_live", months: 9, salaryMinor: "208285200", tdsMinor: "30470200", note: "Legacy payroll Apr-Dec" });
    expect(await screen.findByText(/pending approval/i)).toBeInTheDocument();
  });

  it("delta review SF2: an approved record is corrected by a new version (prefilled, supersedesId)", async () => {
    const approved = { ...PENDING, status: "approved" };
    fetchMock.mockResolvedValueOnce(json({ data: [approved] })).mockResolvedValueOnce(json({ id: "y", status: "accepted" }, 202)).mockResolvedValueOnce(json({ data: [approved] }));
    render(<NextIntlClientProvider locale="en" messages={enMessages}><EmployeeOpeningYtdCard employeeId={EMP} canEnter canDecide={false} /></NextIntlClientProvider>);
    fireEvent.click(await screen.findByRole("button", { name: /correct 2026-27/i }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText(/tds deducted/i)).toHaveValue("304702.00");
    fireEvent.change(within(dialog).getByLabelText(/tds deducted/i), { target: { value: "300000" } });
    fireEvent.change(within(dialog).getByLabelText(/note/i), { target: { value: "Corrected per Q3 24Q statement" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /submit for approval/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(JSON.parse((fetchMock.mock.calls[1]![1] as RequestInit).body as string)).toMatchObject({ tdsMinor: "30000000", months: 9, supersedesId: PENDING.id, note: "Corrected per Q3 24Q statement" });
  });

  it("a checker approves a pending record with a note; the maker-checker refusal is explained (Hindi)", async () => {
    fetchMock.mockResolvedValueOnce(json({ data: [PENDING] })).mockResolvedValueOnce(json({ code: "MAKER_CHECKER_VIOLATION" }, 403));
    render(<NextIntlClientProvider locale="hi" messages={hiMessages}><EmployeeOpeningYtdCard employeeId={EMP} canEnter={false} canDecide /></NextIntlClientProvider>);
    const approve = await screen.findByRole("button", { name: /2026-27 अनुमोदित करें/ });
    fireEvent.change(screen.getByLabelText(/निर्णय टिप्पणी/), { target: { value: "Checked against 24Q" } });
    fireEvent.click(approve);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1]![0]).toBe(`/api/proxy/v1/payroll/opening-ytd/${PENDING.id}/approve`);
    expect(await screen.findByRole("alert")).toHaveTextContent(/दर्ज करने वाले अधिकारी के अलावा/);
  });
});
