import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";
import { ItemPicker } from "./ItemPicker";
import type { PickerEntry } from "@/app/(app)/inventory/linkHelpers";

const LINKED: PickerEntry = { key: "i1", kind: "linked", inventoryItemId: "i1", stockItemId: "s1", code: "PEN-01", name: "Gel Pen", stockCode: "pen-01" };
const INV_ONLY: PickerEntry = { key: "i2", kind: "inventory_only", inventoryItemId: "i2", stockItemId: null, code: "INK-9", name: "Ink Bottle", stockCode: null };
const STOCK_ONLY: PickerEntry = { key: "s3", kind: "stock_only", inventoryItemId: null, stockItemId: "s3", code: "STAP-1", name: "Stapler", stockCode: "STAP-1" };

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function Harness({ onPick, locale = "en", ...rest }: { onPick: (e: PickerEntry | null) => void; locale?: "en" | "hi" } & Partial<React.ComponentProps<typeof ItemPicker>>) {
  const [value, setValue] = useState<string | null>(null);
  return (
    <NextIntlClientProvider locale={locale} messages={locale === "hi" ? hiMessages : enMessages}>
      <ItemPicker value={value} onChange={(e) => { setValue(e?.key ?? null); onPick(e); }} {...rest} />
    </NextIntlClientProvider>
  );
}

const respond = (entries: PickerEntry[]) => fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: entries }), { status: 200 }));

describe("ItemPicker: one picker over both masters", () => {
  it("shows a linked pair ONCE, labelled as linked, and labels one-sided items as such", async () => {
    respond([LINKED, INV_ONLY, STOCK_ONLY]);
    render(<Harness onPick={vi.fn()} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "pen" } });
    expect(await screen.findByText("PEN-01 · Gel Pen")).toBeInTheDocument();
    expect(screen.getAllByText("PEN-01 · Gel Pen")).toHaveLength(1);
    expect(screen.getByText("Linked item")).toBeInTheDocument();
    expect(screen.getByText("Item master only, not linked to stock")).toBeInTheDocument();
    expect(screen.getByText("Stock register only, not linked")).toBeInTheDocument();
  });

  it("hands the whole entry to onChange, so a caller can use either side", async () => {
    respond([LINKED]);
    const onPick = vi.fn();
    render(<Harness onPick={onPick} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "pen" } });
    fireEvent.mouseDown(await screen.findByText("PEN-01 · Gel Pen"));
    await waitFor(() => expect(onPick).toHaveBeenCalledWith(LINKED));
    expect(onPick.mock.calls[0][0].stockItemId).toBe("s1");
  });

  it("asks the server for masters=stock when told to, and kinds hides everything else", async () => {
    respond([LINKED, INV_ONLY, STOCK_ONLY]);
    render(<Harness onPick={vi.fn()} masters="stock" kinds={["stock_only"]} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "s" } });
    expect(await screen.findByText("STAP-1 · Stapler")).toBeInTheDocument();
    expect(screen.queryByText("PEN-01 · Gel Pen")).not.toBeInTheDocument();
    expect(screen.queryByText("INK-9 · Ink Bottle")).not.toBeInTheDocument();
    expect(String(fetchMock.mock.calls[0][0])).toContain("masters=stock");
  });

  it("says so when nothing matches", async () => {
    respond([]);
    render(<Harness onPick={vi.fn()} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "zzz" } });
    expect(await screen.findByText("No matching items")).toBeInTheDocument();
  });

  it("renders in Hindi, and the Clear button resets the selection", async () => {
    respond([LINKED]);
    const onPick = vi.fn();
    render(<Harness onPick={onPick} locale="hi" clearable />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "pen" } });
    expect(await screen.findByText("जुड़ा हुआ आइटम")).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByText("PEN-01 · Gel Pen"));
    fireEvent.click(await screen.findByRole("button", { name: "चुना हुआ आइटम हटाएँ" }));
    expect(onPick).toHaveBeenLastCalledWith(null);
  });
});
