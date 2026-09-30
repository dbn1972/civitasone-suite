import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { AddEmployeeWizard } from "./AddEmployeeWizard";

const DEPARTMENTS = [{ id: "dep1", name: "Finance" }];
const DESIGNATIONS = [{ id: "des1", name: "Section Officer" }];

/**
 * UX-016: this used to show the raw backend `message` (falling back to
 * `Request failed (${res.status})`) verbatim — the same class of leak
 * useFormError closes fleet-wide (UX-003).
 */
describe("AddEmployeeWizard — UX-016 clerk-safe errors", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  async function driveToFinalStepAndSubmit() {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <AddEmployeeWizard departments={DEPARTMENTS} designations={DESIGNATIONS} />
      </NextIntlClientProvider>,
    );

    // Step 1 — Personal Info
    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: "Priya Sharma" } });
    fireEvent.click(screen.getByRole("button", { name: /next/i }));

    // Step 2 — Employment
    fireEvent.change(await screen.findByLabelText(/employee id/i), { target: { value: "NIC/2026/0001" } });
    fireEvent.change(screen.getByLabelText(/date of joining/i), { target: { value: "2026-01-01" } });
    fireEvent.change(screen.getByLabelText(/^department/i), { target: { value: "dep1" } });
    fireEvent.change(screen.getByLabelText(/^designation/i), { target: { value: "des1" } });
    fireEvent.click(screen.getByRole("button", { name: /next/i }));

    // Step 3 — Assignment (no required fields)
    await screen.findByText(/step 3 of/i);
    fireEvent.click(screen.getByRole("button", { name: /next/i }));

    // Step 4 — Statutory (no required fields)
    await screen.findByText(/step 4 of/i);
    fireEvent.click(screen.getByRole("button", { name: /next/i }));

    // Step 5 — Review & submit
    fireEvent.click(await screen.findByRole("button", { name: /create employee record/i }));
  }

  it("shows a clerk-safe message, never the raw HTTP status, when creation fails", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 500 }));
    await driveToFinalStepAndSubmit();

    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(alert).toHaveTextContent(/couldn't save/i));
    expect(alert.textContent).not.toMatch(/\b500\b/);
  });

  it("never surfaces a raw server error message on a JSON error body", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ message: "duplicate employeeNo" }), {
        status: 409,
        headers: { "content-type": "application/json" },
      }),
    );
    await driveToFinalStepAndSubmit();

    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(alert).toHaveTextContent(/couldn't save/i));
    expect(alert.textContent).not.toMatch(/duplicate employeeNo/);
  });
});

/**
 * GAP-HR-EMPLOYEES-NEW-03: the wizard autosaves its full in-progress state to
 * sessionStorage on every change (draft recovery). PAN, Aadhaar reference,
 * bank account number, and IFSC are sensitive statutory identifiers — they
 * must never land in that plaintext sessionStorage draft, even though the
 * rest of the wizard state (name, employee ID, department, ...) keeps
 * autosaving normally.
 */
describe("AddEmployeeWizard — GAP-HR-EMPLOYEES-NEW-03 draft never carries statutory identifiers", () => {
  const SESSION_KEY = "civitas-add-emp-draft";

  beforeEach(() => sessionStorage.clear());
  afterEach(() => sessionStorage.clear());

  async function fillToStep4WithStatutoryValues() {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <AddEmployeeWizard departments={DEPARTMENTS} designations={DESIGNATIONS} />
      </NextIntlClientProvider>,
    );

    // Step 1 — Personal Info
    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: "Priya Sharma" } });
    fireEvent.click(screen.getByRole("button", { name: /next/i }));

    // Step 2 — Employment
    fireEvent.change(await screen.findByLabelText(/employee id/i), { target: { value: "NIC/2026/0001" } });
    fireEvent.change(screen.getByLabelText(/date of joining/i), { target: { value: "2026-01-01" } });
    fireEvent.change(screen.getByLabelText(/^department/i), { target: { value: "dep1" } });
    fireEvent.change(screen.getByLabelText(/^designation/i), { target: { value: "des1" } });
    fireEvent.click(screen.getByRole("button", { name: /next/i }));

    // Step 3 — Assignment (no required fields)
    await screen.findByText(/step 3 of/i);
    fireEvent.click(screen.getByRole("button", { name: /next/i }));

    // Step 4 — Statutory: fill every sensitive field
    await screen.findByText(/step 4 of/i);
    fireEvent.change(screen.getByLabelText(/pan/i), { target: { value: "ABCDE1234F" } });
    fireEvent.change(screen.getByLabelText(/aadhaar/i), { target: { value: "XXXX XXXX 1234" } });
    fireEvent.change(screen.getByLabelText(/bank account/i), { target: { value: "123456789012" } });
    fireEvent.change(screen.getByLabelText(/ifsc/i), { target: { value: "SBIN0001234" } });
  }

  it("never writes PAN, Aadhaar reference, bank account, or IFSC into the sessionStorage draft", async () => {
    await fillToStep4WithStatutoryValues();

    await waitFor(() => expect(sessionStorage.getItem(SESSION_KEY)).not.toBeNull());
    const raw = sessionStorage.getItem(SESSION_KEY)!;

    // The raw values must be genuinely absent from the persisted string...
    expect(raw).not.toContain("ABCDE1234F");
    expect(raw).not.toContain("XXXX XXXX 1234");
    expect(raw).not.toContain("123456789012");
    expect(raw).not.toContain("SBIN0001234");

    // ...and the keys themselves must be absent, not merely blanked, so a
    // future field rename can't silently reintroduce the leak unnoticed.
    const parsed: Record<string, unknown> = JSON.parse(raw);
    expect(parsed).not.toHaveProperty("pan");
    expect(parsed).not.toHaveProperty("aadhaarRef");
    expect(parsed).not.toHaveProperty("bankAccountNo");
    expect(parsed).not.toHaveProperty("bankIfsc");
  });

  it("keeps autosaving every non-sensitive field normally", async () => {
    await fillToStep4WithStatutoryValues();

    await waitFor(() => expect(sessionStorage.getItem(SESSION_KEY)).not.toBeNull());
    const parsed = JSON.parse(sessionStorage.getItem(SESSION_KEY)!);

    expect(parsed.fullName).toBe("Priya Sharma");
    expect(parsed.employeeNo).toBe("NIC/2026/0001");
    expect(parsed.departmentId).toBe("dep1");
    expect(parsed.designationId).toBe("des1");
    expect(parsed.dateOfJoining).toBe("2026-01-01");
  });

  it("restores the excluded fields empty even from a legacy draft that still carries them", async () => {
    // Simulates a draft written before this fix (or otherwise tampered
    // with) that still carries raw statutory values. Restoring it today
    // must never surface them back into the form.
    sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({
        fullName: "Legacy Draft",
        employeeNo: "NIC/2026/9999",
        departmentId: "dep1",
        designationId: "des1",
        dateOfJoining: "2026-01-01",
        pan: "ZZZZZ0000Z",
        aadhaarRef: "1111 2222 3333",
        bankAccountNo: "999999999",
        bankIfsc: "HDFC0000001",
      }),
    );

    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <AddEmployeeWizard departments={DEPARTMENTS} designations={DESIGNATIONS} />
      </NextIntlClientProvider>,
    );

    await screen.findByText(/your in-progress draft has been restored/i);
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    await screen.findByText(/step 2 of/i);
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    await screen.findByText(/step 3 of/i);
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    await screen.findByText(/step 4 of/i);

    expect(screen.getByLabelText(/pan/i)).toHaveValue("");
    expect(screen.getByLabelText(/aadhaar/i)).toHaveValue("");
    expect(screen.getByLabelText(/bank account/i)).toHaveValue("");
    expect(screen.getByLabelText(/ifsc/i)).toHaveValue("");
  });
});

/**
 * GAP-HR-EMPLOYEES-NEW-01: PF/ESI/PT toggles are already derived from the
 * selected engagement type's policy server-side (engagement-policy.ts) --
 * a form toggle here could only ever silently disagree with, and never
 * actually override, that computed value. Removed from the wizard
 * entirely, per the published decision packet's own example for this item.
 */
describe("AddEmployeeWizard — GAP-HR-EMPLOYEES-NEW-01 PF/ESI/PT removed", () => {
  it("does not render PF / ESI / PT toggles anywhere in Step 4", async () => {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <AddEmployeeWizard departments={DEPARTMENTS} designations={DESIGNATIONS} />
      </NextIntlClientProvider>,
    );
    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: "Priya Sharma" } });
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    fireEvent.change(await screen.findByLabelText(/employee id/i), { target: { value: "NIC/2026/0001" } });
    fireEvent.change(screen.getByLabelText(/date of joining/i), { target: { value: "2026-01-01" } });
    fireEvent.change(screen.getByLabelText(/^department/i), { target: { value: "dep1" } });
    fireEvent.change(screen.getByLabelText(/^designation/i), { target: { value: "des1" } });
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    await screen.findByText(/step 3 of/i);
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    await screen.findByText(/step 4 of/i);

    expect(screen.queryByLabelText(/pf enrolled/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/esi opt-in/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/pt applicable/i)).not.toBeInTheDocument();
  });
});

/**
 * GAP-HR-EMPLOYEES-NEW-02: every new employee used to be created at
 * basicMinor 0 with no way to set it anywhere in this wizard.
 */
describe("AddEmployeeWizard — GAP-HR-EMPLOYEES-NEW-02 Basic Pay", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("converts a decimal Basic Pay to paise (no float rounding) in the create payload", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "uuid-1" }), { status: 202 }));
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <AddEmployeeWizard departments={DEPARTMENTS} designations={DESIGNATIONS} />
      </NextIntlClientProvider>,
    );
    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: "Priya Sharma" } });
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    fireEvent.change(await screen.findByLabelText(/employee id/i), { target: { value: "NIC/2026/0001" } });
    fireEvent.change(screen.getByLabelText(/date of joining/i), { target: { value: "2026-01-01" } });
    fireEvent.change(screen.getByLabelText(/^department/i), { target: { value: "dep1" } });
    fireEvent.change(screen.getByLabelText(/^designation/i), { target: { value: "des1" } });
    fireEvent.change(screen.getByLabelText(/basic pay/i), { target: { value: "44900.50" } });
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    await screen.findByText(/step 3 of/i);
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    await screen.findByText(/step 4 of/i);
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    fireEvent.click(await screen.findByRole("button", { name: /create employee record/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(body.basicMinor).toBe(4490050);
  });
});

/**
 * GAP-HR-EMPLOYEES-NEW-07: commands.createEmployee returns the database
 * uuid as `id` -- the success screen used to show that uuid labelled
 * "Employee ID", not the employeeNo HR actually typed, with a literal
 * "unknown" fallback whenever `id` happened to be absent.
 */
describe("AddEmployeeWizard — GAP-HR-EMPLOYEES-NEW-07 success screen", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  async function driveToFinalStepAndSubmit() {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <AddEmployeeWizard departments={DEPARTMENTS} designations={DESIGNATIONS} />
      </NextIntlClientProvider>,
    );
    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: "Priya Sharma" } });
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    fireEvent.change(await screen.findByLabelText(/employee id/i), { target: { value: "NIC/2026/0001" } });
    fireEvent.change(screen.getByLabelText(/date of joining/i), { target: { value: "2026-01-01" } });
    fireEvent.change(screen.getByLabelText(/^department/i), { target: { value: "dep1" } });
    fireEvent.change(screen.getByLabelText(/^designation/i), { target: { value: "des1" } });
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    await screen.findByText(/step 3 of/i);
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    await screen.findByText(/step 4 of/i);
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    fireEvent.click(await screen.findByRole("button", { name: /create employee record/i }));
  }

  it("shows the entered employeeNo (not the response uuid) as the Employee ID, and links to the new profile", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "aaaa-uuid" }), { status: 202 }));
    await driveToFinalStepAndSubmit();

    await screen.findByText(/created successfully/i);
    expect(screen.getByText("NIC/2026/0001")).toBeInTheDocument();
    expect(screen.queryByText("aaaa-uuid")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View employee →" })).toHaveAttribute("href", "/hr/employees/aaaa-uuid");
  });

  it("never renders the literal 'unknown' when the response has no id", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({}), { status: 202 }));
    await driveToFinalStepAndSubmit();

    await screen.findByText(/created successfully/i);
    expect(screen.queryByText(/unknown/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "View employee →" })).not.toBeInTheDocument();
  });
});

/** GAP-HR-EMPLOYEES-NEW-08 */
describe("AddEmployeeWizard — GAP-HR-EMPLOYEES-NEW-08 date-of-birth age check", () => {
  it("blocks a date of birth under 18 years old from advancing past Step 1", async () => {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <AddEmployeeWizard departments={DEPARTMENTS} designations={DESIGNATIONS} />
      </NextIntlClientProvider>,
    );
    const tenYearsAgo = new Date();
    tenYearsAgo.setFullYear(tenYearsAgo.getFullYear() - 10);
    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: "Priya Sharma" } });
    fireEvent.change(screen.getByLabelText(/date of birth/i), { target: { value: tenYearsAgo.toISOString().slice(0, 10) } });
    fireEvent.click(screen.getByRole("button", { name: /next/i }));

    expect(await screen.findByText(/at least 18 years old/i)).toBeInTheDocument();
    expect(screen.queryByText(/step 2 of/i)).not.toBeInTheDocument();
  });

  it("allows a date of birth over 18 years old to advance normally", async () => {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <AddEmployeeWizard departments={DEPARTMENTS} designations={DESIGNATIONS} />
      </NextIntlClientProvider>,
    );
    const thirtyYearsAgo = new Date();
    thirtyYearsAgo.setFullYear(thirtyYearsAgo.getFullYear() - 30);
    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: "Priya Sharma" } });
    fireEvent.change(screen.getByLabelText(/date of birth/i), { target: { value: thirtyYearsAgo.toISOString().slice(0, 10) } });
    fireEvent.click(screen.getByRole("button", { name: /next/i }));

    expect(await screen.findByText(/step 2 of/i)).toBeInTheDocument();
  });
});
