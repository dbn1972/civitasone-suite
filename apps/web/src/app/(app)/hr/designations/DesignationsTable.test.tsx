import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
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

/**
 * GAP-HR-DESIGNATIONS-04: clearing Pay Level used to silently become 0 with
 * no indication, and clearing Pay Grade sent an empty string (stored as
 * literal "", distinct from a never-set NULL) instead of actually clearing
 * the field.
 */
describe("DesignationsTable — GAP-HR-DESIGNATIONS-04 level/payGrade edit integrity", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("shows a hint while editing and saves a cleared level as 0 (unclassified), not silently", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 200 }));
    renderTable();
    fireEvent.click(screen.getByRole("button", { name: /^edit/i }));
    expect(screen.getByText(/blank clears the level/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/pay level/i), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string) as Record<string, unknown>;
    expect(body.level).toBe(0);
  });

  it("sends payGrade as null (not an empty string) when the field is cleared", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 200 }));
    renderTable();
    fireEvent.click(screen.getByRole("button", { name: /^edit/i }));
    fireEvent.change(screen.getByLabelText(/pay grade/i), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string) as Record<string, unknown>;
    expect(body.payGrade).toBeNull();
  });
});

/**
 * GAP-HR-DESIGNATIONS-03: the hand-built <table> had no sort, filter or
 * pagination; this verifies the ds DataTable migration actually wired all
 * three up (not just swapped markup).
 */
describe("DesignationsTable — GAP-HR-DESIGNATIONS-03 DataTable migration (sort/filter/pagination)", () => {
  const MANY = Array.from({ length: 16 }, (_, i) => ({
    id: `d${i}`,
    code: `C${String(i).padStart(2, "0")}`,
    name: `Designation ${String(i).padStart(2, "0")}`,
    level: (i % 18) + 1,
    payGrade: null,
  }));

  function renderMany() {
    return render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <DesignationsTable items={MANY} canEdit={false} />
      </NextIntlClientProvider>,
    );
  }

  it("paginates at 15 rows per page", () => {
    renderMany();
    expect(screen.getByText("Designation 00")).toBeInTheDocument();
    expect(screen.queryByText("Designation 15")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    expect(screen.getByText("Designation 15")).toBeInTheDocument();
  });

  it("filters rows by the search box", () => {
    renderMany();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Designation 07" } });
    expect(screen.getByText("Designation 07")).toBeInTheDocument();
    expect(screen.queryByText("Designation 00")).not.toBeInTheDocument();
  });

  it("sorts descending by Code on a second header click, moving the last row onto page 1", () => {
    renderMany();
    const codeHeader = screen.getByRole("columnheader", { name: /code/i });
    fireEvent.click(codeHeader); // ascending (already the default order)
    fireEvent.click(codeHeader); // descending
    expect(screen.getByText("Designation 15")).toBeInTheDocument();
    expect(screen.queryByText("Designation 00")).not.toBeInTheDocument();
  });
});

/**
 * GAP-HR-DESIGNATIONS-01 (fix step 4): Service Group is derived from the pay
 * level in the browser (apps/web/src/lib/payLevels.ts), not stored on the
 * designation, and HR has not signed the mapping off -- so it must read as
 * "indicative" and cover every level 1-18 consistently.
 */
describe("DesignationsTable — GAP-HR-DESIGNATIONS-01 Service Group is labelled indicative", () => {
  const LEVEL_ITEMS = [
    { id: "d16", code: "JS", name: "Joint Secretary", level: 16, payGrade: null },
    { id: "d3", code: "MTS", name: "Multi Tasking Staff", level: 3, payGrade: null },
    { id: "d0", code: "UNK", name: "Unclassified Post", level: 0, payGrade: null },
  ];

  function renderLevels() {
    return render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <DesignationsTable items={LEVEL_ITEMS} canEdit={false} />
      </NextIntlClientProvider>,
    );
  }

  it("labels the column header 'Service Group (indicative)' and has no Grade Pay column", () => {
    renderLevels();
    expect(screen.getByRole("columnheader", { name: /Service Group \(indicative\)/ })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: /Grade Pay/i })).not.toBeInTheDocument();
  });

  it("explains under the table that the group is derived from the pay level, with the bands it uses", () => {
    renderLevels();
    expect(screen.getByText(/Service Group is indicative only/)).toHaveTextContent(
      "derived from the pay level (Group-C 1\u20135 \u00b7 Group-B 6\u20139 \u00b7 Group-A 10\u201318) and is not stored on the designation",
    );
  });

  it("classifies the top levels too (level 16 -> Group-A) and shows a dash, not a guess, for an unclassified level", () => {
    renderLevels();
    const row16 = screen.getByText("Joint Secretary").closest("tr");
    expect(row16).not.toBeNull();
    expect(within(row16 as HTMLElement).getByText("Group-A")).toBeInTheDocument();
    const row3 = screen.getByText("Multi Tasking Staff").closest("tr");
    expect(within(row3 as HTMLElement).getByText("Group-C")).toBeInTheDocument();
    const row0 = screen.getByText("Unclassified Post").closest("tr");
    expect(within(row0 as HTMLElement).queryByText(/Group-/)).not.toBeInTheDocument();
  });

  it("marks each classified badge as indicative in its tooltip", () => {
    renderLevels();
    expect(screen.getAllByTitle(/Indicative: derived from the pay level/).length).toBe(2);
  });
});

/**
 * GAP-HR-DESIGNATIONS-02 (fix step 4): the list now carries a per-row
 * usageCount (admins only), and a designation that is still referenced says so
 * up front instead of offering a Delete dialog that can only 409.
 * aria-disabled (not `disabled`) keeps the button focusable so a keyboard or
 * screen-reader user reaches it and hears why via aria-describedby.
 */
describe("DesignationsTable — GAP-HR-DESIGNATIONS-02 in-use designations", () => {
  const IN_USE = [{ id: "d1", code: "SO", name: "Section Officer", level: 7, payGrade: "PB-2", usageCount: 3 }];
  const FREE = [{ id: "d2", code: "CLK", name: "Clerk", level: 2, payGrade: null, usageCount: 0 }];

  function renderItems(items: Array<Record<string, unknown>>) {
    return render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <DesignationsTable items={items as any} canEdit={true} />
      </NextIntlClientProvider>,
    );
  }

  it("marks Delete aria-disabled with the reason as its description when the designation is in use", () => {
    renderItems(IN_USE);
    const del = screen.getByRole("button", { name: "Delete Section Officer" });
    expect(del).toHaveAttribute("aria-disabled", "true");
    expect(del).not.toBeDisabled();
    expect(del).toHaveAccessibleDescription(/in use by 3 records/i);
  });

  it("does not open the delete dialog for an in-use designation", () => {
    renderItems(IN_USE);
    fireEvent.click(screen.getByRole("button", { name: "Delete Section Officer" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("uses the singular for exactly one reference", () => {
    renderItems([{ ...IN_USE[0], usageCount: 1 }]);
    expect(screen.getByRole("button", { name: "Delete Section Officer" })).toHaveAccessibleDescription(/in use by 1 record\b/i);
  });

  it("leaves Delete fully usable for an unreferenced designation", () => {
    renderItems(FREE);
    const del = screen.getByRole("button", { name: "Delete Clerk" });
    expect(del).not.toHaveAttribute("aria-disabled");
    expect(del).not.toHaveAttribute("aria-describedby");
    fireEvent.click(del);
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("does not treat a missing usageCount as zero-and-safe or as in-use: Delete stays available and the API's 409 remains the backstop", () => {
    renderItems([{ id: "d3", code: "X", name: "Unknown Usage", level: 1, payGrade: null }]);
    const del = screen.getByRole("button", { name: "Delete Unknown Usage" });
    expect(del).not.toHaveAttribute("aria-disabled");
  });
});

/**
 * GAP-HR-DESIGNATIONS-NEW-03: the edit row's "Blank clears the level" hint is
 * announced when the Pay Level box takes focus, and there is an explicit
 * "Clear level" action for what a blank box means.
 */
describe("DesignationsTable — GAP-HR-DESIGNATIONS-NEW-03 edit-row level hint and Clear level", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("announces the hint as the Pay Level input's accessible description", () => {
    renderTable();
    fireEvent.click(screen.getByRole("button", { name: /^edit/i }));
    expect(screen.getByLabelText(/pay level/i)).toHaveAccessibleDescription(/blank clears the level/i);
  });

  it("'Clear level' empties the box, keeps focus on it, and saves the level as 0 (unclassified)", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 200 }));
    renderTable();
    fireEvent.click(screen.getByRole("button", { name: /^edit/i }));
    const level = screen.getByLabelText(/pay level/i) as HTMLInputElement;
    expect(level.value).toBe("7");

    fireEvent.click(screen.getByRole("button", { name: "Clear level" }));
    expect(level.value).toBe("");
    expect(level).toHaveFocus();
    expect(screen.getByRole("button", { name: "Clear level" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string) as Record<string, unknown>;
    expect(body.level).toBe(0);
  });
});
