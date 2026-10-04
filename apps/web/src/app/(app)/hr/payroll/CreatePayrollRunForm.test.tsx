import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const mockPush = vi.fn();
const mockRefresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
}));

const toastSuccess = vi.fn();
vi.mock("@/app/_components/ds/Toast", () => ({
  useToast: () => ({ toast: { success: toastSuccess } }),
}));

vi.mock("@/lib/activation", () => ({ trackActivation: vi.fn() }));

vi.mock("../../../_components/ds", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../_components/ds")>();
  return {
    ...actual,
    ConfirmDialog: ({
    open,
    errorMessage,
    onConfirm,
  }: {
    open: boolean;
    errorMessage?: string;
    onConfirm: () => void;
  }) =>
    open ? (
      <div>
        {errorMessage ? <p role="alert">{errorMessage}</p> : null}
        <button onClick={onConfirm}>Confirm create run</button>
      </div>
    ) : null,
  };
});

import { CreatePayrollRunForm } from "./CreatePayrollRunForm";

const STRUCTURES = [{ id: "s1", name: "Standard Grade Pay" }];

// UX-017: CreatePayrollRunForm now reads its copy through next-intl
// (useTranslations("createPayrollRunForm")), so every render needs a real
// provider in the tree -- same pattern as
// off-cycle/CreateOffCycleForm.test.tsx.
function fillAndOpenDialog() {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <CreatePayrollRunForm structures={STRUCTURES} />
    </NextIntlClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Create Run" }));
}

describe("CreatePayrollRunForm — server error handling (UX-003)", () => {
  beforeEach(() => {
    mockPush.mockReset();
    mockRefresh.mockReset();
    toastSuccess.mockReset();
    vi.restoreAllMocks();
  });

  it("renders inline field-level messages from a fieldErrors response, not just a raw error string", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          code: "VALIDATION_FAILED",
          message: "validation_failed",
          fieldErrors: [{ field: "runNo", message: "A run with this number already exists." }],
        }),
        { status: 409, headers: { "content-type": "application/json" } },
      ),
    );

    fillAndOpenDialog();
    fireEvent.click(screen.getByRole("button", { name: "Confirm create run" }));

    expect(
      await screen.findByText("A run with this number already exists."),
    ).toBeInTheDocument();
  });

  it("never surfaces a raw HTTP status code or raw server error text in the confirm dialog", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Internal Server Error\n at Object.<anonymous> (/srv/payroll.js:20:4)", {
        status: 500,
        headers: { "content-type": "text/plain" },
      }),
    );

    fillAndOpenDialog();
    fireEvent.click(screen.getByRole("button", { name: "Confirm create run" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).not.toMatch(/\b500\b/);
    expect(alert.textContent).not.toMatch(/Internal Server Error/);
    expect(alert.textContent).not.toMatch(/at Object\.<anonymous>/);
    // Regression: this form used to build `Create failed (${res.status})` directly.
    expect(alert.textContent).not.toMatch(/Create failed \(/);
  });

  it("still creates the run and redirects on success", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "run-1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    fillAndOpenDialog();
    fireEvent.click(screen.getByRole("button", { name: "Confirm create run" }));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/hr/payroll/run-1"));
  });
});

// GAP-PAYROLL-PAY-GROUPS-03: "Run for" picker -- whole tenant (legacy), pay groups, or a DDO.
describe("CreatePayrollRunForm — Run for picker", () => {
  const GROUPS = [
    { id: "g1", name: "Monthly Staff" },
    { id: "g2", name: "Contract Staff" },
  ];
  const DDOS = [{ ddoCode: "DDO-1", name: "Finance DDO" }];

  beforeEach(() => {
    mockPush.mockReset();
    mockRefresh.mockReset();
    toastSuccess.mockReset();
    vi.restoreAllMocks();
  });

  function renderForm(existingPeriods: string[] = []) {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <CreatePayrollRunForm structures={STRUCTURES} existingPeriods={existingPeriods} payGroups={GROUPS} ddos={DDOS} />
      </NextIntlClientProvider>,
    );
  }
  function pickScope(label: string) {
    fireEvent.change(screen.getByRole("combobox", { name: "Run for" }), { target: { value: label } });
  }
  async function create() {
    fireEvent.click(screen.getByRole("button", { name: "Create Run" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm create run" }));
  }
  function sentBody(spy: { mock: { calls: unknown[][] } }) {
    return JSON.parse(String((spy.mock.calls[0][1] as RequestInit).body));
  }
  function ok(body: unknown) {
    return new Response(JSON.stringify(body), { status: 202, headers: { "content-type": "application/json" } });
  }

  it("defaults to the whole tenant and sends the unchanged legacy payload", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(ok({ id: "run-1" }));
    renderForm();
    expect((screen.getByRole("combobox", { name: "Run for" }) as HTMLSelectElement).value).toBe("tenant");
    await create();
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/hr/payroll/run-1"));
    expect(Object.keys(sentBody(spy)).sort()).toEqual(["month", "runNo", "structureId"]);
  });

  it("sends payGroupId for one selected group and goes straight to that run", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(ok({ id: "c1", data: { runIds: ["run-7"] } }));
    renderForm();
    pickScope("groups");
    fireEvent.click(screen.getByLabelText("Monthly Staff"));
    await create();
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/hr/payroll/run-7"));
    const body = sentBody(spy);
    expect(body.payGroupId).toBe("g1");
    expect("payGroupIds" in body).toBe(false);
  });

  it("sends payGroupIds for several groups and lists every created run, naming skipped empty groups", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(ok({ id: "c1", data: { runIds: ["run-1", "run-2"], skippedEmptyGroups: ["g2"] } }));
    renderForm();
    pickScope("groups");
    fireEvent.click(screen.getByLabelText("Monthly Staff"));
    fireEvent.click(screen.getByLabelText("Contract Staff"));
    await create();
    expect(await screen.findByText("2 payroll runs created.")).toBeInTheDocument();
    expect(sentBody(spy).payGroupIds).toEqual(["g1", "g2"]);
    expect(screen.getByRole("link", { name: "Open run 1" })).toHaveAttribute("href", "/hr/payroll/run-1");
    expect(screen.getByRole("link", { name: "Open run 2" })).toHaveAttribute("href", "/hr/payroll/run-2");
    expect(screen.getByText("Skipped (no employees this month): Contract Staff")).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("sends ddoCode + allPayGroupsOfDdo for a DDO run", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(ok({ id: "c1", data: { runIds: ["run-1", "run-2"] } }));
    renderForm();
    pickScope("ddo");
    fireEvent.change(screen.getByRole("combobox", { name: "DDO" }), { target: { value: "DDO-1" } });
    await create();
    await screen.findByText("2 payroll runs created.");
    const body = sentBody(spy);
    expect(body.ddoCode).toBe("DDO-1");
    expect(body.allPayGroupsOfDdo).toBe(true);
  });

  it("blocks submit with a message when no group / no DDO is chosen", () => {
    const spy = vi.spyOn(globalThis, "fetch");
    renderForm();
    pickScope("groups");
    fireEvent.click(screen.getByRole("button", { name: "Create Run" }));
    expect(screen.getByText("Select at least one pay group.")).toBeInTheDocument();
    pickScope("ddo");
    fireEvent.click(screen.getByRole("button", { name: "Create Run" }));
    expect(screen.getByText("Select a DDO.")).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });

  it("does not block a pay-group run just because another run exists for the month", () => {
    const now = new Date();
    renderForm([`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`]);
    expect(screen.getByRole("button", { name: "Create Run" })).toBeDisabled();
    pickScope("groups");
    expect(screen.getByRole("button", { name: "Create Run" })).toBeEnabled();
  });

  it.each([
    ["EMPLOYEE_ALREADY_IN_RUN", 409, "already in another payroll run"],
    ["PAY_GROUP_EMPTY", 422, "has no employees for this month"],
    ["NO_ACTIVE_PAY_GROUPS", 422, "no active pay groups"],
    ["DDO_INACTIVE", 409, "DDO is inactive"],
    ["DUPLICATE_RUN_FOR_PERIOD", 409, "run already exists"],
  ])("explains %s in plain words, never the code", async (code, status, fragment) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ code, message: `${code}: raw` }), { status, headers: { "content-type": "application/json" } }),
    );
    renderForm();
    pickScope("groups");
    fireEvent.click(screen.getByLabelText("Monthly Staff"));
    await create();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(fragment);
    expect(alert.textContent).not.toContain(code);
  });
});
