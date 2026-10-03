import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
}));
const rolesMock = vi.fn(() => ["payroll_officer"]);
vi.mock("@/lib/auth/roleGuard", async (io) => ({
  ...(await io<typeof import("@/lib/auth/roleGuard")>()),
  getSessionRoles: () => rolesMock(),
}));

import PensionerDetailPage from "./page";

const DETAIL = {
  id: "11111111-1111-4111-8111-111111111111",
  ppoNo: "••••0123", ppoNoMasked: true, fullName: "Ramesh Sharma", dateOfBirth: "1958-01-01",
  basicPensionMinor: 2500050, commutedPensionMinor: 0, commutationDate: null, medicalAllowanceMinor: 100000,
  ddoCode: "DDO-1", taxRegime: "new", status: "active",
  bankAccountMasked: "•••• 9012", bankIfsc: "SBIN0001234", panMasked: "ABCDE****F",
  statusReason: null, dateOfDeath: null,
};

async function renderPage(data: unknown = DETAIL, extra: Record<string, unknown> = {}) {
  fetchJsonMock.mockResolvedValue({ data, source: "api", ...extra });
  const ui = await PensionerDetailPage({ params: { id: DETAIL.id } });
  render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
}

describe("PensionerDetailPage (GAP-PAYROLL-PENSIONERS-03/04)", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchJsonMock.mockReset();
    fetchMock.mockReset();
    refreshMock.mockReset();
    rolesMock.mockReturnValue(["payroll_officer"]);
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("shows masked identifiers by default, never the full values", async () => {
    await renderPage();
    expect(screen.getByText("Ramesh Sharma")).toBeInTheDocument();
    expect(screen.getByTestId("value-ppoNo")).toHaveTextContent("••••0123");
    expect(screen.getByTestId("value-bankAccountNo")).toHaveTextContent("•••• 9012");
    expect(screen.getByTestId("value-pan")).toHaveTextContent("ABCDE****F");
  });

  it("an audited reveal needs a reason, posts it, then shows the value", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ field: "pan", value: "ABCDE1234F" }), { status: 200 }));
    await renderPage();
    const revealButtons = screen.getAllByRole("button", { name: "Reveal" });
    fireEvent.click(revealButtons[2]!); // PAN is the third identifier
    await screen.findByText("Reveal this identifier?");
    const confirm = () => { const b = screen.getAllByRole("button", { name: "Reveal" }); return b[b.length - 1] as HTMLButtonElement; };
    fireEvent.change(screen.getByLabelText("Reason (recorded in the audit log)"), { target: { value: "short" } });
    expect(confirm().disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Reason (recorded in the audit log)"), { target: { value: "Verify PAN for Form 16" } });
    fireEvent.click(confirm());
    await waitFor(() => expect(screen.getByTestId("value-pan")).toHaveTextContent("ABCDE1234F"));
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain(`v1/payroll/pensioners/${DETAIL.id}/reveal`);
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ field: "pan", reason: "Verify PAN for Form 16" });
    fireEvent.click(screen.getByRole("button", { name: "Hide" }));
    expect(screen.getByTestId("value-pan")).toHaveTextContent("ABCDE****F");
  });

  it("a read-only role (hr_admin) sees no Reveal buttons and no status actions", async () => {
    rolesMock.mockReturnValue(["hr_admin"]);
    await renderPage();
    expect(screen.queryByRole("button", { name: "Reveal" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Stop pension" })).not.toBeInTheDocument();
    expect(screen.getByText("ABCDE****F")).toBeInTheDocument();
  });

  it("marks a pensioner deceased only with a reason and a date of death", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 202 }));
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Mark deceased" }));
    await screen.findByText("Mark this pensioner as deceased?");
    fireEvent.change(screen.getByLabelText("Reason (recorded in the audit log)"), { target: { value: "Death certificate received" } });
    const confirm = () => { const b = screen.getAllByRole("button", { name: "Mark deceased" }); return b[b.length - 1] as HTMLButtonElement; };
    expect(confirm().disabled).toBe(true); // no date yet
    fireEvent.change(screen.getByLabelText("Date of death"), { target: { value: "2026-09-01" } });
    expect(confirm().disabled).toBe(false);
    fireEvent.click(confirm());
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain(`v1/payroll/pensioners/${DETAIL.id}/status`);
    expect((init as RequestInit).method).toBe("PATCH");
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ status: "deceased", reason: "Death certificate received", dateOfDeath: "2026-09-01" });
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("stopping a pension needs only a reason; a 409 reads as a plain stale-state sentence", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ code: "INVALID_STATE", message: "a stopped pensioner cannot be marked stopped" }), { status: 409 }));
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Stop pension" }));
    await screen.findByText("Stop this pension?");
    fireEvent.change(screen.getByLabelText("Reason (recorded in the audit log)"), { target: { value: "Life certificate not filed" } });
    const b = screen.getAllByRole("button", { name: "Stop pension" });
    fireEvent.click(b[b.length - 1]!);
    await waitFor(() => expect(screen.getByText(/status has changed since the page loaded/)).toBeInTheDocument());
    expect(screen.queryByText(/cannot be marked stopped/)).not.toBeInTheDocument();
  });

  it("a deceased pensioner has no status actions and shows the date of death", async () => {
    await renderPage({ ...DETAIL, status: "deceased", dateOfDeath: "2026-09-01", statusReason: "Death certificate received" });
    expect(screen.queryByRole("button", { name: "Stop pension" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mark deceased" })).not.toBeInTheDocument();
    expect(screen.getByText("Death certificate received")).toBeInTheDocument();
  });

  it("denies roles outside the payroll readers without fetching", async () => {
    rolesMock.mockReturnValue(["employee"]);
    const ui = await PensionerDetailPage({ params: { id: DETAIL.id } });
    render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
    expect(fetchJsonMock).not.toHaveBeenCalled();
    expect(screen.getByText("Access restricted")).toBeInTheDocument();
  });

  it("a 404 from the API is a real not-found, not a generic load error", async () => {
    fetchJsonMock.mockResolvedValue({ data: null, source: "error", status: 404 });
    await expect(PensionerDetailPage({ params: { id: DETAIL.id } })).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
