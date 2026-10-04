import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

vi.mock("@/lib/sync/resource", () => ({
  useSeededResource: (_k: string, initial: unknown[]) => ({ data: initial, fromCache: false, offline: false, cachedAt: null, provenance: "live" }),
}));
const { ItemsTable } = await import("./ItemsTable");

const row = (id: string, name: string) => ({ id, sku: id.toUpperCase(), name, status: "active", category: null, uom: "EA", itemType: "consumable", reorderLevel: 1, reorderQty: 1, unitCostMinor: "100" });
const ITEMS = [row("i1", "Gel Pen"), row("i2", "Ink Bottle")];
const show = (linked: string[] | null) =>
  render(<NextIntlClientProvider locale="en" messages={enMessages}><ItemsTable items={ITEMS} linkedItemIds={linked} /></NextIntlClientProvider>);

describe("item master link-status column filters on the badge text, not the uuid", () => {
  it("typing 'Not linked' keeps only the unlinked item", () => {
    show(["i1"]);
    fireEvent.change(screen.getByPlaceholderText("Filter items…"), { target: { value: "not linked" } });
    expect(screen.getByText("Ink Bottle")).toBeInTheDocument();
    expect(screen.queryByText("Gel Pen")).not.toBeInTheDocument();
  });

  it("badges read Linked / Not linked, and 'unavailable' when links could not be loaded", () => {
    const { unmount } = show(["i1"]);
    expect(screen.getAllByText("Linked")).toHaveLength(1);
    unmount();
    show(null);
    expect(screen.getAllByText("Link status unavailable")).toHaveLength(2);
  });
});
