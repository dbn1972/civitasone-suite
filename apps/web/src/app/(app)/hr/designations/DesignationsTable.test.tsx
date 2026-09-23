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
