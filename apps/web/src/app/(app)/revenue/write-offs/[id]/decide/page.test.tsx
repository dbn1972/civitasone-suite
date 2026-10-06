import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

const getSessionUserIdMock = vi.fn<() => string | null>(() => "checker-1");
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionUserId: () => getSessionUserIdMock(),
}));

import WriteOffDecidePage from "./page";

const WRITE_OFF_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
const ASSESSEE_ID = "22222222-2222-2222-2222-222222222222";

function makeWriteOff(partial: Record<string, unknown> = {}) {
  return {
    id: WRITE_OFF_ID,
    assesseeId: ASSESSEE_ID,
    amountMinor: "100000",
    reason: "Unrecoverable after legal proceedings",
    status: "pending",
    makerUserId: "maker-1",
    ...partial,
  };
}

/**
 * The page issues three fetchJson calls in order: write-off, assessee, dcb.
 * Route the mock by telemetryKey (3rd arg's telemetryKey).
 */
function routeFetchJson(opts: {
  writeOff?: { data: unknown; source?: string; status?: number };
  assessee?: { data: unknown; source?: string };
  dcb?: { data: unknown; source?: string };
}) {
  fetchJsonMock.mockImplementation((_url: string, _fallback: unknown, cfg: { telemetryKey?: string }) => {
    const key = cfg?.telemetryKey ?? "";
    if (key.includes("decide.get")) return Promise.resolve(opts.writeOff ?? { data: null, source: "error" });
    if (key.includes("decide.assessee")) return Promise.resolve(opts.assessee ?? { data: null, source: "api" });
    if (key.includes("decide.dcb")) return Promise.resolve(opts.dcb ?? { data: null, source: "api" });
    return Promise.resolve({ data: null, source: "api" });
  });
}

describe("WriteOffDecidePage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    getSessionUserIdMock.mockReturnValue("checker-1");
  });

  it("shows assessee name, outstanding arrears and balance-after instead of a bare UUID (DECIDE-02)", async () => {
    routeFetchJson({
      writeOff: { data: makeWriteOff(), source: "api" },
      assessee: { data: { ownerName: "Ravi Kumar", identifierNo: "PT-900" }, source: "api" },
      dcb: { data: { totalDemand: "500000", totalCollected: "100000", balance: "400000" }, source: "api" },
    });
    const ui = await WriteOffDecidePage({ params: { id: WRITE_OFF_ID } });
    render(ui);

    expect(screen.getByText("Ravi Kumar")).toBeInTheDocument();
    expect(screen.getByText(/PT-900/)).toBeInTheDocument();
    expect(screen.getByText("₹4,000.00")).toBeInTheDocument(); // outstanding
    expect(screen.getByText("₹1,000.00")).toBeInTheDocument(); // write-off amount
    expect(screen.getByText("₹3,000.00")).toBeInTheDocument(); // balance after
    expect(screen.queryByText(ASSESSEE_ID)).not.toBeInTheDocument();
  });

  it("disables Approve/Reject when the signed-in user is the maker (DECIDE-01)", async () => {
    getSessionUserIdMock.mockReturnValue("maker-1");
    routeFetchJson({
      writeOff: { data: makeWriteOff({ makerUserId: "maker-1" }), source: "api" },
      assessee: { data: { ownerName: "Ravi Kumar", identifierNo: "PT-900" }, source: "api" },
      dcb: { data: { totalDemand: "500000", totalCollected: "100000", balance: "400000" }, source: "api" },
    });
    const ui = await WriteOffDecidePage({ params: { id: WRITE_OFF_ID } });
    render(ui);

    expect(screen.getByRole("button", { name: /Approve write-off/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Reject write-off/ })).toBeDisabled();
    expect(screen.getByText(/you raised this write-off/i)).toBeInTheDocument();
  });

  it("enables Approve/Reject for a different officer (DECIDE-01)", async () => {
    getSessionUserIdMock.mockReturnValue("checker-9");
    routeFetchJson({
      writeOff: { data: makeWriteOff({ makerUserId: "maker-1" }), source: "api" },
      assessee: { data: { ownerName: "Ravi Kumar", identifierNo: "PT-900" }, source: "api" },
      dcb: { data: { balance: "400000", totalDemand: "500000", totalCollected: "100000" }, source: "api" },
    });
    const ui = await WriteOffDecidePage({ params: { id: WRITE_OFF_ID } });
    render(ui);
    expect(screen.getByRole("button", { name: /Approve write-off/ })).toBeEnabled();
  });

  it("hides Approve/Reject for an already-decided write-off and shows its status (DECIDE-03)", async () => {
    routeFetchJson({
      writeOff: { data: makeWriteOff({ status: "approved" }), source: "api" },
      assessee: { data: { ownerName: "Ravi Kumar", identifierNo: "PT-900" }, source: "api" },
      dcb: { data: { balance: "400000", totalDemand: "500000", totalCollected: "100000" }, source: "api" },
    });
    const ui = await WriteOffDecidePage({ params: { id: WRITE_OFF_ID } });
    render(ui);
    expect(screen.queryByRole("button", { name: /Approve write-off/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Already decided/)).toBeInTheDocument();
  });

  it("calls notFound() on a 404 (unknown id) (DECIDE-04)", async () => {
    routeFetchJson({ writeOff: { data: null, source: "error", status: 404 } });
    await expect(WriteOffDecidePage({ params: { id: WRITE_OFF_ID } })).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("shows a retry state (not not-found) on a server error, with buttons disabled (DECIDE-04 + fail-closed)", async () => {
    routeFetchJson({ writeOff: { data: null, source: "error", status: 500 } });
    const ui = await WriteOffDecidePage({ params: { id: WRITE_OFF_ID } });
    render(ui);
    expect(screen.getByRole("button", { name: /Approve write-off/ })).toBeDisabled();
    expect(screen.queryByText(/₹/)).not.toBeInTheDocument();
  });
});
