import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import NewAdvancePage from "./page";

// UX-017 (tranche 10): NewAdvancePage is a "use client" component that now
// calls useTranslations() -- the centralized vitest.setup.ts mock only covers
// next-intl/server's getTranslations (server components), so a direct render
// of a client component still needs a real NextIntlClientProvider, same as
// every other client-component test (hr/leave/apply/ApplyLeaveForm.test.tsx,
// finance/pfms/page.test.tsx precedent).
function renderPage(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

// GAP-FINANCE-EXPENDITURE-ADVANCES-NEW-03: the payee is PICKED. An officer advance searches the payroll employee lookup,
// a vendor advance searches the finance vendor master; only an "other" party is typed.
const EMP = { id: "11111111-1111-4111-8111-111111111111", employeeNo: "E-1001", name: "R. Sharma", department: "Finance" };
const EMP_LABEL = "R. Sharma (E-1001)";
const VENDOR = { id: "22222222-2222-4222-8222-222222222222", name: "Acme Traders", category: "supplies", status: "active" };
const DORMANT = { id: "33333333-3333-4333-8333-333333333333", name: "Acme Dormant", category: "supplies", status: "inactive" };

/** Routes the picker lookups and the create call; `post` decides the answer to POST /v1/finance/advances. */
function mockApi(post: () => Response = () => new Response(null, { status: 202 }), lookups: { employees?: () => Response } = {}) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    const u = String(url);
    if (u.includes("/payroll/employee-lookup")) return lookups.employees?.() ?? new Response(JSON.stringify({ data: [EMP] }), { status: 200 });
    if (u.endsWith("/finance/vendors")) return new Response(JSON.stringify({ data: [VENDOR, DORMANT] }), { status: 200 });
    if (init?.method === "POST") return post();
    return new Response("{}", { status: 404 });
  });
}
const posts = (m: { mock: { calls: unknown[][] } }) => m.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "POST");
const postBody = (m: { mock: { calls: unknown[][] } }) => JSON.parse((posts(m)[0]![1] as RequestInit).body as string);

const payeeInput = () => screen.getByLabelText(/^Payee/);

async function pickEmployee() {
  fireEvent.change(payeeInput(), { target: { value: "sharma" } });
  fireEvent.mouseDown(await screen.findByText(EMP_LABEL));
  await screen.findByDisplayValue(EMP_LABEL);
}
async function pickVendor() {
  fireEvent.change(screen.getByLabelText("Advance type"), { target: { value: "vendor" } });
  fireEvent.change(payeeInput(), { target: { value: "acme" } });
  fireEvent.mouseDown(await screen.findByText("Acme Traders"));
  await screen.findByDisplayValue("Acme Traders");
}

/** The common fields; the payee is picked separately (default type: officer / employee). */
function fillCommon() {
  fireEvent.change(screen.getByLabelText("Advance number"), { target: { value: "ADV-001" } });
  fireEvent.change(screen.getByLabelText("Amount (₹)"), { target: { value: "1000" } });
  fireEvent.change(screen.getByLabelText("Purpose"), { target: { value: "Tour advance" } });
  fireEvent.change(screen.getByLabelText("Sanctioning authority"), { target: { value: "Under Secretary (Finance)" } });
}
async function fillForm() {
  fillCommon();
  await pickEmployee();
}

/** The confirm dialog now captures the reason (GAP-FINANCE-EXPENDITURE-ADVANCES-NEW-01). */
async function confirmWithReason(reason = "Sanctioned vide order 12/2031") {
  fireEvent.change(await screen.findByLabelText("Reason for this advance"), { target: { value: reason } });
  fireEvent.click(screen.getByRole("button", { name: "Issue advance" }));
}

describe("NewAdvancePage", () => {
  beforeEach(() => {
    refreshMock.mockReset();
    vi.restoreAllMocks();
  });

  it("submits an advance (happy path, 202 accepted)", async () => {
    const fetchMock = mockApi();

    renderPage(<NewAdvancePage />);
    await fillForm();
    fireEvent.click(screen.getByRole("button", { name: /create advance/i }));
    await confirmWithReason();

    await waitFor(() => expect(screen.getByText("Advance recorded.")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/proxy/v1/finance/advances",
      expect.objectContaining({ method: "POST" }),
    );
  });

  // UX-016: the shared `parseErrorMessage` helper used to build the message
  // from the backend's own `message`/`error` field, or (when the body
  // wasn't JSON) the RAW response text verbatim, falling back to a literal
  // `Request failed (${res.status})` -- the same class of leak
  // useFormError/toHumanError closes fleet-wide (UX-003).
  it("shows a clerk-safe message when submission fails, never the raw status or backend text", async () => {
    mockApi(() => new Response(JSON.stringify({ message: "insufficient_budget: head 2110 is over budget" }), { status: 422 }));

    renderPage(<NewAdvancePage />);
    await fillForm();
    fireEvent.click(screen.getByRole("button", { name: /create advance/i }));
    await confirmWithReason();

    const alert = await screen.findByText(/Some details weren't accepted\. Check what you entered and try again\./);
    expect(alert.textContent).not.toMatch(/insufficient_budget/i);
    expect(alert.textContent).not.toMatch(/\b422\b/);
  });

  // GAP-FINANCE-EXPENDITURE-ADVANCES-NEW-01
  it("asks for confirmation (with the amount) before POSTing; cancel sends nothing", async () => {
    const fetchMock = mockApi();
    renderPage(<NewAdvancePage />);
    await fillForm();
    fireEvent.click(screen.getByRole("button", { name: /create advance/i }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("₹1,000.00");
    // the dialog names who the money goes to: the picked officer
    expect(dialog).toHaveTextContent(EMP_LABEL);
    expect(posts(fetchMock)).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(posts(fetchMock)).toHaveLength(0);
  });

  it("sends an x-idempotency-key and a float-free paise string; double-confirm sends ONE request", async () => {
    const fetchMock = mockApi();
    renderPage(<NewAdvancePage />);
    await fillForm();
    fireEvent.change(screen.getByLabelText("Amount (₹)"), { target: { value: "1.15" } });
    fireEvent.click(screen.getByRole("button", { name: /create advance/i }));
    fireEvent.change(await screen.findByLabelText("Reason for this advance"), { target: { value: "Sanctioned vide order 12/2031" } });
    const confirm = screen.getByRole("button", { name: "Issue advance" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() => expect(posts(fetchMock)).toHaveLength(1));
    const [, init] = posts(fetchMock)[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["x-idempotency-key"]).toMatch(/^[0-9a-f-]{36}$/);
    // 1.15 * 100 === 114.99999999999999 in floats; must be exactly 115 paise.
    expect(JSON.parse(init.body as string).amountMinor).toBe("115");
  });

  it("rejects a sub-paise amount with a field error and makes no request", async () => {
    const fetchMock = mockApi();
    renderPage(<NewAdvancePage />);
    await fillForm();
    fireEvent.change(screen.getByLabelText("Amount (₹)"), { target: { value: "10.005" } });
    fireEvent.click(screen.getByRole("button", { name: /create advance/i }));
    expect(await screen.findByText(/at most 2 decimals/i)).toBeInTheDocument();
    expect(posts(fetchMock)).toHaveLength(0);
  });

  // GAP-FINANCE-EXPENDITURE-ADVANCES-NEW-01: authority + reason are captured and sent
  it("keeps Issue disabled until a reason is typed, then sends sanctionAuthority and reason", async () => {
    const fetchMock = mockApi();
    renderPage(<NewAdvancePage />);
    await fillForm();
    fireEvent.click(screen.getByRole("button", { name: /create advance/i }));
    const issue = await screen.findByRole("button", { name: "Issue advance" });
    expect(issue).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Reason for this advance"), { target: { value: "abc" } }); // under 5 chars
    expect(issue).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Reason for this advance"), { target: { value: "  Sanctioned vide order 12/2031  " } });
    expect(issue).not.toBeDisabled();
    fireEvent.click(issue);
    await waitFor(() => expect(posts(fetchMock)).toHaveLength(1));
    expect(postBody(fetchMock)).toMatchObject({
      sanctionAuthority: "Under Secretary (Finance)", reason: "Sanctioned vide order 12/2031",
    });
  });

  it("blocks submission without a sanctioning authority and sends nothing", async () => {
    const fetchMock = mockApi();
    renderPage(<NewAdvancePage />);
    await fillForm();
    fireEvent.change(screen.getByLabelText("Sanctioning authority"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /create advance/i }));
    expect(await screen.findByText("Name the sanctioning authority.")).toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(posts(fetchMock)).toHaveLength(0);
    expect(screen.getByLabelText("Sanctioning authority")).toBeRequired();
  });

  // GAP-FINANCE-EXPENDITURE-ADVANCES-NEW-03
  it("blocks submission without a picked payee and sends nothing", async () => {
    const fetchMock = mockApi();
    renderPage(<NewAdvancePage />);
    fillCommon();
    fireEvent.click(screen.getByRole("button", { name: /create advance/i }));
    expect(await screen.findByText("Pick the officer or vendor from the list.")).toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(posts(fetchMock)).toHaveLength(0);
    expect(payeeInput()).toBeRequired();
  });

  it("typing a name into the officer picker without choosing a result is still not a payee", async () => {
    const fetchMock = mockApi();
    renderPage(<NewAdvancePage />);
    fillCommon();
    fireEvent.change(payeeInput(), { target: { value: "R. Sharma" } });
    fireEvent.click(screen.getByRole("button", { name: /create advance/i }));
    expect(await screen.findByText("Pick the officer or vendor from the list.")).toBeInTheDocument();
    expect(posts(fetchMock)).toHaveLength(0);
  });

  it("picking an officer sends the employee ID as payeeId, with the picked name as the display payee", async () => {
    const fetchMock = mockApi();
    renderPage(<NewAdvancePage />);
    await fillForm();
    fireEvent.click(screen.getByRole("button", { name: /create advance/i }));
    await confirmWithReason();
    await waitFor(() => expect(posts(fetchMock)).toHaveLength(1));
    expect(postBody(fetchMock)).toMatchObject({ type: "employee", payee: EMP_LABEL, payeeId: EMP.id, purpose: "Tour advance" });
    // the officer search went to the payroll lookup the finance officer is allowed to use, not the HR directory
    const urls = fetchMock.mock.calls.map(([u]) => String(u));
    expect(urls.some((u) => u.includes("/api/proxy/v1/payroll/employee-lookup?q=sharma"))).toBe(true);
    expect(urls.some((u) => u.includes("/hrms/employees"))).toBe(false);
  });

  it("picking a vendor sends the vendor ID as payeeId; only ACTIVE vendors are offered", async () => {
    const fetchMock = mockApi();
    renderPage(<NewAdvancePage />);
    fillCommon();
    fireEvent.change(screen.getByLabelText("Advance type"), { target: { value: "vendor" } });
    fireEvent.change(payeeInput(), { target: { value: "acme" } });
    expect(await screen.findByText("Acme Traders")).toBeInTheDocument();
    expect(screen.queryByText("Acme Dormant")).not.toBeInTheDocument();
    fireEvent.mouseDown(screen.getByText("Acme Traders"));
    await screen.findByDisplayValue("Acme Traders");
    fireEvent.click(screen.getByRole("button", { name: /create advance/i }));
    await confirmWithReason();
    await waitFor(() => expect(posts(fetchMock)).toHaveLength(1));
    expect(postBody(fetchMock)).toMatchObject({ type: "vendor", payee: "Acme Traders", payeeId: VENDOR.id });
  });

  it("an 'other' party is typed (trimmed) and sends NO id", async () => {
    const fetchMock = mockApi();
    renderPage(<NewAdvancePage />);
    fillCommon();
    fireEvent.change(screen.getByLabelText("Advance type"), { target: { value: "other" } });
    fireEvent.change(payeeInput(), { target: { value: "  Gram Panchayat Rampur  " } });
    fireEvent.click(screen.getByRole("button", { name: /create advance/i }));
    await confirmWithReason();
    await waitFor(() => expect(posts(fetchMock)).toHaveLength(1));
    const body = postBody(fetchMock);
    expect(body).toMatchObject({ type: "other", payee: "Gram Panchayat Rampur" });
    expect(body).not.toHaveProperty("payeeId");
  });

  it("an 'other' party still cannot be blank", async () => {
    const fetchMock = mockApi();
    renderPage(<NewAdvancePage />);
    fillCommon();
    fireEvent.change(screen.getByLabelText("Advance type"), { target: { value: "other" } });
    fireEvent.click(screen.getByRole("button", { name: /create advance/i }));
    expect(await screen.findByText(/name of the officer or party/i)).toBeInTheDocument();
    expect(posts(fetchMock)).toHaveLength(0);
  });

  it("changing the advance type drops the chosen payee: a vendor id is never sent as an officer advance (or vice versa)", async () => {
    const fetchMock = mockApi();
    renderPage(<NewAdvancePage />);
    await fillForm();
    fireEvent.change(screen.getByLabelText("Advance type"), { target: { value: "vendor" } });
    expect(payeeInput()).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: /create advance/i }));
    expect(await screen.findByText("Pick the officer or vendor from the list.")).toBeInTheDocument();
    expect(posts(fetchMock)).toHaveLength(0);
  });

  it("a failed officer lookup says so (it is not 'no matches')", async () => {
    mockApi(undefined, { employees: () => new Response("", { status: 500 }) });
    renderPage(<NewAdvancePage />);
    fireEvent.change(payeeInput(), { target: { value: "sharma" } });
    expect(await screen.findByText(/Could not load employees/)).toBeInTheDocument();
    expect(screen.queryByText("No matching employees")).not.toBeInTheDocument();
  });

  it("shows the server's payeeId refusal (e.g. a deactivated vendor) under the payee", async () => {
    mockApi(() => new Response(JSON.stringify({
      code: "VENDOR_INACTIVE", message: "vendor is deactivated",
      fieldErrors: [{ field: "payeeId", message: "This vendor is deactivated. Pick an active vendor." }],
    }), { status: 409 }));
    renderPage(<NewAdvancePage />);
    fillCommon();
    await pickVendor();
    fireEvent.click(screen.getByRole("button", { name: /create advance/i }));
    await confirmWithReason();
    expect(await screen.findByText("This vendor is deactivated. Pick an active vendor.")).toBeInTheDocument();
  });

  it("documents the DPDP purpose in the payee help text", async () => {
    mockApi();
    renderPage(<NewAdvancePage />);
    expect(screen.getByText(/used only to issue and recover this advance/i)).toBeInTheDocument();
    expect(screen.getByText(/masked for roles not authorised/i)).toBeInTheDocument();
  });

  // GAP-FINANCE-EXPENDITURE-ADVANCES-NEW-06: the API's `type` enum used to be
  // omitted, so every advance was stored as "employee".
  it("sends the chosen advance type", async () => {
    const fetchMock = mockApi();
    renderPage(<NewAdvancePage />);
    fillCommon();
    await pickVendor();
    fireEvent.click(screen.getByRole("button", { name: /create advance/i }));
    await confirmWithReason();
    await waitFor(() => expect(posts(fetchMock)).toHaveLength(1));
    expect(postBody(fetchMock)).toMatchObject({ type: "vendor", payee: "Acme Traders", purpose: "Tour advance" });
  });

  // GAP-FINANCE-EXPENDITURE-ADVANCES-NEW-04: exponent / negative forms are rejected.
  it("rejects exponent and negative amounts", async () => {
    const fetchMock = mockApi();
    renderPage(<NewAdvancePage />);
    await fillForm();
    for (const bad of ["1e3", "-5", "0"]) {
      fireEvent.change(screen.getByLabelText("Amount (₹)"), { target: { value: bad } });
      fireEvent.click(screen.getByRole("button", { name: /create advance/i }));
      expect(await screen.findByText(/at most 2 decimals/i)).toBeInTheDocument();
    }
    expect(posts(fetchMock)).toHaveLength(0);
  });

  // GAP-FINANCE-EXPENDITURE-ADVANCES-NEW-02: a duplicate number surfaces inline.
  it("shows the server's duplicate-number message inline on the Advance number field", async () => {
    mockApi(() => new Response(
      JSON.stringify({ code: "DUPLICATE_ADVANCE_NO", message: "x", fieldErrors: [{ field: "advanceNo", message: "This advance number is already in use. Enter a different number." }] }),
      { status: 409 },
    ));
    renderPage(<NewAdvancePage />);
    await fillForm();
    fireEvent.click(screen.getByRole("button", { name: /create advance/i }));
    await confirmWithReason();
    expect(await screen.findByText(/already in use/i)).toBeInTheDocument();
  });

  // GAP-FINANCE-EXPENDITURE-ADVANCES-NEW-05
  it("a 403 tells the officer they lack permission, not to try again", async () => {
    mockApi(() => new Response("Forbidden", { status: 403 }));
    renderPage(<NewAdvancePage />);
    await fillForm();
    fireEvent.click(screen.getByRole("button", { name: /create advance/i }));
    await confirmWithReason();
    const alert = await screen.findByText(/don't have permission/i);
    expect(alert.textContent).not.toMatch(/try again/i);
  });
});
