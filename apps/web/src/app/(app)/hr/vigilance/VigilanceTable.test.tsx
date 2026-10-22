import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, fireEvent, within, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { VigilanceTable, type VigilanceRow } from "./VigilanceTable";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push }) }));

function render(ui: React.ReactElement) {
  return rtlRender(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
}

const CASE_ID = "8cf7f7eb-1de6-4a31-b48c-1f598ecf33c0";
const ROW: VigilanceRow = {
  id: CASE_ID, caseRef: "VC/1", employee: "Alpha Officer", department: "Revenue",
  hasCharges: true, inquiryOfficer: "R. Menon", nextHearing: "2026-01-20", status: "inquiry_appointed",
};
const LABELS = {
  caseRef: "Case Ref", employee: "Employee", department: "Department", charges: "Charge Summary",
  inquiryOfficer: "Inquiry Officer", inquiryOfficerAppointed: "Inquiry Officer Appointed", status: "Status",
  noCharges: "—", emptyTitle: "None", emptyMessage: "None here", caption: "Register",
};
const CHARGE_TEXT = "Took an unauthorised payment from a contractor";

beforeEach(() => {
  vi.restoreAllMocks();
  push.mockClear();
});

// GAP-HR-VIGILANCE-01 acceptance: "charge summary is masked until reveal is clicked".
describe("VigilanceTable charge summary (GAP-HR-VIGILANCE-01)", () => {
  it("is masked until Reveal is used; the clear text is fetched through the audited route only after a reason is given", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { value: CHARGE_TEXT } }), { status: 200 }),
    );
    const { container } = render(<VigilanceTable rows={[ROW]} labels={LABELS} />);

    // Masked, and nothing fetched, on first paint.
    expect(container.textContent).toContain("••••••••");
    expect(container.textContent).not.toContain(CHARGE_TEXT);
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Reveal" }));
    // Opening the dialog still reveals nothing and fetches nothing.
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.change(await screen.findByLabelText(/Reason for revealing/i), { target: { value: "Preparing the hearing brief" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Reveal" }).pop()!);

    expect(await screen.findByText(CHARGE_TEXT)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/proxy/v1/hrms/vigilance/${CASE_ID}/charges/reveal`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toMatchObject({
      resourceType: "disciplinary_case", resourceId: CASE_ID, field: "charges_summary", reason: "Preparing the hearing brief",
    });

    // Hide re-masks it.
    fireEvent.click(screen.getByRole("button", { name: "Hide" }));
    await waitFor(() => expect(screen.queryByText(CHARGE_TEXT)).not.toBeInTheDocument());
  });

  it("will not reveal without a reason of at least 10 characters", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    render(<VigilanceTable rows={[ROW]} labels={LABELS} />);
    fireEvent.click(screen.getByRole("button", { name: "Reveal" }));
    fireEvent.change(await screen.findByLabelText(/Reason for revealing/i), { target: { value: "too short" } });
    const confirm = screen.getAllByRole("button", { name: "Reveal" }).pop()!;
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a refused reveal (403) keeps the text masked and shows a plain message", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ code: "FORBIDDEN" }), { status: 403 }));
    const { container } = render(<VigilanceTable rows={[ROW]} labels={LABELS} />);
    fireEvent.click(screen.getByRole("button", { name: "Reveal" }));
    fireEvent.change(await screen.findByLabelText(/Reason for revealing/i), { target: { value: "Preparing the hearing brief" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Reveal" }).pop()!);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).not.toMatch(/FORBIDDEN|403/);
    expect(container.textContent).not.toContain(CHARGE_TEXT);
  });

  it("a case with no charge text shows a dash and offers no Reveal", () => {
    render(<VigilanceTable rows={[{ ...ROW, hasCharges: false }]} labels={LABELS} />);
    expect(screen.queryByRole("button", { name: "Reveal" })).not.toBeInTheDocument();
  });

  it("each row links to the shared case page with ?from=vigilance", () => {
    render(<VigilanceTable rows={[ROW]} labels={LABELS} />);
    expect(screen.getByRole("link", { name: "Open VC/1" })).toHaveAttribute("href", `/hr/disciplinary/${CASE_ID}?from=vigilance`);
    expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(2);
  });

  it("using Reveal (button, reason dialog, confirm) never also navigates to the case page via the row click", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: { value: CHARGE_TEXT } }), { status: 200 }));
    render(<VigilanceTable rows={[ROW]} labels={LABELS} />);
    fireEvent.click(screen.getByRole("button", { name: "Reveal" }));
    fireEvent.change(await screen.findByLabelText(/Reason for revealing/i), { target: { value: "Preparing the hearing brief" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Reveal" }).pop()!);
    await screen.findByText(CHARGE_TEXT);
    fireEvent.click(screen.getByRole("button", { name: "Hide" }));
    expect(push).not.toHaveBeenCalled();
    // ...while clicking elsewhere on the row still opens the case.
    fireEvent.click(screen.getByText("Alpha Officer"));
    expect(push).toHaveBeenCalledWith(`/hr/disciplinary/${CASE_ID}?from=vigilance`);
  });
});
