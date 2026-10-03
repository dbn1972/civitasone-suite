import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DataTable } from "./DataTable";

type Row = { id: string; amountMinor: string; office: string };
const rows: Row[] = [{ id: "r1", amountMinor: "125000000", office: "Unknown office" }];

// GAP-FINANCE-BUDGET-FUND-RELEASES-04: machine-usable CSV, opt-in so the other
// ~80 exports keep today's format.
async function exportedCsv(ui: React.ReactElement): Promise<string> {
  const blobs: Blob[] = [];
  URL.createObjectURL = vi.fn((b: Blob) => { blobs.push(b); return "blob:mock"; });
  URL.revokeObjectURL = vi.fn();
  render(ui);
  fireEvent.click(screen.getByText("⬇ CSV"));
  await waitFor(() => expect(blobs.length).toBe(1));
  return await new Promise<string>((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(fr.error);
    fr.readAsText(blobs[0]);
  });
}

describe("DataTable CSV export", () => {
  afterEach(() => vi.restoreAllMocks());

  it("default: amount columns keep the on-screen formatMoney text (unchanged for existing callers)", async () => {
    const csv = await exportedCsv(
      <DataTable<Row> columns={[{ key: "amountMinor", label: "Amount", cellType: "amount" }]} rows={rows} exportable />,
    );
    expect(csv.split("\n")[1]).toBe('"₹12,50,000.00"');
  });

  it("csvPlainAmounts: amount columns export a plain decimal rupee number", async () => {
    const csv = await exportedCsv(
      <DataTable<Row> columns={[{ key: "amountMinor", label: "Amount", cellType: "amount" }]} rows={rows} exportable csvPlainAmounts />,
    );
    expect(csv.split("\n")[1]).toBe("1250000.00");
  });

  it("csvPlainAmounts: an invalid amount exports blank, never NaN/junk", async () => {
    const csv = await exportedCsv(
      <DataTable<Row> columns={[{ key: "amountMinor", label: "Amount", cellType: "amount" }]} rows={[{ id: "x", amountMinor: "abc", office: "" }]} exportable csvPlainAmounts />,
    );
    expect(csv.split("\n")[1]).toBe("");
  });

  it("column.csv overrides the displayed value in the export only", async () => {
    const csv = await exportedCsv(
      <DataTable<Row>
        columns={[{ key: "office", label: "Office", render: (r) => <span>{r.office}</span>, csv: () => "9b2f7c1e-full-id" }]}
        rows={rows}
        exportable
      />,
    );
    expect(screen.getByText("Unknown office")).toBeInTheDocument();
    expect(csv.split("\n")[1]).toBe("9b2f7c1e-full-id");
  });
});

describe("DataTable exportGuard (fail-closed export)", () => {
  afterEach(() => vi.restoreAllMocks());
  const cols = [{ key: "office" as const, label: "Office" }];

  it("awaits the guard, then downloads when it says ok", async () => {
    const order: string[] = [];
    const guard = vi.fn(async (info: { rowCount: number; filter: string }) => { order.push(`guard:${info.rowCount}`); return { ok: true as const }; });
    URL.createObjectURL = vi.fn(() => { order.push("file"); return "blob:x"; }); URL.revokeObjectURL = vi.fn();
    render(<DataTable<Row> columns={cols} rows={rows} exportable exportGuard={guard} />);
    fireEvent.click(screen.getByText("⬇ CSV"));
    await waitFor(() => expect(order).toEqual(["guard:1", "file"]));
  });

  it("builds NO file and shows the guard's message when it says not ok", async () => {
    const made = vi.fn(() => "blob:x");
    URL.createObjectURL = made; URL.revokeObjectURL = vi.fn();
    render(<DataTable<Row> columns={cols} rows={rows} exportable exportGuard={async () => ({ ok: false as const, message: "Could not record this export." })} />);
    fireEvent.click(screen.getByText("⬇ CSV"));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Could not record this export."));
    expect(made).not.toHaveBeenCalled();
  });

  it("a guard that throws is treated as not ok", async () => {
    const made = vi.fn(() => "blob:x");
    URL.createObjectURL = made; URL.revokeObjectURL = vi.fn();
    render(<DataTable<Row> columns={cols} rows={rows} exportable exportGuard={async () => { throw new Error("boom"); }} />);
    fireEvent.click(screen.getByText("⬇ CSV"));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(made).not.toHaveBeenCalled();
  });
});
