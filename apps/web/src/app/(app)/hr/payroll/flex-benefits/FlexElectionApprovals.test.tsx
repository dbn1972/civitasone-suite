import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }));
const fetchMock = vi.fn();
vi.mock("@/lib/api/browserClient", () => ({
  browserFetch: (...a: unknown[]) => fetchMock(...a),
  errorMessageFromResponse: async () => "generic failure",
}));

import { FlexElectionApprovals } from "./FlexElectionApprovals";
import { mapPendingElections, type PendingFlexElection } from "./flexPlans";

const ROW: PendingFlexElection = {
  id: "el-1", employeeName: "Asha Verma", planName: "Standard Flex", fy: "2026-27",
  totalElectedMinor: "150000", status: "submitted", etag: "a".repeat(32), isOwnSubmission: false,
};

function ui(rows = [ROW], total = rows.length) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <FlexElectionApprovals rows={rows} total={total} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => { fetchMock.mockReset(); refresh.mockReset(); });

describe("FlexElectionApprovals (GAP-PAYROLL-FLEX-BENEFITS-05)", () => {
  it("shows the employee name and amount, never a raw id; unknown names get a neutral label", () => {
    ui([ROW, { ...ROW, id: "el-2", employeeName: null }]);
    expect(screen.getByText("Asha Verma")).toBeInTheDocument();
    expect(screen.getByText("Employee (name unavailable)")).toBeInTheDocument();
    expect(screen.getAllByText(/₹1,500\.00/).length).toBeGreaterThan(0);
  });

  it("approve posts to the approve endpoint with an empty body", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
    ui();
    fireEvent.click(screen.getByRole("button", { name: /Approve the flex benefit election of Asha Verma/ }));
    fireEvent.click(screen.getAllByRole("button", { name: "Approve" }).at(-1)!);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0]![0]).toBe("v1/payroll/flex-benefits/elections/el-1/approve");
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("reject keeps Confirm disabled until the reason is at least 10 characters, then sends it", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
    ui();
    fireEvent.click(screen.getByRole("button", { name: /Reject the flex benefit election of Asha Verma/ }));
    const confirm = () => screen.getAllByRole("button", { name: "Reject" }).at(-1)!;
    expect(confirm()).toBeDisabled();
    const box = screen.getByRole("textbox");
    fireEvent.change(box, { target: { value: "too short" } });
    expect(confirm()).toBeDisabled();
    fireEvent.change(box, { target: { value: "exceeds the plan component cap" } });
    expect(confirm()).toBeEnabled();
    fireEvent.click(confirm());
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0]![0]).toBe("v1/payroll/flex-benefits/elections/el-1/reject");
    expect(JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body)).toEqual({ etag: "a".repeat(32), reason: "exceeds the plan component cap" });
  });

  it("maps SELF_APPROVAL_FORBIDDEN to a plain sentence", async () => {
    fetchMock.mockResolvedValue({
      ok: false, clone: () => ({ json: async () => ({ code: "SELF_APPROVAL_FORBIDDEN" }) }),
    });
    ui([{ ...ROW, isOwnSubmission: true }]);
    expect(screen.getByText("You submitted this election.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Approve the flex benefit election/ }));
    fireEvent.click(screen.getAllByRole("button", { name: "Approve" }).at(-1)!);
    expect(await screen.findByText(/another payroll user must decide it/)).toBeInTheDocument();
  });

  it("an empty queue says so, and a truncated one says how many are shown", () => {
    const { unmount } = ui([]);
    expect(screen.getByText("No flex benefit elections are waiting for approval.")).toBeInTheDocument();
    unmount();
    ui([ROW], 80);
    expect(screen.getByText(/Showing 1 of 80 awaiting approval/)).toBeInTheDocument();
  });
});

describe("mapPendingElections", () => {
  it("maps rows, drops malformed ones, and rejects a non-conforming payload", () => {
    const out = mapPendingElections({
      data: [
        { id: "a", employee_name: null, plan_name: "P", fy: "2026-27 ", total_elected_minor: 100, status: "submitted", etag: "b", is_own_submission: true },
        { nonsense: true },
      ],
      total: 7,
    });
    expect(out).toEqual({
      total: 7,
      rows: [{ id: "a", employeeName: null, planName: "P", fy: "2026-27", totalElectedMinor: "100", status: "submitted", etag: "b", isOwnSubmission: true }],
    });
    expect(mapPendingElections(null)).toBeNull();
    expect(mapPendingElections({ data: "x" })).toBeNull();
  });
});
