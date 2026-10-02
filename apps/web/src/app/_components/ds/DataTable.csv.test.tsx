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
