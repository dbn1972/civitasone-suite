import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { GrantInstallmentsTable, GrantUCsTable } from "./GrantDetailTables";
import type { GrantDetail } from "@civitasone/types";

type Installment = GrantDetail["installments"][number];
type UC = GrantDetail["ucs"][number];

function inst(partial: Partial<Installment>): Installment {
  return {
    id: "inst-1",
    installmentNo: 1,
    amount: 500000,
    scheduledDate: "2026-10-01",
    status: "pending",
    ...partial,
  } as Installment;
}

describe("GrantInstallmentsTable", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  // GAP-GRANTS-DETAIL-01: a viewer (canRelease=false) must see NO Release button.
  it("renders no Release button and an accessible empty-action label when the user cannot release", () => {
    render(<GrantInstallmentsTable installments={[inst({})]} grantStatus="active" canRelease={false} />);
    expect(screen.queryByRole("button", { name: "Release" })).not.toBeInTheDocument();
    // GAP-GRANTS-DETAIL-06: the empty action cell is announced, not aria-hidden only.
    expect(screen.getByText("No action available")).toBeInTheDocument();
  });

  // GAP-GRANTS-DETAIL-03: the reason is sent as `reason`, never as beneficiaryBankRef.
  it("releases against the correct endpoint sending reason (not beneficiaryBankRef) and refreshes", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));

    render(<GrantInstallmentsTable installments={[inst({})]} grantStatus="active" granteeName="Gram Panchayat Alpha" canRelease />);
    fireEvent.click(screen.getByRole("button", { name: "Release" }));
    await waitFor(() => expect(screen.getByText(/Release installment #1\?/)).toBeInTheDocument());
    // GAP-GRANTS-DETAIL-04: the confirm dialog names the payee.
    expect(screen.getByText(/Gram Panchayat Alpha/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Reason \/ approval reference/), { target: { value: "Sanctioned per GO 441" } });
    fireEvent.click(screen.getByRole("button", { name: "Release funds" }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    const [url, options] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/proxy/v1/grants/installments/inst-1/disburse");
    const body = JSON.parse(options.body as string);
    expect(body).toEqual({ mode: "PFMS", reason: "Sanctioned per GO 441" });
    expect(body).not.toHaveProperty("beneficiaryBankRef");
  });

  // GAP-GRANTS-DETAIL-04: a suspended grant disables Release with a reason.
  it("disables Release on a non-active grant", () => {
    render(<GrantInstallmentsTable installments={[inst({})]} grantStatus="suspended" canRelease />);
    const btn = screen.getByRole("button", { name: /Release unavailable/ });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("title", expect.stringContaining("suspended"));
  });

  // GAP-GRANTS-DETAIL-04: only the lowest-numbered pending installment is releasable.
  it("only enables Release for the lowest-numbered pending installment", () => {
    render(
      <GrantInstallmentsTable
        installments={[inst({ id: "i2", installmentNo: 2 }), inst({ id: "i3", installmentNo: 3 })]}
        grantStatus="active"
        canRelease
      />,
    );
    // #2 enabled, #3 disabled.
    expect(screen.getByRole("button", { name: "Release" })).toBeEnabled();
    const disabled = screen.getByRole("button", { name: /Release unavailable/ });
    expect(disabled).toBeDisabled();
    expect(disabled).toHaveAttribute("title", expect.stringContaining("#2 first"));
  });

  it("shows a clerk-safe error, not the raw server text, when the release fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("pfms-gateway: beneficiary bank account frozen", { status: 422 }),
    );

    render(<GrantInstallmentsTable installments={[inst({})]} grantStatus="active" canRelease />);
    fireEvent.click(screen.getByRole("button", { name: "Release" }));
    await waitFor(() => expect(screen.getByText(/Release installment #1\?/)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/Reason \/ approval reference/), { target: { value: "Sanctioned per GO 441" } });
    fireEvent.click(screen.getByRole("button", { name: "Release funds" }));

    expect(await screen.findByText(/couldn't save/i)).toBeInTheDocument();
    expect(screen.queryByText(/beneficiary bank account frozen/)).not.toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });
});

describe("GrantUCsTable", () => {
  const uc = (partial: Partial<UC>): UC => ({ id: "uc-1", ucNo: "UC-1", amount: 100000, period: "2026-Q1", status: "submitted", ...partial } as UC);

  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  // GAP-GRANTS-DETAIL-01: a viewer sees no Verify/Reject.
  it("renders no Verify/Reject when the user cannot verify", () => {
    render(<GrantUCsTable ucs={[uc({})]} canVerify={false} />);
    expect(screen.queryByRole("button", { name: "Verify" })).not.toBeInTheDocument();
    expect(screen.getByText("No action available")).toBeInTheDocument();
  });

  // GAP-GRANTS-DETAIL-05: a "validated" UC is treated as already verified (no actions).
  it("treats a validated UC as verified (no Verify/Reject offered)", () => {
    render(<GrantUCsTable ucs={[uc({ status: "validated" })]} canVerify />);
    expect(screen.queryByRole("button", { name: "Verify" })).not.toBeInTheDocument();
  });

  it("offers Verify/Reject on a submitted UC when the user can verify", () => {
    render(<GrantUCsTable ucs={[uc({})]} canVerify />);
    expect(screen.getByRole("button", { name: "Verify" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reject" })).toBeInTheDocument();
  });
});
