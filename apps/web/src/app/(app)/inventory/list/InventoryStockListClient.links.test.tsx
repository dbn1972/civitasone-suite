import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
const { InventoryStockListClient } = await import("./InventoryStockListClient");

const ITEMS = [
  { id: "s1", itemCode: "pen-01", name: "Gel Pen Blue", category: "Stationery", unit: "EA", currentStock: 15, minStockLevel: 5, totalValue: 8000, isLowStock: false },
  { id: "s3", itemCode: "STAP-1", name: "Heavy Stapler", category: "Stationery", unit: "EA", currentStock: 2, minStockLevel: 5, totalValue: 400, isLowStock: true },
];
const show = (linked: string[] | null) =>
  render(<NextIntlClientProvider locale="en" messages={enMessages}><InventoryStockListClient items={ITEMS} linkedStockIds={linked} /></NextIntlClientProvider>);

describe("stock register: linked badge, unlinked items shown clearly", () => {
  it("marks linked items 'Linked' and the rest 'Not linked'", () => {
    show(["s1"]);
    expect(screen.getAllByText("Linked")).toHaveLength(1);
    expect(screen.getAllByText("Not linked")).toHaveLength(1);
    expect(screen.getByText("Stock link")).toBeInTheDocument();
  });

  it("claims nothing either way when the links could not be loaded", () => {
    show(null);
    expect(screen.queryByText("Linked")).not.toBeInTheDocument();
    expect(screen.queryByText("Not linked")).not.toBeInTheDocument();
    expect(screen.getAllByText("Link status unavailable")).toHaveLength(2);
  });

  it("has the single item finder over both masters", () => {
    show(["s1"]);
    expect(screen.getByLabelText("Find an item")).toBeInTheDocument();
  });
});
