import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";

/**
 * GAP-HR-HOLIDAYS-04 (type / applicable-to cells translated, incl. Hindi) and
 * GAP-HR-HOLIDAYS-06 (admin-only Delete column, confirm dialog, honest
 * "deletion submitted" cue for the queued write).
 */
const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { HolidaysTableClient } from "./HolidaysTableClient";
import type { Row } from "./page";

const ROWS: Row[] = [
  { id: "h-1", date: "2027-01-26", day: "Tuesday", name: "Republic Day", type: "gazetted", applicableTo: "all" },
  { id: "h-2", date: "2027-03-23", day: "Tuesday", name: "Holi", type: "restricted", applicableTo: "Field offices" },
  { id: "h-3", date: "2027-05-01", day: "Saturday", name: "Odd One", type: "mystery", applicableTo: "ALL" },
];

function renderTable(canManage: boolean, locale: "en" | "hi" = "en") {
  const messages = locale === "hi" ? hiMessages : enMessages;
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <HolidaysTableClient rows={ROWS} canManage={canManage} />
    </NextIntlClientProvider>,
  );
}

describe("HolidaysTableClient — GAP-HR-HOLIDAYS-04 translated cells", () => {
  it("English: type and applicable-to cells show labels, not raw API codes", () => {
    renderTable(false);
    expect(screen.getByText("Gazetted")).toBeInTheDocument();
    expect(screen.getByText("Restricted")).toBeInTheDocument();
    // "all" / "ALL" (any casing) -> the translated "All"; free text passes through.
    expect(screen.getAllByText("All")).toHaveLength(2);
    expect(screen.getByText("Field offices")).toBeInTheDocument();
    expect(screen.queryByText("gazetted")).not.toBeInTheDocument();
    expect(screen.queryByText("all")).not.toBeInTheDocument();
    // An unknown type code falls back to the raw value rather than a missing-key string.
    expect(screen.getByText("mystery")).toBeInTheDocument();
  });

  it("Hindi: column headers, type cell and applicable-to cell are all translated", () => {
    renderTable(false, "hi");
    expect(screen.getByText("राजपत्रित")).toBeInTheDocument();
    expect(screen.getByText("प्रतिबंधित")).toBeInTheDocument();
    expect(screen.getAllByText("सभी")).toHaveLength(2);
    expect(screen.getByRole("columnheader", { name: /प्रकार/ })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /लागू/ })).toBeInTheDocument();
    // None of the English labels leaked into the Hindi rendering.
    expect(screen.queryByText("Gazetted")).not.toBeInTheDocument();
    expect(screen.queryByText("Restricted")).not.toBeInTheDocument();
  });
});

describe("HolidaysTableClient — GAP-HR-HOLIDAYS-06 delete action", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    refreshMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("a non-admin (canManage=false) sees no Delete control and no Actions column", () => {
    renderTable(false);
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: /actions/i })).not.toBeInTheDocument();
  });

  it("an admin sees a Delete button on every row", () => {
    renderTable(true);
    expect(screen.getAllByRole("button", { name: "Delete" })).toHaveLength(ROWS.length);
    expect(screen.getByRole("columnheader", { name: /actions/i })).toBeInTheDocument();
  });

  it("asks for confirmation first, then DELETEs that holiday and says the deletion was only submitted", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    renderTable(true);

    fireEvent.click(screen.getAllByRole("button", { name: "Delete" })[0]!);
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Republic Day");
    expect(fetchMock).not.toHaveBeenCalled(); // nothing is sent until confirmed

    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith("/api/proxy/v1/hrms/holidays/h-1", { method: "DELETE" });

    // 204 is "queued", not "gone": the honest cue appears and the row is not hidden optimistically.
    const notice = await screen.findByText(/"Republic Day" deletion submitted/);
    expect(notice).toBeInTheDocument();
    expect(refreshMock).toHaveBeenCalled();
    expect(screen.getByText("Republic Day")).toBeInTheDocument();
  });

  it("a 403 shows a clerk-safe permission message in the dialog and no success cue", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ code: "FORBIDDEN", message: "role hr_x lacks permission" }), { status: 403 }));
    renderTable(true);

    fireEvent.click(screen.getAllByRole("button", { name: "Delete" })[0]!);
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(dialog).toHaveTextContent("You don't have permission to delete holidays."));
    expect(dialog.textContent).not.toMatch(/lacks permission|FORBIDDEN/);
    expect(screen.queryByText(/deletion submitted/)).not.toBeInTheDocument();
  });

  it("Hindi: the confirm dialog and the submitted cue are translated", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    renderTable(true, "hi");

    fireEvent.click(screen.getAllByRole("button", { name: "हटाएँ" })[0]!);
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("क्या यह अवकाश हटाएँ?");
    fireEvent.click(within(dialog).getByRole("button", { name: "हटाएँ" }));

    await screen.findByText(/को हटाने का अनुरोध जमा किया गया/);
  });
});
