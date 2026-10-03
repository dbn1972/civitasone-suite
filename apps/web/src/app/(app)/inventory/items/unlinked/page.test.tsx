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
const data = vi.hoisted(() => ({ getUnmatchedReport: vi.fn(), getLinkSuggestions: vi.fn() }));
vi.mock("../../_dataLinks", () => data);
const auth = vi.hoisted(() => ({ getSessionRoles: vi.fn(() => ["inventory_admin"]) }));
vi.mock("@/lib/auth/roleGuard", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/auth/roleGuard")>()), ...auth }));

const { default: Page } = await import("./page");

const REPORT = {
  inventoryOnly: [{ id: "i2", name: "Ink Bottle", sku: "INK-9", hasSuggestion: false }, { id: "i3", name: "A4 Paper", sku: "PAPER-A", hasSuggestion: true }],
  stockOnly: [{ id: "s3", code: "STAP-1", name: "Heavy Stapler", hasSuggestion: false }],
  counts: { inventoryTotal: 3, inventoryLinked: 1, inventoryUnlinked: 2, stockTotal: 3, stockLinked: 1, stockUnlinked: 2, suggestions: 1, ambiguous: 0 },
  stockAvailable: true, truncated: false,
};
const SUGGESTIONS = { rows: [{ inventoryItemId: "i3", inventoryName: "A4 Paper", sku: "PAPER-A", stockItemId: "s8", stockName: "A4 Paper Ream", stockCode: "paper-a" }], ambiguous: 0 };

const fetchMock = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  auth.getSessionRoles.mockReturnValue(["inventory_admin"]);
  data.getUnmatchedReport.mockResolvedValue({ source: "api", data: REPORT });
  data.getLinkSuggestions.mockResolvedValue({ source: "api", data: SUGGESTIONS });
});

async function show() {
  render(<NextIntlClientProvider locale="en" messages={enMessages}>{await Page()}</NextIntlClientProvider>);
}

describe("unlinked items report (admin)", () => {
  it("is for link admins only", async () => {
    auth.getSessionRoles.mockReturnValue(["inventory_user"]);
    await show();
    expect(screen.getByText(/do not have permission to review or change item links/)).toBeInTheDocument();
    expect(data.getUnmatchedReport).not.toHaveBeenCalled();
  });

  it("lists items that exist on one side only, with counts, and links each to its page", async () => {
    await show();
    expect(screen.getByRole("link", { name: "Ink Bottle" })).toHaveAttribute("href", "/inventory/items/i2");
    expect(screen.getByRole("link", { name: "Heavy Stapler" })).toHaveAttribute("href", "/inventory/s3");
    expect(screen.getByText("Not linked to stock")).toBeInTheDocument();
    expect(screen.getByText("Exact code matches to confirm")).toBeInTheDocument();
  });

  it("confirming a suggested pair POSTs it as 'suggested'", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 202 }));
    await show();
    fireEvent.click(screen.getByRole("button", { name: "Confirm link" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ inventoryItemId: "i3", stockItemId: "s8", source: "suggested" });
  });

  it("with the stock register down, only the item master side is listed and the page says so", async () => {
    data.getUnmatchedReport.mockResolvedValue({ source: "api", data: { ...REPORT, stockOnly: null, stockAvailable: false, counts: { ...REPORT.counts, stockTotal: null, stockLinked: null, stockUnlinked: null } } });
    await show();
    expect(screen.getByText(/The stock register could not be read/)).toBeInTheDocument();
    expect(screen.queryByText("Stock register items with no item master link")).not.toBeInTheDocument();
    expect(screen.getByText("Ink Bottle")).toBeInTheDocument();
  });

  it("a failed report is an error state, not 'everything is linked'", async () => {
    data.getUnmatchedReport.mockResolvedValue({ source: "error", status: 502, data: null });
    await show();
    expect(screen.queryByText("Every item master item is linked to a stock register item.")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("a failed suggestions read shows a retry notice in that card only", async () => {
    data.getLinkSuggestions.mockResolvedValue({ source: "error", status: 503, data: { rows: [], ambiguous: 0 } });
    await show();
    expect(screen.queryByText("No exact code matches are waiting to be confirmed.")).not.toBeInTheDocument();
    expect(screen.getByText("Ink Bottle")).toBeInTheDocument();
  });
});
