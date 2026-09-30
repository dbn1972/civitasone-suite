import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { DesignationsTable } from "./DesignationsTable";

const ITEMS = [{ id: "d1", code: "SO", name: "Section Officer", level: 7, payGrade: "PB-2" }];

function renderTable() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <DesignationsTable items={ITEMS} canEdit={true} />
    </NextIntlClientProvider>,
  );
}

/**
 * UX-016: both save and delete used to throw a hardcoded "Save failed" /
 * "Delete failed" literal regardless of what the backend actually said —
 * the same class of leak useFormError closes fleet-wide (UX-003).
 */
describe("DesignationsTable — UX-016 clerk-safe errors", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("shows a clerk-safe message, never the generic 'Save failed' literal, when saving fails", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 500 }));
    renderTable();

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(screen.getByText(/couldn't save/i)).toBeInTheDocument());
    expect(screen.queryByText(/^Save failed/)).not.toBeInTheDocument();
  });

  it("shows a clerk-safe message, never the generic 'Delete failed' literal, when deleting fails", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 500 }));
    renderTable();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(await screen.findByRole("button", { name: /delete designation/i }));

    await waitFor(() => expect(screen.getByRole("alertdialog")).toHaveTextContent(/couldn't save/i));
    expect(screen.getByRole("alertdialog").textContent).not.toMatch(/^Delete failed/);
  });
});

/**
 * GAP-HR-DESIGNATIONS-01: the inline edit path used to accept any level >= 1
 * with no upper bound (a level of 40 saved and rendered as an unclassifiable
 * "—" everywhere) — now bounded to 1-18, same rule as the create form and
 * hrms-service's createDesignationBody.
 */
describe("DesignationsTable — GAP-HR-DESIGNATIONS-01 pay level bounded 1-18", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("rejects an edited level above 18 and never calls the API", async () => {
    renderTable();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText(/pay level/i), { target: { value: "40" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    expect(await screen.findByText(/between 1 and 18/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts an edited level at the top of the real range (18) and shows it classified as Group A", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 200 }));
    renderTable();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText(/pay level/i), { target: { value: "18" } });

    // Live-computed Service Group preview while editing (no more "computed
    // on save" placeholder — it's shown immediately, same function as the
    // read-only row and Step2 use).
    expect(screen.getByText("Group-A")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });
});
