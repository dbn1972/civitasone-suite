import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, fireEvent, waitFor } from "@testing-library/react";
import { ReasonCodesEditor } from "./ReasonCodesEditor";
import * as lq from "@/lib/crm/leadQualification";
import type { ReactElement } from "react";

function render(ui: ReactElement) {
  return rtlRender(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

vi.mock("@/lib/crm/leadQualification", async (orig) => {
  const actual = await orig<typeof import("@/lib/crm/leadQualification")>();
  return { ...actual, getReasonCodes: vi.fn(), saveReasonCodes: vi.fn() };
});

const code: lq.LeadReasonCode = { code: "no_budget", label: "No budget", appliesToStatus: "disqualified", active: true };

beforeEach(() => {
  vi.mocked(lq.getReasonCodes).mockReset();
  vi.mocked(lq.saveReasonCodes).mockReset();
});

describe("ReasonCodesEditor (LQ-004 admin)", () => {
  it("shows a recoverable error (no Save/Add, no PUT) on a failed load", async () => {
    vi.mocked(lq.getReasonCodes).mockResolvedValue({ data: [], source: "error" });
    render(<ReasonCodesEditor />);
    await waitFor(() => expect(screen.getByText(/couldn.t load reason codes/i)).toBeInTheDocument());
    expect(screen.queryByText(/no reason codes yet/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /save reason codes/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add reason code/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });

  it("recovers to the editor when retry succeeds", async () => {
    vi.mocked(lq.getReasonCodes)
      .mockResolvedValueOnce({ data: [], source: "error" })
      .mockResolvedValueOnce({ data: [code], source: "api" });
    render(<ReasonCodesEditor />);
    await waitFor(() => expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    await waitFor(() => expect(screen.getByDisplayValue("No budget")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /save reason codes/i })).toBeInTheDocument();
  });

  it("blocks save when a row has no code", async () => {
    vi.mocked(lq.getReasonCodes).mockResolvedValue({ data: [], source: "api" });
    render(<ReasonCodesEditor />);
    await waitFor(() => expect(screen.getByText(/no reason codes yet/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /add reason code/i }));
    fireEvent.click(screen.getByRole("button", { name: /save reason codes/i }));
    expect(await screen.findByText(/fix the highlighted rows/i)).toBeInTheDocument();
    expect(lq.saveReasonCodes).not.toHaveBeenCalled();
  });

  // GAP-CRM-LEAD-REASON-CODES-03: a blank label must block Save (old code only
  // validated the code).
  it("blocks save when the label is blank, marking the field invalid", async () => {
    vi.mocked(lq.getReasonCodes).mockResolvedValue({ data: [{ ...code, label: "" }], source: "api" });
    render(<ReasonCodesEditor />);
    await waitFor(() => expect(screen.getByLabelText(/code for reason 1/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /save reason codes/i }));
    expect(await screen.findByText(/fix the highlighted rows/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/label for reason 1/i)).toHaveAttribute("aria-invalid", "true");
    expect(lq.saveReasonCodes).not.toHaveBeenCalled();
  });

  // GAP-CRM-LEAD-REASON-CODES-03: two rows with the same (code, status) must
  // block Save (old code allowed duplicates).
  it("blocks save on a duplicate code for the same status", async () => {
    vi.mocked(lq.getReasonCodes).mockResolvedValue({ data: [code, { ...code }], source: "api" });
    render(<ReasonCodesEditor />);
    await waitFor(() => expect(screen.getAllByLabelText(/code for reason/i)).toHaveLength(2));
    fireEvent.click(screen.getByRole("button", { name: /save reason codes/i }));
    expect(await screen.findByText(/duplicate code/i)).toBeInTheDocument();
    expect(lq.saveReasonCodes).not.toHaveBeenCalled();
  });

  // GAP-CRM-LEAD-REASON-CODES-03: codes are forced to lowercase so they match
  // the backend regex (old code upper-cased them, which the server 400s).
  it("lowercases a typed code so it matches the backend regex", async () => {
    vi.mocked(lq.getReasonCodes).mockResolvedValue({ data: [], source: "api" });
    vi.mocked(lq.saveReasonCodes).mockResolvedValue(undefined);
    render(<ReasonCodesEditor />);
    await waitFor(() => expect(screen.getByText(/no reason codes yet/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /add reason code/i }));
    fireEvent.change(screen.getByLabelText(/code for reason 1/i), { target: { value: "No_Budget" } });
    fireEvent.change(screen.getByLabelText(/label for reason 1/i), { target: { value: "No budget" } });
    expect(screen.getByLabelText(/code for reason 1/i)).toHaveValue("no_budget");
    fireEvent.click(screen.getByRole("button", { name: /save reason codes/i }));
    await waitFor(() => expect(lq.saveReasonCodes).toHaveBeenCalled());
    expect(vi.mocked(lq.saveReasonCodes).mock.calls[0][0][0].code).toBe("no_budget");
  });

  it("loads, edits and saves reason codes (no removal → no confirm)", async () => {
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

  // GAP-CRM-LEAD-REASON-CODES-02: removing a loaded code then Save opens a
  // confirm listing it; Cancel aborts the PUT.
  it("confirms before saving when a loaded code is removed, and Cancel aborts the PUT", async () => {
    vi.mocked(lq.getReasonCodes).mockResolvedValue({ data: [code], source: "api" });
    vi.mocked(lq.saveReasonCodes).mockResolvedValue(undefined);
    render(<ReasonCodesEditor />);
    await waitFor(() => expect(screen.getByDisplayValue("No budget")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /remove reason 1/i }));
    fireEvent.click(screen.getByRole("button", { name: /save reason codes/i }));
    // Dialog lists the removed code.
    expect(await screen.findByText(/remove 1 reason from the list/i)).toBeInTheDocument();
    expect(screen.getByRole("alertdialog")).toHaveTextContent("no_budget");
    expect(lq.saveReasonCodes).not.toHaveBeenCalled();
    // Cancel aborts.
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(lq.saveReasonCodes).not.toHaveBeenCalled();
  });

  it("saves after confirming the removal", async () => {
    vi.mocked(lq.getReasonCodes).mockResolvedValue({ data: [code], source: "api" });
    vi.mocked(lq.saveReasonCodes).mockResolvedValue(undefined);
    render(<ReasonCodesEditor />);
    await waitFor(() => expect(screen.getByDisplayValue("No budget")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /remove reason 1/i }));
    fireEvent.click(screen.getByRole("button", { name: /save reason codes/i }));
    fireEvent.click(await screen.findByRole("button", { name: /remove and save/i }));
    await waitFor(() => expect(lq.saveReasonCodes).toHaveBeenCalled());
    expect(vi.mocked(lq.saveReasonCodes).mock.calls[0][0]).toHaveLength(0);
  });

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

    fireEvent.click(screen.getAllByRole("button", { name: /remove reason/i })[0]!);

    const survivingThirdLabel = screen.getAllByLabelText(/label for reason/i)[1]!;
    expect(survivingThirdLabel).toHaveValue("No funds");
    expect(document.activeElement).toBe(survivingThirdLabel);
  });

  // GAP-CRM-LEAD-REASON-CODES-04 (wave2): optimistic concurrency wiring.
  it("sends the loaded version to saveReasonCodes and shows Last changed by/at", async () => {
    vi.mocked(lq.getReasonCodes).mockResolvedValue({
      data: [code],
      source: "api",
      meta: { version: "7", updatedBy: "admin-123", updatedAt: "2026-10-01T10:00:00.000Z" },
    });
    vi.mocked(lq.saveReasonCodes).mockResolvedValue("8");
    render(<ReasonCodesEditor />);
    await waitFor(() => expect(screen.getByDisplayValue("No budget")).toBeInTheDocument());
    expect(screen.getByText(/last changed/i)).toBeInTheDocument();
    expect(screen.getByText(/admin-123/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/label for reason 1/i), { target: { value: "No funds" } });
    fireEvent.click(screen.getByRole("button", { name: /save reason codes/i }));
    await waitFor(() => expect(lq.saveReasonCodes).toHaveBeenCalled());
    // Second positional arg is the version token.
    expect(vi.mocked(lq.saveReasonCodes).mock.calls[0][1]).toBe("7");
  });

  it("shows a reload message on a 409 ConfigConflictError without clobbering", async () => {
    vi.mocked(lq.getReasonCodes).mockResolvedValue({ data: [code], source: "api", meta: { version: "7" } });
    vi.mocked(lq.saveReasonCodes).mockRejectedValue(new lq.ConfigConflictError());
    render(<ReasonCodesEditor />);
    await waitFor(() => expect(screen.getByDisplayValue("No budget")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/label for reason 1/i), { target: { value: "No funds" } });
    fireEvent.click(screen.getByRole("button", { name: /save reason codes/i }));
    expect(await screen.findByText(/changed by another admin/i)).toBeInTheDocument();
  });
});
