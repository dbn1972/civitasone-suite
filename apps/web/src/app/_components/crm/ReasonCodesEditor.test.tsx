import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ReasonCodesEditor } from "./ReasonCodesEditor";
import * as lq from "@/lib/crm/leadQualification";

vi.mock("@/lib/crm/leadQualification", async (orig) => {
  const actual = await orig<typeof import("@/lib/crm/leadQualification")>();
  return { ...actual, getReasonCodes: vi.fn(), saveReasonCodes: vi.fn() };
});

const code: lq.LeadReasonCode = { code: "NO_BUDGET", label: "No budget", appliesToStatus: "disqualified", active: true };

beforeEach(() => {
  vi.mocked(lq.getReasonCodes).mockReset();
  vi.mocked(lq.saveReasonCodes).mockReset();
});

describe("ReasonCodesEditor (LQ-004 admin)", () => {
  it("shows the saved-info badge on a failed load", async () => {
    vi.mocked(lq.getReasonCodes).mockResolvedValue({ data: [], source: "error" });
    render(<ReasonCodesEditor />);
    await waitFor(() => expect(screen.getByText(/couldn.t load/i)).toBeInTheDocument());
    expect(screen.getByText(/no reason codes yet/i)).toBeInTheDocument();
  });

  it("blocks save when a row has no code", async () => {
    vi.mocked(lq.getReasonCodes).mockResolvedValue({ data: [], source: "api" });
    render(<ReasonCodesEditor />);
    await waitFor(() => expect(screen.getByText(/no reason codes yet/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /add reason code/i }));
    fireEvent.click(screen.getByRole("button", { name: /save reason codes/i }));
    expect(await screen.findByText(/every reason needs a code/i)).toBeInTheDocument();
    expect(lq.saveReasonCodes).not.toHaveBeenCalled();
  });

  it("loads, edits and saves reason codes", async () => {
    vi.mocked(lq.getReasonCodes).mockResolvedValue({ data: [code], source: "api" });
    vi.mocked(lq.saveReasonCodes).mockResolvedValue(undefined);
    render(<ReasonCodesEditor />);
    await waitFor(() => expect(screen.getByDisplayValue("No budget")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/label for reason 1/i), { target: { value: "No funds" } });
    fireEvent.click(screen.getByRole("button", { name: /save reason codes/i }));
    await waitFor(() => expect(lq.saveReasonCodes).toHaveBeenCalled());
    expect(vi.mocked(lq.saveReasonCodes).mock.calls[0][0][0].label).toBe("No funds");
    expect(await screen.findByText(/reason codes saved/i)).toBeInTheDocument();
  });

  // Row identity: reason codes were keyed by array position, so removing an
  // earlier code shifted later ones up into a different key -- React
  // patched the focused code's DOM node in place with a different code's
  // data instead of removing the right node and leaving the rest (and
  // focus) alone.
  it("keeps a reason code's own value and focus attached to it after an earlier one is removed", async () => {
    vi.mocked(lq.getReasonCodes).mockResolvedValue({ data: [], source: "api" });
    render(<ReasonCodesEditor />);
    await waitFor(() => expect(screen.getByText(/no reason codes yet/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /add reason code/i }));
    fireEvent.click(screen.getByRole("button", { name: /add reason code/i }));
    fireEvent.click(screen.getByRole("button", { name: /add reason code/i }));

    const thirdLabel = screen.getAllByLabelText(/label for reason/i)[2]!;
    fireEvent.change(thirdLabel, { target: { value: "No funds" } });
    thirdLabel.focus();
    expect(document.activeElement).toBe(thirdLabel);

    // Remove the first code -- codes 2-3 shift up to become codes 1-2.
    fireEvent.click(screen.getAllByRole("button", { name: /remove reason/i })[0]!);

    const survivingThirdLabel = screen.getAllByLabelText(/label for reason/i)[1]!;
    expect(survivingThirdLabel).toHaveValue("No funds");
    expect(document.activeElement).toBe(survivingThirdLabel);
  });
});
