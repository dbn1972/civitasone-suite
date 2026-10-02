import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { PolicyForm, safeMinorNumber } from "./PolicyForm";

// GAP-ASSETS-INSURANCE-03: the asset is chosen through a server-searched picker,
// so every test that submits has to type, wait for the option and click it.
function mockApi(extra?: (url: string, init?: RequestInit) => Response | undefined) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    const custom = extra?.(url, init as RequestInit | undefined);
    if (custom) return custom;
    if (url.includes("/assets/assets?search=")) {
      return new Response(JSON.stringify({ data: [{ id: "a1", assetCode: "AST-001", name: "Server Rack" }] }), { status: 200 });
    }
    return new Response(JSON.stringify({ id: "policy-1", status: "accepted", correlationId: "c1" }), { status: 202 });
  });
}

async function pickAsset() {
  fireEvent.change(screen.getByLabelText(/^Asset/), { target: { value: "Server" } });
  fireEvent.mouseDown(await screen.findByRole("option", { name: /AST-001/ }, { timeout: 3000 }));
}

function posts(spy: ReturnType<typeof mockApi>) {
  return spy.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "POST");
}

function fillRest(over: Partial<Record<"coverage" | "premium" | "start" | "end" | "policyNo", string>> = {}) {
  fireEvent.change(screen.getByLabelText(/^Policy Number/), { target: { value: over.policyNo ?? "POL-2026-001" } });
  fireEvent.change(screen.getByLabelText(/^Insurer/), { target: { value: "National Insurance Co" } });
  fireEvent.change(screen.getByLabelText(/^Sum Insured/), { target: { value: over.coverage ?? "500000" } });
  fireEvent.change(screen.getByLabelText(/^Premium/), { target: { value: over.premium ?? "12500" } });
  fireEvent.change(screen.getByLabelText(/^Start Date/), { target: { value: over.start ?? "2026-04-01" } });
  fireEvent.change(screen.getByLabelText(/^End Date/), { target: { value: over.end ?? "2027-03-31" } });
}

const submitBtn = () => screen.getByRole("button", { name: "Create insurance policy" });

describe("PolicyForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("requires all fields before submitting and focuses the first invalid field", () => {
    render(<PolicyForm />);
    fireEvent.click(submitBtn());

    expect(screen.getByText("Select the asset this policy covers.")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Asset/)).toHaveFocus();
  });

  it("creates a policy on submit (happy path) and omits the renewal reminder when left blank", async () => {
    const spy = mockApi();
    render(<PolicyForm />);
    await pickAsset();
    fillRest();
    fireEvent.click(submitBtn());

    // GAP-ASSETS-INSURANCE-01: confirm first, showing the amounts being sent.
    await waitFor(() => expect(screen.getByText("Create this insurance policy?")).toBeInTheDocument());
    expect(posts(spy)).toHaveLength(0);
    expect(screen.getByText("₹5,00,000.00")).toBeInTheDocument();
    expect(screen.getByText("₹12,500.00")).toBeInTheDocument();
    expect(screen.getByText("AST-001 · Server Rack")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Create policy" }));

    await waitFor(() => {
      expect(screen.getByText(/Policy POL-2026-001 submitted for/)).toBeInTheDocument();
    });
    expect(screen.queryByText(/policy-1/)).not.toBeInTheDocument();
    expect(refreshMock).toHaveBeenCalled();

    const body = JSON.parse((posts(spy)[0]![1] as RequestInit).body as string);
    expect(body.assetId).toBe("a1");
    // Money guard: rupees input must be converted via rupeesToMinorString, never raw *100.
    expect(body.coverageMinor).toBe(50000000);
    expect(body.premiumMinor).toBe(1250000);
    expect(body).not.toHaveProperty("renewalReminderDays");
  });

  // GAP-ASSETS-INSURANCE-06
  it("sends renewalReminderDays when entered", async () => {
    const spy = mockApi();
    render(<PolicyForm />);
    await pickAsset();
    fillRest();
    fireEvent.change(screen.getByLabelText(/^Renewal reminder/), { target: { value: "45" } });
    fireEvent.click(submitBtn());
    await waitFor(() => expect(screen.getByText("Create this insurance policy?")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Create policy" }));
    await waitFor(() => expect(posts(spy)).toHaveLength(1));
    expect(JSON.parse((posts(spy)[0]![1] as RequestInit).body as string).renewalReminderDays).toBe(45);
  });

  it("rejects a renewal reminder outside 1-365 or non-integer", async () => {
    mockApi();
    render(<PolicyForm />);
    await pickAsset();
    fillRest();
    for (const bad of ["0", "366", "1.5", "abc"]) {
      fireEvent.change(screen.getByLabelText(/^Renewal reminder/), { target: { value: bad } });
      fireEvent.click(submitBtn());
      expect(screen.getByText(/whole number of days between 1 and 365/)).toBeInTheDocument();
      expect(screen.queryByText("Create this insurance policy?")).not.toBeInTheDocument();
    }
  });

  // GAP-ASSETS-INSURANCE-07
  it("refuses an amount beyond safe-integer paise instead of silently rounding it", async () => {
    const spy = mockApi();
    render(<PolicyForm />);
    await pickAsset();
    fillRest({ coverage: "99999999999999999" });
    fireEvent.click(submitBtn());
    expect(screen.getByText("That sum insured is too large to submit.")).toBeInTheDocument();
    expect(screen.queryByText("Create this insurance policy?")).not.toBeInTheDocument();
    expect(posts(spy)).toHaveLength(0);
  });

  it("safeMinorNumber is exact for normal amounts and null above 2^53", () => {
    expect(safeMinorNumber("50000000")).toBe(50000000);
    expect(safeMinorNumber("9007199254740993")).toBeNull();
  });

  it("is disabled, with the reason shown, when asked to be (assets failed to load)", () => {
    render(<PolicyForm disabledReason="Couldn't load assets, so a policy can't be created right now." />);
    expect(submitBtn()).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent(/Couldn't load assets/);
  });

  it("rejects an end date on/before the start date via the custom validator", async () => {
    mockApi();
    render(<PolicyForm />);
    await pickAsset();
    fillRest({ end: "2026-04-01" });
    fireEvent.click(submitBtn());

    expect(screen.getByText("End date must be after the start date.")).toBeInTheDocument();
  });

  it("surfaces a clerk-safe message on submit, never a raw status code (UX-020)", async () => {
    mockApi((_url, init) => (init?.method === "POST" ? new Response(null, { status: 500 }) : undefined));

    render(<PolicyForm />);
    await pickAsset();
    fillRest();

    fireEvent.click(submitBtn());
    await waitFor(() => expect(screen.getByText("Create this insurance policy?")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Create policy" }));

    await waitFor(() => {
      expect(screen.getByText(/couldn't save/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/API_ERROR/)).not.toBeInTheDocument();
  });

  it("Cancel closes the confirm dialog without posting and keeps the entered values", async () => {
    const spy = mockApi();
    render(<PolicyForm />);
    await pickAsset();
    fillRest({ policyNo: "POL-9", coverage: "1000", premium: "10" });
    fireEvent.click(submitBtn());
    await waitFor(() => expect(screen.getByText("Create this insurance policy?")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByText("Create this insurance policy?")).not.toBeInTheDocument());
    expect(posts(spy)).toHaveLength(0);
    expect(screen.getByLabelText(/^Policy Number/)).toHaveValue("POL-9");
  });
});
