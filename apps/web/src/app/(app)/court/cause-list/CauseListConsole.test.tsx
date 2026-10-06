import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

const createCauseListMock = vi.fn();
const addCauseListItemMock = vi.fn();
const fetchCauseListItemsMock = vi.fn();
const fetchCauseListByCourtDateMock = vi.fn();

vi.mock("../_data/client", () => ({
  createCauseList: (...a: unknown[]) => createCauseListMock(...a),
  addCauseListItem: (...a: unknown[]) => addCauseListItemMock(...a),
  fetchCauseListItems: (...a: unknown[]) => fetchCauseListItemsMock(...a),
  fetchCauseListByCourtDate: (...a: unknown[]) => fetchCauseListByCourtDateMock(...a),
}));

import { CauseListConsole } from "./CauseListConsole";
import type { Court, CourtCase, CauseListItem } from "../_data/types";

const COURT_A = "11111111-1111-4111-8111-111111111111";
const CASE_A = "22222222-2222-4222-8222-222222222222";

const courts: Court[] = [
  { id: COURT_A, name: "Tehsildar Court, Jaipur", courtType: "revenue", establishmentCode: null },
  { id: "33333333-3333-4333-8333-333333333333", name: "Empty Court (no cases)", courtType: "tribunal", establishmentCode: null },
];

const cases: CourtCase[] = [
  {
    id: CASE_A,
    cnrNumber: "RJHC010000012026",
    caseType: "revenue_appeal",
    filingNumber: "F-1",
    filingDate: "2026-01-01",
    title: "Rao v. State",
    status: "pending",
    stage: "arguments",
    courtId: COURT_A,
    benchId: null,
    disposalDate: null,
    targetDisposalDate: null,
    version: 1,
  },
];

function renderConsole() {
  return render(
    <CauseListConsole cases={cases} casesSource="api" courts={courts} courtsSource="api" />,
  );
}

describe("CauseListConsole", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchCauseListByCourtDateMock.mockResolvedValue(null);
    fetchCauseListItemsMock.mockResolvedValue([]);
  });

  it("CAUSE-LIST-01: courts are listed by NAME, no 8-char UUID; an empty court is still selectable", () => {
    renderConsole();
    const select = screen.getByLabelText("Court") as HTMLSelectElement;
    const optionText = within(select).getAllByRole("option").map((o) => o.textContent);
    expect(optionText).toContain("Tehsildar Court, Jaipur · Revenue");
    // The empty court (no cases) is present.
    expect(optionText.some((t) => t?.includes("Empty Court (no cases)"))).toBe(true);
    // No raw UUID prefix in any option.
    expect(optionText.some((t) => t?.includes(COURT_A.slice(0, 8)))).toBe(false);
  });

  it("CAUSE-LIST-02: looks up an existing list on court/date select and re-opens it (no generate)", async () => {
    fetchCauseListByCourtDateMock.mockResolvedValue({ id: "list-1", courtId: COURT_A, listDate: "2026-02-01" });
    fetchCauseListItemsMock.mockResolvedValue([]);
    renderConsole();
    fireEvent.change(screen.getByLabelText("Court"), { target: { value: COURT_A } });
    await waitFor(() => expect(fetchCauseListByCourtDateMock).toHaveBeenCalled());
    // Existing → button reads "List ready" and generate is NOT called.
    await waitFor(() => expect(screen.getByRole("button", { name: /List ready/ })).toBeInTheDocument());
    expect(createCauseListMock).not.toHaveBeenCalled();
  });

  it("CAUSE-LIST-02: generates a new list when none exists", async () => {
    fetchCauseListByCourtDateMock.mockResolvedValue(null);
    createCauseListMock.mockResolvedValue({ id: "new-list" });
    fetchCauseListItemsMock.mockResolvedValue([]);
    renderConsole();
    fireEvent.change(screen.getByLabelText("Court"), { target: { value: COURT_A } });
    await waitFor(() => expect(fetchCauseListByCourtDateMock).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Generate list" }));
    await waitFor(() => expect(createCauseListMock).toHaveBeenCalledWith({ courtId: COURT_A, listDate: expect.any(String) }));
  });

  it("CAUSE-LIST-03: blocks a duplicate item number and normalises slot/courtroom", async () => {
    fetchCauseListByCourtDateMock.mockResolvedValue({ id: "list-1", courtId: COURT_A, listDate: "2026-02-01" });
    const existing: CauseListItem[] = [
      { id: "it1", causeListId: "list-1", caseId: CASE_A, itemNumber: 1, slot: "AM-1", courtroom: "A", listDate: "2026-02-01", version: 1 },
    ];
    fetchCauseListItemsMock.mockResolvedValue(existing);
    renderConsole();
    fireEvent.change(screen.getByLabelText("Court"), { target: { value: COURT_A } });
    await waitFor(() => expect(screen.getByLabelText("Item number")).toBeInTheDocument());
    // Duplicate item number 1 → blocked.
    fireEvent.change(screen.getByLabelText("Case"), { target: { value: CASE_A } });
    fireEvent.change(screen.getByLabelText("Item number"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Slot"), { target: { value: "am 2" } });
    fireEvent.change(screen.getByLabelText("Courtroom"), { target: { value: "b" } });
    fireEvent.click(screen.getByRole("button", { name: "List case" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/already used/i);
    expect(addCauseListItemMock).not.toHaveBeenCalled();
    // Fix the number → slot/courtroom normalised on submit.
    addCauseListItemMock.mockResolvedValue(undefined);
    fireEvent.change(screen.getByLabelText("Item number"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "List case" }));
    await waitFor(() => expect(addCauseListItemMock).toHaveBeenCalledTimes(1));
    expect(addCauseListItemMock).toHaveBeenCalledWith("list-1", expect.objectContaining({ slot: "AM-2", courtroom: "B", itemNumber: 2 }));
  });

  it("CAUSE-LIST-04: shows the slot verbatim and type/stage columns", async () => {
    fetchCauseListByCourtDateMock.mockResolvedValue({ id: "list-1", courtId: COURT_A, listDate: "2026-02-01" });
    fetchCauseListItemsMock.mockResolvedValue([
      { id: "it1", causeListId: "list-1", caseId: CASE_A, itemNumber: 1, slot: "AM-1", courtroom: "A", listDate: "2026-02-01", version: 1 },
    ]);
    renderConsole();
    fireEvent.change(screen.getByLabelText("Court"), { target: { value: COURT_A } });
    await waitFor(() => expect(screen.getByText("Rao v. State")).toBeInTheDocument());
    const row = screen.getByText("Rao v. State").closest("tr") as HTMLElement;
    // Slot verbatim "AM-1" (NOT humanized "Am 1").
    expect(within(row).getByText("AM-1")).toBeInTheDocument();
    expect(within(row).queryByText("Am 1")).not.toBeInTheDocument();
    // Type + stage columns.
    expect(within(row).getByText("Revenue appeal")).toBeInTheDocument();
    expect(within(row).getByText("Arguments")).toBeInTheDocument();
  });
});
