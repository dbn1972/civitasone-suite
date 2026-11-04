import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }));

import { EmployeePensionSchemeCard, type SchemeChange } from "./EmployeePensionSchemeCard";

const EMP = "8cf7f7eb-1de6-4a31-b48c-1f598ecf33c0";
const m = enMessages.pensionSchemeChange;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const PENDING: SchemeChange = { id: "c1", fromScheme: "NPS", toScheme: "EPF", effectiveFrom: "2027-02-01", reason: "Contract staff are EPF members", status: "pending" };

type Call = { url: string; method: string; body: unknown };
let HISTORY: SchemeChange[] | null = [];
function mockApi(history: SchemeChange[], respond: (c: Call) => Response = () => json(201, { id: "new" })) {
  HISTORY = history;
  const calls: Call[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: String(input), method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(call);
    if (call.method === "GET") return json(200, { data: history });
    return respond(call);
  });
  return calls;
}
function renderCard(p: Partial<Parameters<typeof EmployeePensionSchemeCard>[0]> = {}, locale: "en" | "hi" = "en") {
  render(
    <NextIntlClientProvider locale={locale} messages={locale === "en" ? enMessages : hiMessages}>
      <EmployeePensionSchemeCard employeeId={EMP} currentScheme="NPS" canRequest canDecide={false} initialChanges={HISTORY} {...p} />
    </NextIntlClientProvider>,
  );
}

describe("EmployeePensionSchemeCard (UAT b18)", () => {
  beforeEach(() => { vi.restoreAllMocks(); refresh.mockReset(); });

  it("shows the current scheme and warns an EPF member without a UAN", async () => {
    mockApi([]);
    renderCard({ currentScheme: "EPF", incomplete: ["UAN_MISSING"] });
    expect(screen.getByText(m.schemes.EPF)).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent(m.uanMissingWarning);
  });

  it("requests a change: scheme, effective month (1st), reason and the UAN for EPF", async () => {
    const calls = mockApi([]);
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: m.changeButton }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent(m.dialogHelp);
    fireEvent.change(screen.getByLabelText(m.schemeLabel), { target: { value: "EPF" } });
    fireEvent.change(screen.getByLabelText(m.effectiveMonthLabel), { target: { value: "2027-02" } });
    fireEvent.change(screen.getByLabelText(m.reasonLabel), { target: { value: "Contract staff are EPF members (owner)" } });
    fireEvent.change(screen.getByLabelText(m.uanLabel), { target: { value: "100200300400" } });
    fireEvent.click(screen.getByRole("button", { name: m.submitButton }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(m.submitted));
    const post = calls.find((c) => c.method === "POST")!;
    expect(post.url).toBe(`/api/proxy/v1/hrms/employees/${EMP}/pension-scheme-changes`);
    expect(post.body).toEqual({ toScheme: "EPF", effectiveFrom: "2027-02-01", reason: "Contract staff are EPF members (owner)", uanNumber: "100200300400" });
  });

  it("the UAN field is only offered for EPF; short reason and bad UAN are caught before sending", async () => {
    const calls = mockApi([]);
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: m.changeButton }));
    fireEvent.change(screen.getByLabelText(m.schemeLabel), { target: { value: "UPS" } });
    expect(screen.queryByLabelText(m.uanLabel)).toBeNull();
    fireEvent.change(screen.getByLabelText(m.effectiveMonthLabel), { target: { value: "2027-02" } });
    fireEvent.change(screen.getByLabelText(m.reasonLabel), { target: { value: "short" } });
    fireEvent.click(screen.getByRole("button", { name: m.submitButton }));
    expect(await screen.findByRole("alert")).toHaveTextContent(m.error.REASON_REQUIRED);
    fireEvent.change(screen.getByLabelText(m.schemeLabel), { target: { value: "EPF" } });
    fireEvent.change(screen.getByLabelText(m.reasonLabel), { target: { value: "A long enough reason here" } });
    fireEvent.change(screen.getByLabelText(m.uanLabel), { target: { value: "1234" } });
    fireEvent.click(screen.getByRole("button", { name: m.submitButton }));
    expect(await screen.findByRole("alert")).toHaveTextContent(m.uanInvalid);
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
  });

  it("server errors are shown in plain words (UAN_REQUIRED), never the code", async () => {
    mockApi([], () => json(422, { code: "UAN_REQUIRED", message: "raw" }));
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: m.changeButton }));
    fireEvent.change(screen.getByLabelText(m.effectiveMonthLabel), { target: { value: "2027-02" } });
    fireEvent.change(screen.getByLabelText(m.reasonLabel), { target: { value: "A long enough reason here" } });
    fireEvent.click(screen.getByRole("button", { name: m.submitButton }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(m.error.UAN_REQUIRED);
    expect(alert.textContent).not.toContain("UAN_REQUIRED");
  });

  it("a change outside the eligibility matrix is explained in plain words (review SF5)", async () => {
    mockApi([], () => json(422, { code: "PENSION_SCHEME_NOT_ALLOWED", message: "raw" }));
    renderCard({ currentScheme: "EPF" });
    fireEvent.click(await screen.findByRole("button", { name: m.changeButton }));
    expect(screen.getByLabelText(m.schemeLabel)).not.toHaveValue("EPF"); // opens on another scheme
    fireEvent.change(screen.getByLabelText(m.effectiveMonthLabel), { target: { value: "2027-02" } });
    fireEvent.change(screen.getByLabelText(m.reasonLabel), { target: { value: "A long enough reason here" } });
    fireEvent.click(screen.getByRole("button", { name: m.submitButton }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(m.error.PENSION_SCHEME_NOT_ALLOWED);
    expect(alert.textContent).not.toContain("PENSION_SCHEME_NOT_ALLOWED");
  });

  it("an employee on no pension scheme is shown as such", () => {
    mockApi([]);
    renderCard({ currentScheme: "NONE" });
    expect(screen.getByText(m.schemes.NONE)).toBeInTheDocument();
  });

  it("an HR admin approves the pending change; the maker-checker refusal is explained", async () => {
    const calls = mockApi([PENDING], (c) => (c.url.endsWith("/approve") ? json(403, { code: "MAKER_CHECKER_VIOLATION" }) : json(200, {})));
    renderCard({ canDecide: true });
    expect(await screen.findByText(m.pendingTitle, { selector: "h3" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: m.changeButton })).toBeNull(); // one pending change at a time
    fireEvent.click(screen.getByRole("button", { name: m.approveButton }));
    expect(await screen.findByRole("alert")).toHaveTextContent(m.error.MAKER_CHECKER_VIOLATION);
    expect(calls.find((c) => c.method === "POST")!.url).toBe("/api/proxy/v1/hrms/pension-scheme-changes/c1/approve");
  });

  it("reject needs a note, then posts it", async () => {
    const calls = mockApi([PENDING], () => json(200, {}));
    renderCard({ canDecide: true });
    fireEvent.click(await screen.findByRole("button", { name: m.rejectButton }));
    expect(await screen.findByRole("alert")).toHaveTextContent(m.rejectNoteRequired);
    fireEvent.change(screen.getByLabelText(m.decisionNoteLabel), { target: { value: "Not eligible" } });
    fireEvent.click(screen.getByRole("button", { name: m.rejectButton }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(m.rejected));
    expect(calls.find((c) => c.method === "POST")).toMatchObject({ url: "/api/proxy/v1/hrms/pension-scheme-changes/c1/reject", body: { note: "Not eligible" } });
    expect(refresh).toHaveBeenCalled();
  });

  it("without the checker role there is no approve / reject", async () => {
    mockApi([PENDING]);
    renderCard({ canDecide: false });
    expect(await screen.findByText(m.pendingTitle, { selector: "h3" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: m.approveButton })).toBeNull();
  });

  it("the page-loaded history drives the card without a fetch on mount; a failed load is said so", async () => {
    const calls = mockApi([PENDING]);
    renderCard({ initialChanges: null });
    expect(screen.getByRole("alert")).toHaveTextContent(m.loadError);
    expect(calls).toHaveLength(0);
  });

  it("renders in Hindi", async () => {
    mockApi([]);
    renderCard({}, "hi");
    expect(screen.getByText(hiMessages.pensionSchemeChange.title)).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: hiMessages.pensionSchemeChange.changeButton })).toBeInTheDocument();
  });
});
