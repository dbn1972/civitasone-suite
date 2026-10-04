import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";
import { RunWarningsPanel } from "./RunWarningsPanel";

const fetchMock = vi.fn();
const ok = (warnings: unknown[]) => new Response(JSON.stringify({ runId: "r1", warnings }), { status: 200 });
function renderPanel(messages: Record<string, unknown> = enMessages) {
  return render(<NextIntlClientProvider locale="en" messages={messages}><RunWarningsPanel runId="r1" /></NextIntlClientProvider>);
}

describe("RunWarningsPanel", () => {
  beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
  afterEach(() => vi.unstubAllGlobals());

  it("shows a loading state first, then the empty state (distinct from an error)", async () => {
    fetchMock.mockResolvedValue(ok([]));
    renderPanel();
    expect(screen.getByText("Loading run warnings…")).toBeInTheDocument();
    expect(await screen.findByText(/No warnings/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(String(fetchMock.mock.calls[0]![0])).toContain("/api/proxy/v1/payroll/runs/r1/warnings");
  });

  it("a failed load is an error state with a retry, never 'no warnings'", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 500 }));
    renderPanel();
    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't load/i);
    expect(screen.queryByText(/No warnings/)).not.toBeInTheDocument();
    fetchMock.mockResolvedValueOnce(ok([]));
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText(/No warnings/)).toBeInTheDocument();
  });

  it("a malformed payload is an error, not an empty list", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ nope: true }), { status: 200 }));
    renderPanel();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("lists each warning with copy, and links PT state / gender to the affected employees' edit pages", async () => {
    fetchMock.mockResolvedValue(ok([
      { code: "PT_STATE_UNKNOWN", count: 3, sample: [{ employeeId: "e1", employeeNo: "E-001" }, { employeeId: "e2", employeeNo: "E-002" }] },
      { code: "PT_GENDER_UNKNOWN", count: 1, sample: [{ employeeId: "e3", employeeNo: "E-003" }] },
      { code: "HRA_FLOOR_NOT_CONFIGURED", count: 0, sample: [] },
    ]));
    renderPanel();
    expect(await screen.findByText("Professional tax state not set")).toBeInTheDocument();
    expect(screen.getByText(/3 employees have no state of employment/)).toBeInTheDocument();
    expect(screen.getByText(/1 employee has no usable gender/)).toBeInTheDocument();
    expect(screen.getByText("HRA minimum floor not configured")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Employee E-001" })).toHaveAttribute("href", "/hr/employees/e1/edit");
    expect(screen.getByRole("link", { name: "Employee E-003" })).toHaveAttribute("href", "/hr/employees/e3/edit");
    expect(screen.getByText("Showing 2 of 3. Open an employee to fix it:")).toBeInTheDocument();
    // HRA floor has no employees to link
    expect(screen.getAllByRole("link")).toHaveLength(3);
  });

  it("an unknown code is shown generically rather than dropped", async () => {
    fetchMock.mockResolvedValue(ok([{ code: "SOMETHING_NEW", count: 2, sample: [] }]));
    renderPanel();
    expect(await screen.findByText("Run warning")).toBeInTheDocument();
    expect(screen.getByText(/SOMETHING_NEW/)).toBeInTheDocument();
  });

  it("has Hindi copy for every known code", async () => {
    fetchMock.mockResolvedValue(ok([{ code: "PT_STATE_UNKNOWN", count: 1, sample: [] }, { code: "PT_GENDER_UNKNOWN", count: 1, sample: [] }, { code: "HRA_FLOOR_NOT_CONFIGURED", count: 0, sample: [] }]));
    renderPanel(hiMessages);
    expect(await screen.findByText("व्यावसायिक कर का राज्य दर्ज नहीं")).toBeInTheDocument();
    expect(screen.getByText("HRA न्यूनतम सीमा तय नहीं")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("चेतावनियां")).toBeInTheDocument());
  });
});
