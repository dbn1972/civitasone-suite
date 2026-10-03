import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { ClaimForm, validateClaimDate } from "./ClaimForm";
import type { PolicyOption } from "./page";

const policies: PolicyOption[] = [
  { id: "p1", policyNo: "POL-2026-001", insurer: "National Insurance Co", assetId: "a1", coverageMinor: "1000000", startDate: "2026-04-01", endDate: "2099-03-31", status: "active" },
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
      expect(screen.getByText(/Claim against policy .* submitted/)).toBeInTheDocument();
    });
    expect(screen.queryByText(/\(id /)).not.toBeInTheDocument();
    expect(refreshMock).toHaveBeenCalled();

    const call = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse((call[1] as RequestInit).body as string);
    expect(body.claimAmountMinor).toBe(800000);
  });

  it("surfaces a clerk-safe message on the confirm dialog, never the server's raw error code (UX-020)", async () => {
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
      expect(screen.getByText(/Some details weren't accepted\. Check what you entered and try again\./)).toBeInTheDocument();
    });
    expect(screen.queryByText(/CLAIM_EXCEEDS_COVERAGE/)).not.toBeInTheDocument();
  });

  // GAP-ASSETS-INSURANCE-CLAIMS-01
  it("says policies failed to load (with Retry), not 'no active policies', when the fetch errored", () => {
    render(<ClaimForm policies={[]} policiesError />);
    expect(screen.getByText(/Couldn.t load policies/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.queryByText(/No active policies available/)).not.toBeInTheDocument();
  });

  it("keeps the 'no active policies' message for a genuinely empty list", () => {
    render(<ClaimForm policies={[]} />);
    expect(screen.getByText(/No active policies available/)).toBeInTheDocument();
  });

  // GAP-ASSETS-INSURANCE-CLAIMS-02
  it("rejects a claim date after the policy's end date, with the end date in the message", () => {
    expect(validateClaimDate("2027-04-01", { startDate: "2026-04-01", endDate: "2027-03-31" }, "2027-06-01")).toMatch(/after the policy.s cover ended \(31 Mar 2027\)/);
  });

  it("rejects a claim date before the policy's cover starts", () => {
    expect(validateClaimDate("2026-03-31", { startDate: "2026-04-01", endDate: "2027-03-31" }, "2027-06-01")).toMatch(/before the policy.s cover starts/);
  });

  it("accepts a date inside the cover, and skips the range check when the API sent no dates", () => {
    expect(validateClaimDate("2026-06-15", { startDate: "2026-04-01", endDate: "2027-03-31" }, "2027-06-01")).toBeNull();
    expect(validateClaimDate("2026-06-15", { startDate: "", endDate: "" }, "2027-06-01")).toBeNull();
  });

  it("uses the IST calendar day: today's IST date is accepted, tomorrow's is not", () => {
    expect(validateClaimDate("2026-10-02", undefined, "2026-10-02")).toBeNull();
    expect(validateClaimDate("2026-10-03", undefined, "2026-10-02")).toBe("Claim date cannot be in the future.");
  });

  it("does not offer a policy that is still flagged active but already past its end date", () => {
    render(
      <ClaimForm
        policies={[{ ...policies[0]!, id: "old", policyNo: "OLD-1", endDate: "2020-01-01" }]}
      />,
    );
    expect(screen.queryByRole("option", { name: /OLD-1/ })).not.toBeInTheDocument();
    expect(screen.getByText(/No active policies available/)).toBeInTheDocument();
  });

  it("shows the cover dates in the policy option label", () => {
    render(<ClaimForm policies={policies} />);
    expect(screen.getByRole("option", { name: /cover 0?1 Apr 2026 to 31 Mar 2099/ })).toBeInTheDocument();
  });

  // GAP-ASSETS-INSURANCE-CLAIMS-06
  it("takes multi-line notes in a textarea and sends them", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: "c", status: "accepted" }), { status: 202 }));
    render(<ClaimForm policies={policies} preselectedPolicyId="p1" />);
    const notes = screen.getByLabelText("Notes");
    expect(notes.tagName).toBe("TEXTAREA");
    fireEvent.change(screen.getByLabelText(/^Claim Date/), { target: { value: "2026-06-15" } });
    fireEvent.change(screen.getByLabelText(/^Claim Amount/), { target: { value: "5000" } });
    fireEvent.change(notes, { target: { value: "line one\nline two" } });
    fireEvent.click(screen.getByRole("button", { name: "File insurance claim" }));
    await waitFor(() => expect(screen.getByText("File this claim?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("File claim"));
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    const body = JSON.parse(((globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1] as RequestInit).body as string);
    expect(body.notes).toBe("line one\nline two");
  });

  // GAP-ASSETS-INSURANCE-07
  it("rejects a claim amount beyond safe-integer paise", () => {
    render(<ClaimForm policies={[{ ...policies[0]!, coverageMinor: "99999999999999999999999" }]} preselectedPolicyId="p1" />);
    fireEvent.change(screen.getByLabelText(/^Claim Date/), { target: { value: "2026-06-15" } });
    fireEvent.change(screen.getByLabelText(/^Claim Amount/), { target: { value: "99999999999999999" } });
    fireEvent.click(screen.getByRole("button", { name: "File insurance claim" }));
    expect(screen.getByText("That claim amount is too large to submit.")).toBeInTheDocument();
  });
});
