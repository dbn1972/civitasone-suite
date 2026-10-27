import { describe, it, expect, vi, beforeEach } from "vitest";
import {render as rtlRender, screen, fireEvent, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { NextIntlClientProvider, createTranslator } from "next-intl";
import enMessages from "@/messages/en.json";

// The money-identity strings are translated client-side (pqbMoney), so every render needs an intl provider.
const render = (ui: ReactElement) =>
  rtlRender(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

vi.mock("@/lib/sync/resource", () => ({
  useSeededResource: <T,>(_key: string, initialData: T) => ({
    data: initialData,
    provenance: "live",
    offline: false,
    cachedAt: null,
  }),
}));

import { InstallmentsTable } from "./InstallmentsTable";
import type { GrantInstallmentSummary } from "@civitasone/types";

const ROW: GrantInstallmentSummary = {
  id: "inst-1",
  grantId: "grant-1",
  grantNo: "GR-2026-04",
  granteeName: "District Panchayat, Nashik",
  installmentNo: 1,
  amount: 500000,
  scheduledDate: "2026-10-01",
  releasedDate: undefined,
  status: "pending",
} as unknown as GrantInstallmentSummary;

describe("InstallmentsTable", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  // GAP-GRANTS-INSTALLMENTS-02: the approval reason is sent as `reason`, NOT as
  // beneficiaryBankRef (which must never carry a free-text clerk reason).
  it("releases with the reason sent as `reason`, never as beneficiaryBankRef", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));

    render(<InstallmentsTable installments={[ROW]} source="api" canRelease />);
    fireEvent.click(screen.getByRole("button", { name: "Release" }));
    await waitFor(() => expect(screen.getByText(/Release installment #1\?/)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/Reason \/ approval reference/), { target: { value: "Sanctioned per GO 441" } });
    fireEvent.click(screen.getByRole("button", { name: "Release funds" }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/proxy/v1/grants/installments/inst-1/disburse");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.reason).toBe("Sanctioned per GO 441");
    expect(body.beneficiaryBankRef).toBeUndefined();
  });

  // GAP-GRANTS-INSTALLMENTS-01: a non-maker role sees no Release control.
  it("hides the Release control when the viewer cannot release", () => {
    render(<InstallmentsTable installments={[ROW]} source="api" canRelease={false} />);
    expect(screen.queryByRole("button", { name: "Release" })).not.toBeInTheDocument();
  });

  // GAP-GRANTS-INSTALLMENTS-03: #2 is not releasable while #1 is still pending.
  it("blocks releasing an out-of-sequence installment", () => {
    const rows = [
      { ...ROW, id: "i1", installmentNo: 1, status: "pending" as const },
      { ...ROW, id: "i2", installmentNo: 2, status: "pending" as const },
    ];
    render(<InstallmentsTable installments={rows} source="api" canRelease />);
    // Exactly one Release button (for #1); #2 shows a Blocked marker.
    expect(screen.getAllByRole("button", { name: "Release" })).toHaveLength(1);
    expect(screen.getByText("Blocked")).toBeInTheDocument();
  });

  // GAP-GRANTS-INSTALLMENTS-03: the grant's release eligibility comes from grant-service.
  it("offers no Release on a suspended or cancelled grant and says why", () => {
    const rows = [
      { ...ROW, id: "s1", grantId: "g-susp", installmentNo: 1, status: "pending" as const, grantStatus: "suspended" as const },
      { ...ROW, id: "c1", grantId: "g-canc", installmentNo: 1, status: "pending" as const, grantStatus: "cancelled" as const },
    ];
    render(<InstallmentsTable installments={rows} source="api" canRelease />);
    expect(screen.queryByRole("button", { name: "Release" })).not.toBeInTheDocument();
    expect(screen.getAllByText("Blocked")).toHaveLength(2);
    expect(screen.getAllByText("Blocked")[0]).toHaveAttribute("title", "This grant is suspended; installments cannot be released.");
    expect(screen.getAllByText("Blocked")[1]).toHaveAttribute("title", "This grant is cancelled; installments cannot be released.");
  });

  it("still offers Release when the grant is active", () => {
    render(<InstallmentsTable installments={[{ ...ROW, grantStatus: "active" as const }]} source="api" canRelease />);
    expect(screen.getByRole("button", { name: "Release" })).toBeInTheDocument();
  });

  // GAP-GRANTS-INSTALLMENTS-03: the confirm dialog names the grantee and the masked payee account.
  it("shows the grantee and the masked payee account in the release confirmation", async () => {
    render(<InstallmentsTable installments={[{ ...ROW, payeeAccountLast4: "4321", payeeIfsc: "SBIN0001234" }]} source="api" canRelease />);
    fireEvent.click(screen.getByRole("button", { name: "Release" }));
    await waitFor(() => expect(screen.getByText(/Release installment #1\?/)).toBeInTheDocument());
    expect(screen.getAllByText(/District Panchayat, Nashik/).length).toBeGreaterThan(0);
    expect(screen.getByText("Payee account: ending 4321, IFSC SBIN0001234.")).toBeInTheDocument();
  });

  it("warns when the grantee has no registered bank account", async () => {
    render(<InstallmentsTable installments={[{ ...ROW, payeeAccountLast4: null }]} source="api" canRelease />);
    fireEvent.click(screen.getByRole("button", { name: "Release" }));
    await waitFor(() => expect(screen.getByText(/Release installment #1\?/)).toBeInTheDocument());
    expect(screen.getByText(/No bank account is registered for this grantee/)).toBeInTheDocument();
  });

  // GAP-GRANTS-INSTALLMENTS-16: clerk-safe error, not raw server text.
  it("shows a clerk-safe error, not the raw server text, when the release fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("pfms-gateway: beneficiary bank account frozen (code PFMS_ACC_FROZEN)", { status: 422 }),
    );

    render(<InstallmentsTable installments={[ROW]} source="api" canRelease />);
    fireEvent.click(screen.getByRole("button", { name: "Release" }));
    await waitFor(() => expect(screen.getByText(/Release installment #1\?/)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/Reason \/ approval reference/), { target: { value: "Sanctioned per GO 441" } });
    fireEvent.click(screen.getByRole("button", { name: "Release funds" }));

    expect(await screen.findByText(/couldn't save/i)).toBeInTheDocument();
    expect(screen.queryByText(/PFMS_ACC_FROZEN/)).not.toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });
});

describe("postDisburse validation (GAP-GRANTS-DETAIL-03)", () => {
  it("rejects a too-short reason without calling the API", async () => {
    const { postDisburse } = await import("../postDisburse");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy.mockClear();
    const t = createTranslator({ locale: "en", messages: enMessages, namespace: "pqbMoney" }) as unknown as Parameters<typeof postDisburse>[2];
    await expect(postDisburse("inst-1", "ab", t)).rejects.toThrow(/at least 3/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
