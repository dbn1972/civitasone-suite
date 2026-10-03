import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
vi.mock("@/app/_components/ds", async () => {
  const actual = await vi.importActual<typeof import("@/app/_components/ds")>("@/app/_components/ds");
  return { ...actual, useToast: () => ({ toast }) };
});

const { ItemLinkActions } = await import("./ItemLinkActions");

const fetchMock = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
});

const LINK = { id: "l1", inventoryItemId: "i1", stockItemId: "s1", stockItemCode: "PEN-01", stockItemName: "Gel Pen Blue", source: "manual" as const, linkedBy: "u", linkedAt: "2026-10-03T00:00:00Z" };
const SUGGESTION = { stockItemId: "s9", stockItemCode: "PAPER-A", stockItemName: "A4 Paper Ream" };

const wrap = (ui: React.ReactElement) => <NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>;

describe("ItemLinkActions: confirming the exact-code suggestion", () => {
  it("POSTs the pair as 'suggested' with an x-idempotency-key, announces success, and refreshes later", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fetchMock.mockResolvedValue(new Response("{}", { status: 202 }));
    render(wrap(<ItemLinkActions inventoryItemId="i1" link={null} suggestion={SUGGESTION} />));
    expect(screen.getByText(/PAPER-A · A4 Paper Ream/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirm link" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Link submitted. It will appear here in a moment."));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/proxy/v1/inventory/item-links");
    expect(init.method).toBe("POST");
    expect(init.headers["x-idempotency-key"]).toMatch(/\S+/);
    expect(JSON.parse(init.body)).toEqual({ inventoryItemId: "i1", stockItemId: "s9", source: "suggested" });
    vi.advanceTimersByTime(1000);
    expect(refresh).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("a 409 shows a plain message, never the JSON body or the status code, and does not refresh", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ code: "STOCK_ITEM_ALREADY_LINKED", message: "this stock item is already linked to an inventory item" }), { status: 409 }));
    render(wrap(<ItemLinkActions inventoryItemId="i1" link={null} suggestion={SUGGESTION} />));
    fireEvent.click(screen.getByRole("button", { name: "Confirm link" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).not.toMatch(/409|STOCK_ITEM_ALREADY_LINKED|\{/);
    expect(alert.textContent!.length).toBeGreaterThan(5);
    expect(toast.success).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("offers no suggestion block when there is none, and the manual Link button starts disabled", () => {
    render(wrap(<ItemLinkActions inventoryItemId="i1" link={null} suggestion={null} />));
    expect(screen.queryByText("Suggested match (same code)")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Link items" })).toBeDisabled();
  });
});

describe("ItemLinkActions: removing a link", () => {
  it("asks first, says both records are kept, and DELETEs the link id", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 202 }));
    render(wrap(<ItemLinkActions inventoryItemId="i1" link={LINK} suggestion={null} />));
    fireEvent.click(screen.getByRole("button", { name: "Remove link" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Both records are kept exactly as they are");
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === "Remove link")!);
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Link removal submitted."));
    expect(fetchMock.mock.calls[0][0]).toBe("/api/proxy/v1/inventory/item-links/l1");
    expect(fetchMock.mock.calls[0][1].method).toBe("DELETE");
  });
});
