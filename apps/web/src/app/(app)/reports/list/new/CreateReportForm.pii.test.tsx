/**
 * UAT owner decision #17 (GAP-REPORTS-LIST-04): PII exports are masked by default;
 * only a report_admin sees the "export unmasked" control, and it needs a reason.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@/test-utils/intl-render";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock, refresh: vi.fn() }) }));

import { CreateReportForm } from "./CreateReportForm";

const ok = () => ({ ok: true, status: 202, headers: new Headers(), json: async () => ({}), text: async () => "{}" }) as unknown as Response;

describe("CreateReportForm PII export control (owner decision #17)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => { fetchMock = vi.fn().mockResolvedValue(ok()); vi.stubGlobal("fetch", fetchMock); pushMock.mockReset(); });
  afterEach(() => vi.unstubAllGlobals());

  it("tells everyone that personal data is masked by default", () => {
    render(<CreateReportForm />);
    expect(screen.getByText(/masked by default/i)).toBeInTheDocument();
  });

  it("hides the unmask control from non-report_admin users and never sends unmaskPii", async () => {
    render(<CreateReportForm />);
    expect(screen.queryByLabelText(/unmasked/i)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Report name *"), { target: { value: "Payroll" } });
    fireEvent.click(screen.getByRole("button", { name: "Queue report" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({ name: "Payroll" });
  });

  it("report_admin must give a reason before an unmasked export is queued", async () => {
    render(<CreateReportForm canUnmaskPii />);
    fireEvent.change(screen.getByLabelText("Report name *"), { target: { value: "Payroll" } });
    fireEvent.click(screen.getByLabelText(/unmasked/i));
    fireEvent.click(screen.getByRole("button", { name: "Queue report" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/reason/i);
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/Reason for unmasked export/i), { target: { value: "DPO-approved audit request 42" } });
    fireEvent.click(screen.getByRole("button", { name: "Queue report" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toMatchObject({
      name: "Payroll", unmaskPii: true, unmaskReason: "DPO-approved audit request 42",
    });
  });
});
