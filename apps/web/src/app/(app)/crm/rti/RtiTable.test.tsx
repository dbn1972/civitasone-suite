import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render as rtlRender, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

function render(ui: ReactElement) {
  return rtlRender(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

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

describe("RtiTable status pill (GAP-CRM-RTI-03)", () => {
  beforeEach(() => mockedHook.mockReset());

  it("humanises FIRST_APPEAL ('First Appeal') with a warn tone, not the raw enum", () => {
    const rows = [row("1", "FIRST_APPEAL", "2026-10-20T00:00:00.000Z")];
    seed(rows);
    render(<RtiTable rows={rows} />);
    const pill = screen.getByText("First Appeal");
    expect(pill).toBeInTheDocument();
    expect(pill.className).toContain("warn");
    // The raw enum is never printed.
    expect(screen.queryByText("FIRST_APPEAL")).not.toBeInTheDocument();
  });

  it("renders RESPONDED as a good-tone 'Responded' pill", () => {
    const rows = [row("1", "RESPONDED", "2026-09-01T00:00:00.000Z")];
    seed(rows);
    render(<RtiTable rows={rows} />);
    const pill = screen.getByText("Responded");
    expect(pill.className).toContain("good");
  });
});

describe("RtiTable applicant PII (GAP-CRM-RTI-04 / F1-02 + F1-06)", () => {
  beforeEach(() => mockedHook.mockReset());

  function namedRow(name: string): CrmRtiRow {
    return { ...row("1", "RECEIVED", "2026-10-20T00:00:00.000Z"), applicantName: name };
  }

  // The SERVER now masks `applicantName` in the list for roles outside the CRM
  // PII-read set; the table renders whatever the server returned verbatim and
  // no longer masks client-side.
  it("renders the server-masked applicant name verbatim for a non-PII viewer", () => {
    const rows = [namedRow("Anil S•••")];
    seed(rows);
    render(<RtiTable rows={rows} canRevealPii={false} />);
    expect(screen.queryByText("Anil Sharma")).not.toBeInTheDocument();
    expect(screen.getByText("Anil S•••")).toBeInTheDocument();
  });

  it("renders the clear applicant name verbatim when the server sent it (PII viewer)", () => {
    const rows = [namedRow("Anil Sharma")];
    seed(rows);
    render(<RtiTable rows={rows} canRevealPii />);
    expect(screen.getByText("Anil Sharma")).toBeInTheDocument();
  });
});

describe("RtiTable empty copy (GAP-CRM-RTI-05)", () => {
  beforeEach(() => mockedHook.mockReset());

  it("says 'none recorded yet' when there are no rows and no filters", () => {
    seed([]);
    render(<RtiTable rows={[]} hasFilters={false} />);
    expect(screen.getByText(/No RTI requests recorded yet/i)).toBeInTheDocument();
  });

  it("says 'none match the filters' when a filter is active", () => {
    seed([]);
    render(<RtiTable rows={[]} hasFilters />);
    expect(screen.getByText(/match the current filters/i)).toBeInTheDocument();
  });
});
