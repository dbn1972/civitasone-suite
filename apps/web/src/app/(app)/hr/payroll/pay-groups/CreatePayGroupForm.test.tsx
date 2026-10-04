import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { CreatePayGroupForm, isValidTimeZone } from "./CreatePayGroupForm";

// UX-017: CreatePayGroupForm now reads its copy through next-intl
// (useTranslations("createPayGroupForm")), so every render needs a real
// provider in the tree -- same pattern as off-cycle/CreateOffCycleForm.test.tsx.
function renderForm() {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <CreatePayGroupForm />
    </NextIntlClientProvider>,
  );
}

describe("CreatePayGroupForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("requires a name before opening the confirm dialog", () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Create Pay Group" }));
    expect(screen.getByText("Pay group name is required.")).toBeInTheDocument();
  });

  it("creates a pay group on confirm (happy path)", async () => {
    // The real API answers 202 with a command acknowledgement and no group
    // body; reading res.data.name used to throw after a successful create.
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "pg1", status: "accepted", correlationId: "c1" }), { status: 202 }),
    );

    renderForm();
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "Weekly Wage Staff" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Pay Group" }));

    await waitFor(() => expect(screen.getByText("Create this pay group?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Create pay group"));

    await waitFor(() => {
      expect(screen.getByText(/Pay group "Weekly Wage Staff" created\./)).toBeInTheDocument();
    });
    expect(refreshMock).toHaveBeenCalled();
    const body = JSON.parse(String((fetchSpy.mock.calls[0][1] as RequestInit).body));
    expect(body.timezone).toBe("Asia/Kolkata");
  });

  it("offers timezones from a list and validates IANA names (PAY-GROUPS-04)", () => {
    renderForm();
    expect((screen.getByLabelText(/Timezone/) as HTMLElement).tagName).toBe("SELECT");
    expect(isValidTimeZone("Asia/Kolkata")).toBe(true);
    expect(isValidTimeZone("Mars/Base")).toBe(false);
  });

  it("shows a pay-day control that follows the frequency (PAY-GROUPS-01)", () => {
    renderForm();
    expect(screen.getByText(/pay falls on its last day/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Pay Day of Month/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Frequency/), { target: { value: "weekly" } });
    expect(screen.queryByLabelText(/Pay Day of Month/)).not.toBeInTheDocument();
    expect((screen.getByLabelText(/Pay weekday/) as HTMLElement).tagName).toBe("SELECT");
    fireEvent.change(screen.getByLabelText(/Frequency/), { target: { value: "bi_weekly" } });
    expect(screen.getByLabelText(/Which weeks/)).toBeInTheDocument();
  });

  it("a weekly group needs a weekday and sends it (without a day-of-month)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 202 }));
    renderForm();
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "Wage" } });
    fireEvent.change(screen.getByLabelText(/Frequency/), { target: { value: "weekly" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Pay Group" }));
    expect(screen.getByText("Choose the weekday this group is paid on.")).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/Pay weekday/), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Pay Group" }));
    await waitFor(() => expect(screen.getByText("Create this pay group?")).toBeInTheDocument());
    expect(screen.getByText(/paid every Friday/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Create pay group"));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const body = JSON.parse(String((fetchSpy.mock.calls[0]![1] as RequestInit).body));
    expect(body).toMatchObject({ frequency: "weekly", payWeekday: 5, payWeekParity: null, payLastDay: false });
    expect(body.payDayOfMonth).toBeUndefined();
  });

  it("a bi-weekly group also needs which weeks", () => {
    renderForm();
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "Alt" } });
    fireEvent.change(screen.getByLabelText(/Frequency/), { target: { value: "bi_weekly" } });
    fireEvent.change(screen.getByLabelText(/Pay weekday/), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Pay Group" }));
    expect(screen.getByText("Choose which weeks a bi-weekly group is paid.")).toBeInTheDocument();
  });

  it("a monthly group can be paid on the last day of the month", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 202 }));
    renderForm();
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "Month end" } });
    fireEvent.click(screen.getByLabelText(/last day of the month/));
    fireEvent.click(screen.getByRole("button", { name: "Create Pay Group" }));
    await waitFor(() => expect(screen.getByText("Create this pay group?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Create pay group"));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    expect(JSON.parse(String((fetchSpy.mock.calls[0]![1] as RequestInit).body))).toMatchObject({ frequency: "monthly", payLastDay: true, payWeekday: null });
  });

  it("edit mode PATCHes the pay group with the full schedule (PAY-GROUPS-03)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 202 }));
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <CreatePayGroupForm editing={{ id: "g1", name: "Wage", frequency: "weekly", payDayOfMonth: 28, payWeekday: 5, payLastDay: false, payWeekParity: null, timezone: "Asia/Kolkata" }} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText("Edit pay group Wage")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Pay weekday/), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: "Update Pay Group" }));
    await waitFor(() => expect(screen.getByText("Update this pay group?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Update pay group"));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toContain("v1/payroll/pay-groups/g1");
    expect((init as RequestInit).method).toBe("PATCH");
    expect(JSON.parse(String((init as RequestInit).body))).toMatchObject({ name: "Wage", frequency: "weekly", payWeekday: 4 });
  });

  it("surfaces a clerk-safe error on the confirm dialog, never the server's raw code/status (error path) (UX-020)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 409 }));

    renderForm();
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "Duplicate Group" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Pay Group" }));

    await waitFor(() => expect(screen.getByText("Create this pay group?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Create pay group"));

    await waitFor(() => {
      expect(screen.getByText(/couldn't save your pay group/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/API_ERROR: 409/)).not.toBeInTheDocument();
  });
});

describe("CreatePayGroupForm DDO + bill type (PAY-GROUPS-03)", () => {
  const DDOS = [
    { ddoCode: "DDO-1", name: "Finance DDO" },
    { ddoCode: "DDO-2", name: "Works DDO" },
  ];

  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  function renderWith(props: React.ComponentProps<typeof CreatePayGroupForm>) {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <CreatePayGroupForm {...props} />
      </NextIntlClientProvider>,
    );
  }

  async function submitAndGetBody(spy: { mock: { calls: unknown[][] } }, label: string, confirm: string, confirmLabel: string) {
    fireEvent.click(screen.getByRole("button", { name: label }));
    await waitFor(() => expect(screen.getByText(confirm)).toBeInTheDocument());
    fireEvent.click(screen.getByText(confirmLabel));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    return JSON.parse(String((spy.mock.calls[0][1] as RequestInit).body));
  }

  it("lists only the DDOs it is given, optional, plus the bill types by translated name", () => {
    renderWith({ ddos: DDOS });
    const ddo = screen.getByLabelText("DDO") as HTMLSelectElement;
    expect([...ddo.options].map((o) => o.textContent)).toEqual(["No DDO", "Finance DDO (DDO-1)", "Works DDO (DDO-2)"]);
    const bill = screen.getByLabelText("Bill type") as HTMLSelectElement;
    expect([...bill.options].map((o) => o.textContent)).toEqual(["Gazetted", "Non-gazetted", "Contract", "Casual", "Other"]);
  });

  it("sends the chosen ddoCode and billType on create", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: "pg1" }), { status: 202 }));
    renderWith({ ddos: DDOS });
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "Gazetted Staff" } });
    fireEvent.change(screen.getByLabelText("DDO"), { target: { value: "DDO-2" } });
    fireEvent.change(screen.getByLabelText("Bill type"), { target: { value: "gazetted" } });
    const body = await submitAndGetBody(spy, "Create Pay Group", "Create this pay group?", "Create pay group");
    expect(body.ddoCode).toBe("DDO-2");
    expect(body.billType).toBe("gazetted");
  });

  it("omits ddoCode on create when no DDO is chosen", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: "pg1" }), { status: 202 }));
    renderWith({ ddos: DDOS });
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "Plain Group" } });
    const body = await submitAndGetBody(spy, "Create Pay Group", "Create this pay group?", "Create pay group");
    expect("ddoCode" in body).toBe(false);
  });

  it("edit sends null to clear the DDO, and the stored bill type", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: "pg1" }), { status: 202 }));
    renderWith({
      ddos: DDOS,
      editing: {
        id: "pg1", name: "Staff", frequency: "monthly", payDayOfMonth: 28, payWeekday: null, payLastDay: false,
        payWeekParity: null, timezone: "Asia/Kolkata", ddoCode: "DDO-1", billType: "contract",
      },
    });
    expect((screen.getByLabelText("DDO") as HTMLSelectElement).value).toBe("DDO-1");
    expect((screen.getByLabelText("Bill type") as HTMLSelectElement).value).toBe("contract");
    fireEvent.change(screen.getByLabelText("DDO"), { target: { value: "" } });
    const body = await submitAndGetBody(spy, "Update Pay Group", "Update this pay group?", "Update pay group");
    expect(body.ddoCode).toBeNull();
    expect(body.billType).toBe("contract");
  });

  it("keeps an already-linked but now inactive DDO selectable by code", () => {
    renderWith({
      ddos: DDOS,
      editing: {
        id: "pg1", name: "Staff", frequency: "monthly", payDayOfMonth: 28, payWeekday: null, payLastDay: false,
        payWeekParity: null, timezone: "Asia/Kolkata", ddoCode: "OLD-9", billType: "other",
      },
    });
    expect([...(screen.getByLabelText("DDO") as HTMLSelectElement).options].map((o) => o.value)).toContain("OLD-9");
  });

  it("disables the DDO field and leaves it out of the request when DDOs could not be loaded", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: "pg1" }), { status: 202 }));
    renderWith({
      ddosUnavailable: true,
      editing: {
        id: "pg1", name: "Staff", frequency: "monthly", payDayOfMonth: 28, payWeekday: null, payLastDay: false,
        payWeekParity: null, timezone: "Asia/Kolkata", ddoCode: "DDO-1", billType: "other",
      },
    });
    expect(screen.getByLabelText("DDO")).toBeDisabled();
    const body = await submitAndGetBody(spy, "Update Pay Group", "Update this pay group?", "Update pay group");
    expect("ddoCode" in body).toBe(false);
  });

  it("explains DDO_INACTIVE in plain words", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ code: "DDO_INACTIVE", message: "x" }), { status: 409, headers: { "content-type": "application/json" } }),
    );
    renderWith({ ddos: DDOS });
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "G" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Pay Group" }));
    await waitFor(() => expect(screen.getByText("Create this pay group?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Create pay group"));
    expect(await screen.findByText("That DDO is inactive. Pick an active DDO.")).toBeInTheDocument();
  });
});
