import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const browserJsonMock = vi.fn();
vi.mock("@/lib/api/browserClient", () => ({
  browserJson: (...args: unknown[]) => browserJsonMock(...args),
}));
const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { AllotmentDetailActions } from "./AllotmentDetailActions";

const BASE_PROPS = {
  allotmentId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  version: 1,
  quarterNo: "B-14",
  employeeRef: "cccccccc-cccc-cccc-cccc-cccccccccccc",
  employeeName: "Kiran Bose",
  monthlyLicenceFeeMinor: "150000",
  licenceFeeSource: "api" as const,
  canAct: true,
  isApplicant: false,
};

describe("AllotmentDetailActions", () => {
  beforeEach(() => {
    browserJsonMock.mockReset();
    refreshMock.mockReset();
    vi.useRealTimers();
  });

  it("allots the quarter on confirm (happy path) and surfaces the licence fee", async () => {
    browserJsonMock.mockResolvedValue({ status: "accepted" });
    render(<AllotmentDetailActions {...BASE_PROPS} status="applied" />);

    fireEvent.click(screen.getByRole("button", { name: "Allot quarter" }));
    expect(await screen.findByText(/Monthly licence fee on occupation/)).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Allot quarter" })[1]);

    await waitFor(() => expect(browserJsonMock).toHaveBeenCalledWith(
      "v1/estab/quarter-allotments/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/allot",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ version: 1 }) }),
    ));
  });

  // GAP-ESTAB-QUARTERS-ALLOTMENTS-DETAIL-03: identify by name, not UUID
  it("shows the employee name (not the raw UUID) in the dialog", async () => {
    render(<AllotmentDetailActions {...BASE_PROPS} status="applied" />);
    fireEvent.click(screen.getByRole("button", { name: "Allot quarter" }));
    expect(await screen.findByText("Kiran Bose")).toBeInTheDocument();
  });

  it("surfaces the server's maker-checker violation code on failure", async () => {
    browserJsonMock.mockRejectedValue(
      new Error("MAKER_CHECKER_VIOLATION: allotment approver cannot be the applicant"),
    );
    render(<AllotmentDetailActions {...BASE_PROPS} status="applied" />);

    fireEvent.click(screen.getByRole("button", { name: "Allot quarter" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Allot quarter" })[1]);

    expect(
      await screen.findByText("MAKER_CHECKER_VIOLATION: allotment approver cannot be the applicant"),
    ).toBeInTheDocument();
  });

  // GAP-ESTAB-QUARTERS-ALLOTMENTS-DETAIL-04: non-admins see status only
  it("shows no lifecycle actions when the viewer cannot act", () => {
    render(<AllotmentDetailActions {...BASE_PROPS} status="applied" canAct={false} />);
    expect(screen.getByText(/Only estate officers and admins/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Allot quarter" })).not.toBeInTheDocument();
  });

  // GAP-ESTAB-QUARTERS-ALLOTMENTS-DETAIL-01: applicant cannot allot own application
  it("disables Allot and warns when the session user is the applicant", () => {
    render(<AllotmentDetailActions {...BASE_PROPS} status="applied" isApplicant />);
    expect(screen.getByText(/cannot allot a quarter you applied for/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Allot quarter" })).toBeDisabled();
  });

  it("shows no transitions for a vacated allotment", () => {
    render(<AllotmentDetailActions {...BASE_PROPS} status="vacated" />);
    expect(screen.getByText(/final state/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Allot quarter" })).not.toBeInTheDocument();
  });

  // GAP-ESTAB-QUARTERS-ALLOTMENTS-DETAIL-05: reject applied application via cancel
  it("rejects an applied application with a required reason via the cancel endpoint", async () => {
    browserJsonMock.mockResolvedValue({ status: "accepted" });
    render(<AllotmentDetailActions {...BASE_PROPS} status="applied" />);

    fireEvent.click(screen.getByRole("button", { name: "Reject application" }));
    // reason textarea appears
    const textarea = await screen.findByRole("textbox");
    fireEvent.change(textarea, { target: { value: "Ineligible on pay level" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Reject application" })[1]);

    await waitFor(() => expect(browserJsonMock).toHaveBeenCalledWith(
      "v1/estab/quarter-allotments/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/cancel",
      expect.objectContaining({ method: "PATCH", body: expect.stringContaining("cancelReason") }),
    ));
  });

  // GAP-ESTAB-QUARTERS-ALLOTMENTS-DETAIL-06: past vacation date rejected inline
  it("rejects a past vacation due date with an inline error", () => {
    render(<AllotmentDetailActions {...BASE_PROPS} status="occupied" />);
    const dateInput = screen.getByLabelText(/Vacation due date/);
    fireEvent.change(dateInput, { target: { value: "2000-01-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Issue vacation notice" }));
    expect(screen.getByText(/cannot be in the past/)).toBeInTheDocument();
  });

  it("distinguishes an unverifiable licence fee from a genuinely unconfigured one", async () => {
    render(
      <AllotmentDetailActions
        {...BASE_PROPS}
        status="applied"
        monthlyLicenceFeeMinor={null}
        licenceFeeSource="error"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Allot quarter" }));

    expect(await screen.findByText(/could not be verified/)).toBeInTheDocument();
    expect(screen.getAllByText("Couldn't load — showing nothing").length).toBeGreaterThan(0);
    expect(screen.queryByText(/No licence-fee rate is configured/)).not.toBeInTheDocument();
  });

  it("shows a genuine no-rate-configured message distinct from an error", async () => {
    render(
      <AllotmentDetailActions
        {...BASE_PROPS}
        status="applied"
        monthlyLicenceFeeMinor={null}
        licenceFeeSource="api"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Allot quarter" }));

    expect(await screen.findByText(/No licence-fee rate is configured/)).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load — showing nothing")).not.toBeInTheDocument();
  });
});
