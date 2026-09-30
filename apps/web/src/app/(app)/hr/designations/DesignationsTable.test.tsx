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

    fireEvent.click(screen.getByRole("button", { name: /^edit/i }));
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(screen.getByText(/couldn't save/i)).toBeInTheDocument());
    expect(screen.queryByText(/^Save failed/)).not.toBeInTheDocument();
  });

  it("shows a clerk-safe message, never the generic 'Delete failed' literal, when deleting fails", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 500 }));
    renderTable();

    fireEvent.click(screen.getByRole("button", { name: /^delete/i }));
    fireEvent.click(await screen.findByRole("button", { name: /delete designation/i }));

    await waitFor(() => expect(screen.getByRole("alertdialog")).toHaveTextContent(/couldn't save/i));
    expect(screen.getByRole("alertdialog").textContent).not.toMatch(/^Delete failed/);
  });

  /**
   * GAP-HR-DESIGNATIONS-02: the backend now 409s (DESIGNATION_IN_USE) when
   * employees still hold the designation -- the row must stay and a
   * clerk-safe "still in use" message must reach the confirm dialog, not
   * silently disappear like a successful delete would. Per useFormError's
   * CODE_TO_KIND contract, the backend's own dynamic `message` text (row
   * count etc.) is never echoed verbatim -- the catalogued "conflict" kind
   * copy is what actually renders (see lib/messages.ts, lib/useFormError.ts).
   */
  it("keeps the row and surfaces the catalogued message on a 409 DESIGNATION_IN_USE response", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ code: "DESIGNATION_IN_USE", message: "2 employees still hold this designation — reassign them before deleting it.", count: 2 }), { status: 409 }),
    );
    renderTable();

    fireEvent.click(screen.getByRole("button", { name: /delete section officer/i }));
    fireEvent.click(await screen.findByRole("button", { name: /delete designation/i }));

    await waitFor(() => expect(screen.getByRole("alertdialog")).toHaveTextContent(/still in use elsewhere/i));
    // The backend's own message text is never echoed to the user.
    expect(screen.getByRole("alertdialog").textContent).not.toMatch(/2 employees/i);
    // The row is still in the table (not removed as it would be on success).
    expect(screen.getByText("Section Officer")).toBeInTheDocument();
  });
});

/**
 * GAP-HR-DESIGNATIONS-06: Edit/Delete were unlabelled icon-less text
 * buttons -- every row's pair announced as identical "Edit"/"Delete" to
 * assistive tech, with nothing distinguishing which designation a given
 * button acts on.
 */
describe("DesignationsTable — GAP-HR-DESIGNATIONS-06 per-row accessible names", () => {
  it("gives the Edit and Delete buttons an accessible name that includes the designation", () => {
    renderTable();
    expect(screen.getByRole("button", { name: "Edit Section Officer" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete Section Officer" })).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("button", { name: /^edit/i }));
    fireEvent.change(screen.getByLabelText(/pay level/i), { target: { value: "40" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    expect(await screen.findByText(/between 1 and 18/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts an edited level at the top of the real range (18) and shows it classified as Group A", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 200 }));
    renderTable();
    fireEvent.click(screen.getByRole("button", { name: /^edit/i }));
    fireEvent.change(screen.getByLabelText(/pay level/i), { target: { value: "18" } });

    // Live-computed Service Group preview while editing (no more "computed
    // on save" placeholder — it's shown immediately, same function as the
    // read-only row and Step2 use).
    expect(screen.getByText("Group-A")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });
});
