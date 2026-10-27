import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

const createCauseListMock = vi.fn();
const addCauseListItemMock = vi.fn();
const fetchCauseListItemsMock = vi.fn();
const fetchCauseListByCourtDateMock = vi.fn();
const fetchCaseMock = vi.fn();
const fetchConfigNamespaceMock = vi.fn();

vi.mock("../_data/client", () => ({
  fetchConfigNamespace: (...a: unknown[]) => fetchConfigNamespaceMock(...a),
  createCauseList: (...a: unknown[]) => createCauseListMock(...a),
  addCauseListItem: (...a: unknown[]) => addCauseListItemMock(...a),
  fetchCauseListItems: (...a: unknown[]) => fetchCauseListItemsMock(...a),
  fetchCauseListByCourtDate: (...a: unknown[]) => fetchCauseListByCourtDateMock(...a),
  fetchCase: (...a: unknown[]) => fetchCaseMock(...a),
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
    fetchCaseMock.mockResolvedValue(null);
    // Owner decision #33: no per-court config rows -> the console offers the defaults.
    fetchConfigNamespaceMock.mockReset();
    fetchConfigNamespaceMock.mockResolvedValue([]);
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

  async function openListWithItems(existing: CauseListItem[] = []) {
    fetchCauseListByCourtDateMock.mockResolvedValue({ id: "list-1", courtId: COURT_A, listDate: "2026-02-01" });
    fetchCauseListItemsMock.mockResolvedValue(existing);
    renderConsole();
    fireEvent.change(screen.getByLabelText("Court"), { target: { value: COURT_A } });
    await waitFor(() => expect(screen.getByLabelText("Item number")).toBeInTheDocument());
  }
  const optionValues = (label: string) =>
    within(screen.getByLabelText(label) as HTMLSelectElement).getAllByRole("option").map((o) => (o as HTMLOptionElement).value);

  it("CAUSE-LIST-03: blocks a duplicate item number, then lists with the chosen configured slot/courtroom", async () => {
    await openListWithItems([
      { id: "it1", causeListId: "list-1", caseId: CASE_A, itemNumber: 1, slot: "AM-1", courtroom: "A", listDate: "2026-02-01", version: 1 },
    ]);
    // Duplicate item number 1 -> blocked.
    fireEvent.change(screen.getByLabelText("Case"), { target: { value: CASE_A } });
    fireEvent.change(screen.getByLabelText("Item number"), { target: { value: "1" } });
    await waitFor(() => expect(optionValues("Slot")).toContain("AM-2"));
    fireEvent.change(screen.getByLabelText("Slot"), { target: { value: "AM-2" } });
    fireEvent.change(screen.getByLabelText("Courtroom"), { target: { value: "COURT-1" } });
    fireEvent.click(screen.getByRole("button", { name: "List case" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/already used/i);
    expect(addCauseListItemMock).not.toHaveBeenCalled();
    // Fix the number -> the configured values are sent exactly as chosen.
    addCauseListItemMock.mockResolvedValue(undefined);
    fireEvent.change(screen.getByLabelText("Item number"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "List case" }));
    await waitFor(() => expect(addCauseListItemMock).toHaveBeenCalledTimes(1));
    expect(addCauseListItemMock).toHaveBeenCalledWith("list-1", expect.objectContaining({ slot: "AM-2", courtroom: "COURT-1", itemNumber: 2 }));
  });

  // Owner decision #33 (GAP-COURT-CAUSE-LIST-03): slots and courtrooms come from the court's own config namespaces.
  describe("slots and courtrooms from per-court config (owner decision #33)", () => {
    it("reads the selected court's slot and courtroom namespaces and offers ONLY those values", async () => {
      fetchConfigNamespaceMock.mockImplementation(async (ns: string) =>
        ns === "cl_slot_11111111111141118111111111111111"
          ? [{ id: "1", namespace: ns, configKey: "MORNING", value: {}, label: null, description: null, active: true, sortOrder: 0, version: 1 },
             { id: "2", namespace: ns, configKey: "AFTERNOON", value: {}, label: null, description: null, active: true, sortOrder: 1, version: 1 }]
          : ns === "cl_room_11111111111141118111111111111111"
            ? [{ id: "3", namespace: ns, configKey: "HALL-A", value: {}, label: "Hall A", description: null, active: true, sortOrder: 0, version: 1 }]
            : []);
      await openListWithItems();
      await waitFor(() => expect(optionValues("Slot")).toEqual(["", "MORNING", "AFTERNOON"]));
      expect(optionValues("Courtroom")).toEqual(["", "HALL-A"]);
      expect(fetchConfigNamespaceMock).toHaveBeenCalledWith("cl_slot_11111111111141118111111111111111");
      expect(fetchConfigNamespaceMock).toHaveBeenCalledWith("cl_room_11111111111141118111111111111111");
    });

    it("a court with no config rows offers the defaults", async () => {
      await openListWithItems();
      await waitFor(() => expect(optionValues("Slot")).toEqual(["", "AM-1", "AM-2", "PM-1", "PM-2"]));
      expect(optionValues("Courtroom")).toEqual(["", "COURT-1"]);
    });

    it("there is no free-text slot or courtroom input any more", async () => {
      await openListWithItems();
      await waitFor(() => expect(optionValues("Slot").length).toBeGreaterThan(1));
      expect((screen.getByLabelText("Slot") as HTMLElement).tagName).toBe("SELECT");
      expect((screen.getByLabelText("Courtroom") as HTMLElement).tagName).toBe("SELECT");
    });

    it("a failed config read says so, offers Retry, and does not let a value be listed", async () => {
      fetchConfigNamespaceMock.mockRejectedValue(new Error("boom"));
      await openListWithItems();
      expect(await screen.findByText(/couldn't load the slots and courtrooms/i)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "List case" })).toBeDisabled();
      fetchConfigNamespaceMock.mockResolvedValue([]);
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
      await waitFor(() => expect(optionValues("Slot")).toContain("AM-1"));
      expect(screen.getByRole("button", { name: "List case" })).toBeEnabled();
    });

    it("requires a slot and a courtroom to be chosen", async () => {
      await openListWithItems();
      await waitFor(() => expect(optionValues("Slot")).toContain("AM-1"));
      fireEvent.change(screen.getByLabelText("Case"), { target: { value: CASE_A } });
      fireEvent.click(screen.getByRole("button", { name: "List case" }));
      expect(screen.getByRole("alert")).toHaveTextContent(/choose a slot and a courtroom/i);
      expect(addCauseListItemMock).not.toHaveBeenCalled();
    });
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

  it("CAUSE-LIST-04: Purpose column shows a humanized label, and an em-dash when absent", async () => {
    fetchCauseListByCourtDateMock.mockResolvedValue({ id: "list-1", courtId: COURT_A, listDate: "2026-02-01" });
    fetchCauseListItemsMock.mockResolvedValue([
      { id: "it1", causeListId: "list-1", caseId: CASE_A, itemNumber: 1, slot: "AM-1", courtroom: "A", listDate: "2026-02-01", purpose: "final_hearing", version: 1 },
      { id: "it2", causeListId: "list-1", caseId: CASE_A, itemNumber: 2, slot: "AM-2", courtroom: "A", listDate: "2026-02-01", purpose: null, version: 1 },
    ]);
    renderConsole();
    fireEvent.change(screen.getByLabelText("Court"), { target: { value: COURT_A } });
    await waitFor(() => expect(screen.getAllByText("Rao v. State")).toHaveLength(2));
    expect(screen.getByRole("columnheader", { name: "Purpose" })).toBeInTheDocument();
    const rows = screen.getAllByText("Rao v. State").map((n) => n.closest("tr") as HTMLElement);
    expect(within(rows[0]).getByText("Final hearing")).toBeInTheDocument();
    const purposeCell = rows[1].querySelector('td[data-label="Purpose"]') as HTMLElement;
    expect(purposeCell.textContent).toBe("—");
  });

  const OTHER = "44444444-4444-4444-8444-444444444444";
  const otherCase: CourtCase = { ...cases[0]!, id: OTHER, title: "Beyond v. Limit", cnrNumber: "RJHC0100000992026" };
  const mkItem = (id: string, caseId: string, n: number) => ({
    id, causeListId: "list-1", caseId, itemNumber: n, slot: "AM-1", courtroom: "A", listDate: "2026-02-01", version: 1,
  });
  async function openList() {
    fetchCauseListByCourtDateMock.mockResolvedValue({ id: "list-1", courtId: COURT_A, listDate: "2026-02-01" });
    renderConsole();
    fireEvent.change(screen.getByLabelText("Court"), { target: { value: COURT_A } });
  }

  it("CAUSE-LIST-04: an item whose case is not in the cases prop gets its title from fetchCase", async () => {
    fetchCauseListItemsMock.mockResolvedValue([mkItem("it9", OTHER, 1)]);
    fetchCaseMock.mockResolvedValue(otherCase);
    await openList();
    await waitFor(() => expect(screen.getByText("Beyond v. Limit")).toBeInTheDocument());
    expect(fetchCaseMock).toHaveBeenCalledWith(OTHER);
  });

  it("CAUSE-LIST-04: a case that is not found leaves em-dashes and is not refetched", async () => {
    fetchCauseListItemsMock.mockResolvedValue([mkItem("it9", OTHER, 1)]);
    fetchCaseMock.mockResolvedValue(null);
    await openList();
    await waitFor(() => expect(fetchCaseMock).toHaveBeenCalledTimes(1));
    const row = (await screen.findAllByRole("row")).find((r) => r.textContent?.includes("AM-1")) as HTMLElement;
    expect(within(row).getAllByText("—").length).toBeGreaterThanOrEqual(2);
    // Re-render and let any timers elapse: a not-found case must never be refetched.
    await new Promise((r) => setTimeout(r, 2500));
    expect(fetchCaseMock).toHaveBeenCalledTimes(1);
  });

  it("CAUSE-LIST-04: fetches each missing case once even when several items share it", async () => {
    fetchCauseListItemsMock.mockResolvedValue([mkItem("a", OTHER, 1), mkItem("b", OTHER, 2)]);
    fetchCaseMock.mockResolvedValue(otherCase);
    await openList();
    await waitFor(() => expect(screen.getAllByText("Beyond v. Limit")).toHaveLength(2));
    expect(fetchCaseMock).toHaveBeenCalledTimes(1);
  });

  it("CAUSE-LIST-04: a transient fetch failure is retried and then resolves", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      fetchCauseListItemsMock.mockResolvedValue([mkItem("it9", OTHER, 1)]);
      fetchCaseMock.mockRejectedValueOnce(new Error("boom")).mockResolvedValue(otherCase);
      await openList();
      await waitFor(() => expect(fetchCaseMock).toHaveBeenCalledTimes(1));
      await vi.advanceTimersByTimeAsync(1500);
      await waitFor(() => expect(screen.getByText("Beyond v. Limit")).toBeInTheDocument());
      expect(fetchCaseMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("CAUSE-LIST-04: never runs more than 5 case fetches at once", async () => {
    const ids = Array.from({ length: 12 }, (_, i) => `55555555-5555-4555-8555-5555555555${String(i).padStart(2, "0")}`);
    fetchCauseListItemsMock.mockResolvedValue(ids.map((id, i) => mkItem(`i${i}`, id, i + 1)));
    let inflight = 0;
    let peak = 0;
    fetchCaseMock.mockImplementation(async () => {
      inflight++;
      peak = Math.max(peak, inflight);
      await new Promise((r) => setTimeout(r, 5));
      inflight--;
      return null;
    });
    await openList();
    await waitFor(() => expect(fetchCaseMock).toHaveBeenCalledTimes(12));
    expect(peak).toBeLessThanOrEqual(5);
  });

  it("CAUSE-LIST-04: retries stop after 2 failed retries (3 calls total)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      fetchCauseListItemsMock.mockResolvedValue([mkItem("it9", OTHER, 1)]);
      fetchCaseMock.mockRejectedValue(new Error("boom"));
      await openList();
      await waitFor(() => expect(fetchCaseMock).toHaveBeenCalledTimes(1));
      await vi.advanceTimersByTimeAsync(10_000);
      await waitFor(() => expect(fetchCaseMock).toHaveBeenCalledTimes(3));
      await vi.advanceTimersByTimeAsync(30_000);
      expect(fetchCaseMock).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("CAUSE-LIST-04: unmounting with a retry timer pending causes no further fetch or error", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      fetchCauseListItemsMock.mockResolvedValue([mkItem("it9", OTHER, 1)]);
      fetchCaseMock.mockRejectedValue(new Error("boom"));
      fetchCauseListByCourtDateMock.mockResolvedValue({ id: "list-1", courtId: COURT_A, listDate: "2026-02-01" });
      const { unmount } = renderConsole();
      fireEvent.change(screen.getByLabelText("Court"), { target: { value: COURT_A } });
      await waitFor(() => expect(fetchCaseMock).toHaveBeenCalledTimes(1));
      errSpy.mockClear();
      unmount();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(fetchCaseMock).toHaveBeenCalledTimes(1);
      expect(errSpy).not.toHaveBeenCalled();
    } finally {
      errSpy.mockRestore();
      vi.useRealTimers();
    }
  });
});
