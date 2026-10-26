import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, fireEvent, within } from "@testing-library/react";
import { renderWithIntl as render } from "@/lib/testUtils/intl";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { IssuesTable } from "./IssuesTable";
import type { LibraryIssueSummary } from "@civitasone/types";

const EMP_ID = "00000000-0000-0000-0000-000000000001";

const issues: LibraryIssueSummary[] = [
  {
    id: "i1",
    bookId: "b1",
    bookTitle: "Fundamental Rules",
    borrowerRef: EMP_ID,
    issuedAt: "2026-09-01T00:00:00Z",
    dueAt: "2026-09-15T00:00:00Z",
    status: "issued",
  },
  {
    id: "i2",
    bookId: "b2",
    bookTitle: "Service Rules",
    borrowerRef: EMP_ID,
    issuedAt: "2026-09-01T00:00:00Z",
    dueAt: "2026-08-15T00:00:00Z",
    status: "overdue",
  },
];

describe("IssuesTable", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("GAP-ESTAB-LIBRARY-ISSUES-01: resolves borrower UUID to employee name", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.includes("/hrms/employees")) {
        return new Response(
          JSON.stringify({ data: [{ id: EMP_ID, employeeNo: "E-001", name: "Priya Sharma", department: "Admin" }] }),
          { status: 200 },
        );
      }
      return new Response(null, { status: 404 });
    });

    render(<IssuesTable rows={issues} />);

    // Initially shows — while resolving, then resolves to name
    await waitFor(() => {
      expect(screen.getAllByText("Priya Sharma (E-001)")).toHaveLength(2);
    });
    // UUID should not appear as visible text
    expect(screen.queryByText(EMP_ID)).not.toBeInTheDocument();
  });

  it("shows fallback dash when employee resolution fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 500 }));

    render(<IssuesTable rows={issues} />);

    // Should show — as fallback
    await waitFor(() => {
      const cells = screen.getAllByText("—");
      expect(cells.length).toBeGreaterThanOrEqual(2);
    });
  });

  it("CLOS2-S1-03: issued/due/returned dates roll over to the IST calendar day", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 500 }));
    const rolled: LibraryIssueSummary[] = [
      {
        id: "i9", bookId: "b9", bookTitle: "Rollover Book", borrowerRef: EMP_ID,
        issuedAt: "2026-10-22T20:30:00.000Z", dueAt: "2026-11-04T19:00:00.000Z",
        returnedAt: "2026-11-05T20:00:00.000Z", status: "returned",
      } as LibraryIssueSummary,
    ];
    render(<IssuesTable rows={rolled} />);
    expect((await screen.findAllByText("23 Oct 2026"))[0]).toBeInTheDocument();
    expect(screen.getAllByText("05 Nov 2026")[0]).toBeInTheDocument();
    expect(screen.getAllByText("06 Nov 2026")[0]).toBeInTheDocument();
  });

  // Owner decision #29 (GAP-ESTAB-LIBRARY-ISSUES-05): renewal + condition on return in scope; fines are not.
  describe("renewal and return condition (owner decision #29)", () => {
    function mockFetch() {
      return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
        const url = typeof input === "string" ? input : (input as Request).url;
        if (url.includes("/hrms/employees")) return new Response(JSON.stringify({ data: [] }), { status: 200 });
        return new Response(JSON.stringify({ id: "i1", status: "accepted" }), { status: 202 });
      });
    }
    const callsTo = (spy: ReturnType<typeof mockFetch>, part: string) =>
      spy.mock.calls.filter((c) => String(typeof c[0] === "string" ? c[0] : (c[0] as Request).url).includes(part));

    it("offers Renew on loans that are out (issued and overdue) and not on returned ones", () => {
      mockFetch();
      const rows: LibraryIssueSummary[] = [
        ...issues,
        { id: "i3", bookId: "b3", bookTitle: "Done Book", borrowerRef: EMP_ID, issuedAt: "2026-08-01T00:00:00Z", dueAt: "2026-08-15T00:00:00Z", returnedAt: "2026-08-10T00:00:00Z", status: "returned" },
      ];
      render(<IssuesTable rows={rows} />);
      expect(screen.getByRole("button", { name: /^Renew Fundamental Rules/ })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /^Renew Service Rules/ })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^Renew Done Book/ })).not.toBeInTheDocument();
    });

    it("renew refuses a due date that is not after the current one, then PATCHes renew with a later date", async () => {
      const spy = mockFetch();
      render(<IssuesTable rows={issues} />);
      fireEvent.click(screen.getByRole("button", { name: /^Renew Fundamental Rules/ }));
      const dialog = await screen.findByRole("alertdialog");
      const date = within(dialog).getByLabelText(/New due date/i) as HTMLInputElement;

      fireEvent.change(date, { target: { value: "2026-09-10" } }); // before the current due date 2026-09-15
      fireEvent.click(within(dialog).getByRole("button", { name: /Confirm renewal/i }));
      expect(await within(dialog).findByText(/must be after the current due date/i)).toBeInTheDocument();
      expect(callsTo(spy, "/renew")).toHaveLength(0);

      fireEvent.change(date, { target: { value: "2026-09-29" } });
      fireEvent.click(within(dialog).getByRole("button", { name: /Confirm renewal/i }));
      await waitFor(() => expect(callsTo(spy, "/library/issues/i1/renew")).toHaveLength(1));
      const init = callsTo(spy, "/renew")[0]![1] as RequestInit;
      expect(init.method).toBe("PATCH");
      expect(JSON.parse(String(init.body))).toEqual({ dueAt: "2026-09-29T00:00:00.000Z" });
    });

    it("the return dialog captures the condition (default Good) and notes and sends them", async () => {
      const spy = mockFetch();
      render(<IssuesTable rows={issues} />);
      fireEvent.click(screen.getByRole("button", { name: /^Return Fundamental Rules/ }));
      const dialog = await screen.findByRole("alertdialog");
      const select = within(dialog).getByLabelText(/Condition on return/i) as HTMLSelectElement;
      expect(select.value).toBe("good");
      fireEvent.change(select, { target: { value: "damaged" } });
      fireEvent.change(within(dialog).getByLabelText(/Notes/i), { target: { value: "torn cover" } });
      fireEvent.click(within(dialog).getByRole("button", { name: /Confirm return/i }));
      await waitFor(() => expect(callsTo(spy, "/library/issues/i1/return")).toHaveLength(1));
      const init = callsTo(spy, "/return")[0]![1] as RequestInit;
      expect(init.method).toBe("PATCH");
      expect(JSON.parse(String(init.body))).toEqual({ condition: "damaged", notes: "torn cover" });
    });

    it("shows the recorded condition on a returned loan and how many times a loan was renewed", () => {
      mockFetch();
      const rows: LibraryIssueSummary[] = [
        { id: "i4", bookId: "b4", bookTitle: "Returned Book", borrowerRef: EMP_ID, issuedAt: "2026-08-01T00:00:00Z", dueAt: "2026-08-15T00:00:00Z", returnedAt: "2026-08-10T00:00:00Z", status: "returned", returnCondition: "damaged", returnNotes: "torn cover" },
        { id: "i5", bookId: "b5", bookTitle: "Renewed Book", borrowerRef: EMP_ID, issuedAt: "2026-08-01T00:00:00Z", dueAt: "2099-08-15T00:00:00Z", status: "issued", renewalCount: 2 },
      ];
      render(<IssuesTable rows={rows} />);
      expect(screen.getByText(/Condition: Damaged/i)).toBeInTheDocument();
      expect(screen.getByText(/Renewed 2 times/i)).toBeInTheDocument();
    });
  });
});
