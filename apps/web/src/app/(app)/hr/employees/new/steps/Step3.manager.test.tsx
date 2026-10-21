import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { Step3 } from "./Step3";
import { WIZARD_INIT } from "../wizardTypes";

// Real entity adapter here (Step3.test.tsx mocks it); only fetch is stubbed.
vi.mock("@/lib/entityAdapters/costCenter", () => ({ searchCostCenters: vi.fn(async () => []), resolveCostCenters: vi.fn(async () => []) }));
vi.mock("@/lib/entityAdapters/location", () => ({ searchLocations: vi.fn(async () => []), resolveLocations: vi.fn(async () => []) }));

const ROWS = [
  { id: "e-asha", employeeNo: "S-002", name: "Asha Sharma", department: "Finance", designation: "Section Officer", status: "confirmed" },
  { id: "e-zoya", employeeNo: "S-001", name: "Zoya Sharma", department: "Finance", designation: "Under Secretary", status: "probation" },
  { id: "e-rohit", employeeNo: "S-003", name: "Rohit Sharma", department: "Finance", designation: "Section Officer", status: "separated" },
  { id: "e-vik", employeeNo: "S-005", name: "Vikram Sharma", department: "Finance", designation: "Director", status: "retired" },
  { id: "e-dee", employeeNo: "S-006", name: "Deepa Sharma", department: "Finance", designation: "Director", status: "on_leave" },
];

/** GAP-HR-EMPLOYEES-NEW-04 */
describe("Step3 reporting manager picker (GAP-HR-EMPLOYEES-NEW-04)", () => {
  afterEach(() => vi.unstubAllGlobals());

  function renderStep() {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: ROWS }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const onChange = vi.fn();
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <Step3 data={WIZARD_INIT} errors={{}} onChange={onChange} onBlur={() => undefined} />
      </NextIntlClientProvider>,
    );
    const input = screen.getAllByRole("combobox").find((el) => (el as HTMLInputElement).placeholder === enMessages.employeeWizard.selectManagerSearchPlaceholder)!;
    return { fetchMock, onChange, input };
  }

  it("searches the directory by what is typed (no preloaded 200-row list) and does not send the ignored role=manager param", async () => {
    const { fetchMock, input } = renderStep();
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "sharma" } });
    await screen.findByText("Asha Sharma (S-002)");
    const url = String((fetchMock.mock.calls[0] as unknown[])[0]);
    // HR cluster 01 (GAP-HR-EMPLOYEES-DETAIL-EDIT-05) also sends the exited-status exclusion to the server
    // so the 20-row page is never spent on people who cannot be chosen; the typed query stays q=sharma.
    expect(url).toBe("/api/proxy/v1/hrms/employees?q=sharma&limit=20&excludeStatuses=terminated,separated,retired");
    expect(url).not.toContain("role=manager");
  });

  it("each option shows the name AND the designation (plus department)", async () => {
    const { input } = renderStep();
    fireEvent.change(input, { target: { value: "sharma" } });
    expect(await screen.findByText("Asha Sharma (S-002)")).toBeInTheDocument();
    expect(screen.getByText("Section Officer · Finance")).toBeInTheDocument();
    expect(screen.getByText("Under Secretary · Finance")).toBeInTheDocument();
  });

  it("does not offer people who have left for good, but keeps on_leave and probation people pickable", async () => {
    const { input } = renderStep();
    fireEvent.change(input, { target: { value: "sharma" } });
    await screen.findByText("Asha Sharma (S-002)");
    expect(screen.queryByText("Rohit Sharma (S-003)")).not.toBeInTheDocument(); // separated
    expect(screen.queryByText("Vikram Sharma (S-005)")).not.toBeInTheDocument(); // retired
    expect(screen.getByText("Deepa Sharma (S-006)")).toBeInTheDocument(); // on_leave stays
    expect(screen.getByText("Zoya Sharma (S-001)")).toBeInTheDocument(); // probation stays
  });

  it("never auto-picks a manager: nothing is selected until the user chooses, then the chosen id is reported", async () => {
    const { input, onChange } = renderStep();
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "sharma" } });
    fireEvent.mouseDown(await screen.findByText("Zoya Sharma (S-001)"));
    expect(onChange).toHaveBeenCalledWith("managerId", "e-zoya");
  });
});
