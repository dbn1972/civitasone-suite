import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/sync/resource", () => ({ useSeededResource: vi.fn() }));
vi.mock("@/lib/formatters", async () => {
  const actual = await vi.importActual<typeof import("@/lib/formatters")>("@/lib/formatters");
  return actual;
});

import { useSeededResource } from "@/lib/sync/resource";
import { RtiTable } from "./RtiTable";
import type { CrmRtiRow } from "../../../_data/loaders";

const mockedHook = vi.mocked(useSeededResource);

function row(id: string, status: string, dueAt: string | null): CrmRtiRow {
  return {
    id,
    referenceNo: `RTI/2026/FIN/${id}`,
    section: "s.6",
    departmentRef: "Ministry of Finance",
    applicantName: `Applicant ${id}`,
    applicantContact: null,
    subject: `Request ${id}`,
    status,
    feePaid: false,
    feeAmount: null,
    feeAmountMinor: null,
    mode: null,
    receivedAt: "2026-08-01T00:00:00.000Z",
    dueAt,
    firstAppealDueAt: null,
    respondedAt: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };
}

function seed(rows: CrmRtiRow[]) {
  mockedHook.mockReturnValue({
    data: rows,
    provenance: "live",
    offline: false,
    cachedAt: null,
  } as unknown as ReturnType<typeof useSeededResource>);
}

describe("RtiTable SlaBadge honours status (GAP-CRM-RTI-01)", () => {
  beforeEach(() => {
    mockedHook.mockReset();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-05T06:00:00.000Z")); // 11:30 IST
  });
  afterEach(() => vi.useRealTimers());

  it("a RESPONDED row past its due date shows a neutral 'Closed' badge, never 'overdue'", () => {
    seed([row("1", "RESPONDED", "2026-09-01T00:00:00.000Z")]);
    render(<RtiTable rows={[row("1", "RESPONDED", "2026-09-01T00:00:00.000Z")]} />);
    expect(screen.getByText("Closed")).toBeInTheDocument();
    expect(screen.queryByText(/overdue/i)).not.toBeInTheDocument();
  });

  it("a REJECTED and a DISPOSED row past due are 'Closed', not overdue", () => {
    const rows = [row("1", "REJECTED", "2026-09-01T00:00:00.000Z"), row("2", "DISPOSED", "2026-09-01T00:00:00.000Z")];
    seed(rows);
    render(<RtiTable rows={rows} />);
    expect(screen.getAllByText("Closed")).toHaveLength(2);
    expect(screen.queryByText(/overdue/i)).not.toBeInTheDocument();
  });

  it("an OPEN (RECEIVED) row past its due date still shows a red 'd overdue' badge", () => {
    const rows = [row("1", "RECEIVED", "2026-09-01T00:00:00.000Z")];
    seed(rows);
    render(<RtiTable rows={rows} />);
    expect(screen.getByText(/\d+d overdue/)).toBeInTheDocument();
    expect(screen.queryByText("Closed")).not.toBeInTheDocument();
  });

  it("an OPEN row with days remaining shows a countdown, not overdue/closed", () => {
    const rows = [row("1", "TRANSFERRED", "2026-10-20T00:00:00.000Z")]; // 15 days
    seed(rows);
    render(<RtiTable rows={rows} />);
    expect(screen.getByText(/\d+d left/)).toBeInTheDocument();
  });
});
