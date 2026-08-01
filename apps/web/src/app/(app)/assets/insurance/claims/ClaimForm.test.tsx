import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { ClaimForm } from "./ClaimForm";
import type { PolicyOption } from "./page";

const policies: PolicyOption[] = [
  { id: "p1", policyNo: "POL-2026-001", insurer: "National Insurance Co", assetId: "a1", coverageMinor: "1000000", status: "active" },
];

describe("ClaimForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("requires a policy selection before opening the confirm dialog", () => {
    render(<ClaimForm policies={policies} />);
    fireEvent.click(screen.getByRole("button", { name: "File insurance claim" }));
    expect(screen.getByText("Select the policy this claim is against.")).toBeInTheDocument();
  });

  it("blocks a claim amount above the policy's sum insured (client-side money guard)", () => {
    render(<ClaimForm policies={policies} />);
    fireEvent.change(screen.getByLabelText(/^Policy/), { target: { value: "p1" } });
    fireEvent.change(screen.getByLabelText(/^Claim Date/), { target: { value: "2026-06-15" } });
    fireEvent.change(screen.getByLabelText(/^Claim Amount/), { target: { value: "20000" } }); // ₹20,000 > sum insured ₹10,000

    fireEvent.click(screen.getByRole("button", { name: "File insurance claim" }));

    expect(screen.getByText(/cannot exceed the policy's sum insured/)).toBeInTheDocument();
    expect(screen.queryByText("File this claim?")).not.toBeInTheDocument();
  });

  it("files a claim within the sum insured on confirm (happy path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "claim-1", status: "accepted", correlationId: "c1" }), { status: 202 }),
    );

    render(<ClaimForm policies={policies} preselectedPolicyId="p1" />);
    fireEvent.change(screen.getByLabelText(/^Claim Date/), { target: { value: "2026-06-15" } });
    fireEvent.change(screen.getByLabelText(/^Claim Amount/), { target: { value: "8000" } });

    fireEvent.click(screen.getByRole("button", { name: "File insurance claim" }));

    await waitFor(() => expect(screen.getByText("File this claim?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("File claim"));

    await waitFor(() => {
      expect(screen.getByText(/Claim submitted/)).toBeInTheDocument();
    });
    expect(refreshMock).toHaveBeenCalled();

    const call = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse((call[1] as RequestInit).body as string);
    expect(body.claimAmountMinor).toBe(800000);
  });

  it("surfaces the real server error code on the confirm dialog (error path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ code: "CLAIM_EXCEEDS_COVERAGE", message: "claim amount exceeds the policy's sum insured" }), {
        status: 400,
      }),
    );

    render(<ClaimForm policies={policies} preselectedPolicyId="p1" />);
    fireEvent.change(screen.getByLabelText(/^Claim Date/), { target: { value: "2026-06-15" } });
    fireEvent.change(screen.getByLabelText(/^Claim Amount/), { target: { value: "5000" } });

    fireEvent.click(screen.getByRole("button", { name: "File insurance claim" }));

    await waitFor(() => expect(screen.getByText("File this claim?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("File claim"));

    await waitFor(() => {
      expect(screen.getByText(/CLAIM_EXCEEDS_COVERAGE/)).toBeInTheDocument();
    });
  });
});
