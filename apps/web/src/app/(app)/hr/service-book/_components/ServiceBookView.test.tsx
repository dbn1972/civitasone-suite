import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { ServiceBookView, type ServiceEntry } from "./ServiceBookView";

function makeEntries(count: number): ServiceEntry[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `e${i}`,
    employee: `Employee ${i}`,
    eventType: "join",
    effectiveDate: new Date(2020, 0, i + 1).toISOString(),
  }));
}

function renderView(entries: ServiceEntry[]) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <ServiceBookView entries={entries} />
    </NextIntlClientProvider>,
  );
}

// UX-008 tranche 2: the Previous (←) / Next (→) pager controls were ad hoc
// inline-styled (no shared design-system class) -- converted onto the
// shared Button component. The numbered page buttons were left untouched:
// each carries a 3rd "current page" state (highlighted vs not) that doesn't
// fit Button's binary variant model, unlike the simple enabled/disabled
// Previous/Next pair. No prior test existed for this file, so this covers
// pagination.
describe("ServiceBookView pagination", () => {
  it("disables Previous on the first page and Next advances the page", () => {
    renderView(makeEntries(40));
    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
    expect(screen.getByText("Employee 0")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(screen.getByText("Employee 15")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous page" })).toBeEnabled();
  });

  it("disables Next on the last page", () => {
    renderView(makeEntries(40));
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
  });

  it("does not render pagination controls when everything fits on one page", () => {
    renderView(makeEntries(5));
    expect(screen.queryByRole("button", { name: "Previous page" })).not.toBeInTheDocument();
  });
});

// GAP-HR-SERVICE-BOOK-01: unattested/attested entries look identical before
// this fix -- no Status column existed at all.
describe("ServiceBookView status", () => {
  it("shows a green Attested pill for an attested entry and an amber Recorded pill otherwise", () => {
    renderView([
      { id: "a1", employee: "Priya Nair", eventType: "join", effectiveDate: "2020-01-01", status: "attested" },
      { id: "a2", employee: "Arjun Rao", eventType: "join", effectiveDate: "2020-01-02", status: "recorded" },
    ]);
    // "Attested" is also the column header, so scope to each data row.
    expect(screen.getByText("Priya Nair").closest("tr")).toHaveTextContent("Attested");
    expect(screen.getByText("Arjun Rao").closest("tr")).toHaveTextContent("Recorded");
  });

  it("filters to unattested entries only when the checkbox is checked", () => {
    renderView([
      { id: "a1", employee: "Priya Nair", eventType: "join", effectiveDate: "2020-01-01", status: "attested" },
      { id: "a2", employee: "Arjun Rao", eventType: "join", effectiveDate: "2020-01-02", status: "recorded" },
    ]);
    fireEvent.click(screen.getByRole("checkbox", { name: "Unattested only" }));
    expect(screen.queryByText("Priya Nair")).not.toBeInTheDocument();
    expect(screen.getByText("Arjun Rao")).toBeInTheDocument();
  });
});

// GAP-HR-SERVICE-BOOK-03: entry types real consumers actually write
// (separation, reinstatement, training, deputation_out, repatriation,
// deputation_cancelled) previously had no badge config at all, and an
// unrecognised type showed "Other" in the badge but the raw code in the
// filter dropdown -- inconsistent labelling for the exact same value.
describe("ServiceBookView event types", () => {
  it("shows a real label (not 'Other') for every consumer-written event type", () => {
    renderView([
      { id: "s1", employee: "A", eventType: "separation", effectiveDate: "2020-01-01" },
      { id: "s2", employee: "B", eventType: "reinstatement", effectiveDate: "2020-01-02" },
      { id: "s3", employee: "C", eventType: "training", effectiveDate: "2020-01-03" },
      { id: "s4", employee: "D", eventType: "deputation_out", effectiveDate: "2020-01-04" },
      { id: "s5", employee: "E", eventType: "repatriation", effectiveDate: "2020-01-05" },
      { id: "s6", employee: "F", eventType: "deputation_cancelled", effectiveDate: "2020-01-06" },
    ]);
    // Each also appears as its own filter-dropdown option (same label, see
    // the "humanizes...consistently" test below), so query within the row.
    expect(screen.getByText("A").closest("tr")).toHaveTextContent("Separation");
    expect(screen.getByText("B").closest("tr")).toHaveTextContent("Reinstatement");
    expect(screen.getByText("C").closest("tr")).toHaveTextContent("Training");
    expect(screen.getByText("D").closest("tr")).toHaveTextContent("Deputation (Out)");
    expect(screen.getByText("E").closest("tr")).toHaveTextContent("Repatriation");
    expect(screen.getByText("F").closest("tr")).toHaveTextContent("Deputation Cancelled");
  });

  it("humanizes an unrecognised type consistently in both the badge and the filter dropdown", () => {
    renderView([{ id: "u1", employee: "A", eventType: "some_future_code", effectiveDate: "2020-01-01" }]);
    // Badge (row) and dropdown option should both read "Some Future Code",
    // not the raw code in one place and "Other" in the other.
    expect(screen.getAllByText("Some Future Code").length).toBeGreaterThanOrEqual(2);
  });
});

// GAP-HR-SERVICE-BOOK-02: a "From" column that was always "—" (the data
// model has no from-posting field) has been dropped; the remaining content
// column is "Details", not "To / Detail".
describe("ServiceBookView columns", () => {
  it("has no 'From' column and labels the content column 'Details'", () => {
    renderView([{ id: "d1", employee: "A", eventType: "transfer", detail: "Moved to Finance", effectiveDate: "2020-01-01" }]);
    expect(screen.queryByText("From")).not.toBeInTheDocument();
    expect(screen.getByText("Details")).toBeInTheDocument();
    expect(screen.getByText("Moved to Finance")).toBeInTheDocument();
  });
});

// GAP-HR-SERVICE-BOOK-04: the free-text employee box is gone from the table -- the employee scope is a
// server-side search-select on the page (ServiceBookEmployeePicker, ?empId=), so a typed name fragment can
// no longer pretend to search the tenant while only filtering the rows that happened to load.
describe("ServiceBookView employee scope", () => {
  it("has no free-text employee filter box (the page owns the employee picker)", () => {
    renderView(makeEntries(3));
    expect(screen.queryByLabelText("Filter by employee name")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Search employee…")).not.toBeInTheDocument();
  });

  it("still filters by event type", () => {
    renderView([
      { id: "a", employee: "A", eventType: "join", effectiveDate: "2020-01-01" },
      { id: "b", employee: "B", eventType: "transfer", effectiveDate: "2020-01-02" },
    ]);
    fireEvent.change(screen.getByLabelText("Filter by event type"), { target: { value: "transfer" } });
    expect(screen.queryByText("A")).not.toBeInTheDocument();
    expect(screen.getByText("B")).toBeInTheDocument();
  });
});

// GAP-HR-SERVICE-BOOK-06: the self-service payload is the same row shape as the HR list. These rows are the
// real shape GET /v1/hrms/service-book/me now returns (verbatim keys), and the attested status must be visible.
describe("ServiceBookView with the real /me payload shape", () => {
  const ME_ROWS = [
    { id: "m1", employeeId: "emp-1", employee: "Priya Nair", eventType: "join", detail: "Joined as Section Officer", effectiveDate: "2020-01-01", orderNo: "—", status: "recorded" },
    { id: "m2", employeeId: "emp-1", employee: "Priya Nair", eventType: "promotion", detail: "Promoted", effectiveDate: "2023-04-01", orderNo: "PROM/2023/07", status: "attested" },
  ];

  it("shows each entry's event badge and its attested / recorded status", () => {
    renderView(ME_ROWS);
    expect(screen.getByText("Joined as Section Officer").closest("tr")).toHaveTextContent("Joining");
    expect(screen.getByText("Joined as Section Officer").closest("tr")).toHaveTextContent("Recorded");
    expect(screen.getByText("Promoted").closest("tr")).toHaveTextContent("Promotion");
    expect(screen.getByText("Promoted").closest("tr")).toHaveTextContent("Attested");
    expect(screen.getByText("PROM/2023/07")).toBeInTheDocument();
  });

  it("does not crash on a row that carries no eventType (an older/raw payload) -- it degrades to the generic badge", () => {
    expect(() =>
      renderView([{ id: "x", employee: "Legacy Row", effectiveDate: "2020-01-01", entryType: "join", description: "raw shape" } as unknown as ServiceEntry]),
    ).not.toThrow();
    expect(screen.getByText("Legacy Row").closest("tr")).toHaveTextContent("Other");
  });
});
