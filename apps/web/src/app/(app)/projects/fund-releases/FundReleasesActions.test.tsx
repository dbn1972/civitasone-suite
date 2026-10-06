import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { DisburseButton } from "./FundReleasesActions";

function open() {
  render(
    <DisburseButton
      schemeId="scheme-9"
      releaseId="fr-1"
      releaseNo="FR-2026-001"
      amount={5_000_000}
      projectName="Rural Roads"
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /Disburse/i }));
}

describe("DisburseButton (GAP-PROJECTS-FUND-RELEASES-01/02/03/06)", () => {
  beforeEach(() => {
    refresh.mockReset();
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => vi.unstubAllGlobals());

  it("GAP-PROJECTS-FUND-RELEASES-01: the confirm dialog recaps release no, project and formatted amount", () => {
    open();
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent("FR-2026-001");
    expect(dialog).toHaveTextContent("Rural Roads");
    expect(dialog).toHaveTextContent("₹50,000.00");
  });

  it("GAP-PROJECTS-FUND-RELEASES-02: Confirm stays disabled until a valid PFMS ref AND a reason are entered", () => {
    open();
    // When open, both the trigger and the dialog confirm are named "Disburse";
    // the confirm is the last one.
    const confirmBtn = screen.getAllByRole("button", { name: "Disburse" }).pop()!;
    expect(confirmBtn).toBeDisabled();

    // Invalid PFMS (too short) + reason -> still disabled.
    fireEvent.change(screen.getByLabelText("PFMS reference"), { target: { value: "x" } });
    fireEvent.change(screen.getByLabelText(/Reason/i), { target: { value: "Q1 release" } });
    expect(confirmBtn).toBeDisabled();

    // Valid PFMS + reason -> enabled.
    fireEvent.change(screen.getByLabelText("PFMS reference"), { target: { value: "PFMS-2026-000123" } });
    expect(confirmBtn).not.toBeDisabled();
  });

  it("GAP-PROJECTS-FUND-RELEASES-02/03: sends pfmsRef and reason as SEPARATE fields to the schemeId URL; shows success", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });
    open();
    fireEvent.change(screen.getByLabelText("PFMS reference"), { target: { value: "PFMS-2026-000123" } });
    fireEvent.change(screen.getByLabelText(/Reason/i), { target: { value: "Q1 tranche" } });
    const confirmBtn = screen.getAllByRole("button", { name: /Disburse/i }).pop()!;
    fireEvent.click(confirmBtn);

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/proxy/v1/projects/schemes/scheme-9/fund-releases/fr-1/disburse");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({ pfmsRef: "PFMS-2026-000123", reason: "Q1 tranche" });

    await waitFor(() => expect(screen.getByText(/Fund release FR-2026-001 disbursed/)).toBeInTheDocument());
    expect(refresh).toHaveBeenCalled();
  });
});
