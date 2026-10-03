import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { DataTable } from "./DataTable";

type Row = { id: string; cell: unknown };

describe("DataTable: object cell value without render", () => {
  afterEach(() => vi.restoreAllMocks());

  it("warns (dev) naming the column, once, instead of silently printing [object Object]", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const rows: Row[] = [{ id: "1", cell: { a: 1 } }, { id: "2", cell: { b: 2 } }];
    render(<DataTable<Row> columns={[{ key: "id", label: "ID" }, { key: "cell", label: "ObjCol" }]} rows={rows} />);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("ObjCol");
    expect(String(warn.mock.calls[0][0])).toContain("[object Object]");
  });

  it("does not warn for strings, numbers, null or a column with render", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    render(
      <DataTable<Row>
        columns={[{ key: "id", label: "ID2" }, { key: "cell", label: "Cell2", render: () => <b>ok</b> }]}
        rows={[{ id: "1", cell: { a: 1 } }]}
      />,
    );
    render(<DataTable<Row> columns={[{ key: "cell", label: "Plain" }]} rows={[{ id: "1", cell: "text" }, { id: "2", cell: null }, { id: "3", cell: 5 }]} />);
    expect(warn).not.toHaveBeenCalled();
    expect(screen.getByText("text")).toBeInTheDocument();
  });
});
