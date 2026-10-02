import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const { CycleCountActions } = await import("./CycleCountActions");

const fetchMock = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
});

async function approve() {
  render(<CycleCountActions cycleCountId="cc-1" version={4} />);
  fireEvent.click(screen.getByRole("button", { name: "Approve" }));
  const dialog = await screen.findByRole("alertdialog");
  const confirm = Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === "Approve")!;
  fireEvent.click(confirm);
  return dialog;
}

describe("CycleCountActions failure handling (GAP-INVENTORY-CYCLE-COUNTS-DETAIL-04)", () => {
  it("a 409 shows the friendly message, never the JSON body, and refreshes the page", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ code: "VERSION_CONFLICT", message: "raw" }), { status: 409 }));
    const dialog = await approve();
    await waitFor(() => expect(dialog).toHaveTextContent("Someone else already decided this cycle count."));
    expect(dialog.textContent).not.toMatch(/VERSION_CONFLICT|raw/);
    expect(refresh).toHaveBeenCalled();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({ version: 4 });
  });

  it("a 500 shows a generic message and does not refresh", async () => {
    fetchMock.mockResolvedValue(new Response("boom internal", { status: 500 }));
    const dialog = await approve();
    await waitFor(() => expect(dialog).toHaveTextContent(/couldn.t save/i));
    expect(dialog.textContent).not.toMatch(/boom internal/);
    expect(refresh).not.toHaveBeenCalled();
  });
});
