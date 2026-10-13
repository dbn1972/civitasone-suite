import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DataTable } from "./DataTable";

const okGuard = async () => ({ ok: true as const });
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
      <DataTable<Row> columns={[{ key: "amountMinor", label: "Amount", cellType: "amount" }]} rows={rows} exportable exportGuard={okGuard} />,
    );
    expect(csv.split("\n")[1]).toBe('"₹12,50,000.00"');
  });

  it("csvPlainAmounts: amount columns export a plain decimal rupee number", async () => {
    const csv = await exportedCsv(
      <DataTable<Row> columns={[{ key: "amountMinor", label: "Amount", cellType: "amount" }]} rows={rows} exportable exportGuard={okGuard} csvPlainAmounts />,
    );
    expect(csv.split("\n")[1]).toBe("1250000.00");
  });

  it("csvPlainAmounts: an invalid amount exports blank, never NaN/junk", async () => {
    const csv = await exportedCsv(
      <DataTable<Row> columns={[{ key: "amountMinor", label: "Amount", cellType: "amount" }]} rows={[{ id: "x", amountMinor: "abc", office: "" }]} exportable exportGuard={okGuard} csvPlainAmounts />,
    );
    expect(csv.split("\n")[1]).toBe("");
  });

  it("column.csv overrides the displayed value in the export only", async () => {
    const csv = await exportedCsv(
      <DataTable<Row>
        columns={[{ key: "office", label: "Office", render: (r) => <span>{r.office}</span>, csv: () => "9b2f7c1e-full-id" }]}
        rows={rows}
        exportable
        exportGuard={okGuard}
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

// W1 SF-08: CSV export is default-deny -- permission AND an audit hook are both required.
describe("DataTable default-deny export (permission + audit)", () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  const cols = [{ key: "office" as const, label: "Office" }];
  const okGuard2 = async () => ({ ok: true as const });

  it("shows NO Export button when neither permission nor audit is given", () => {
    render(<DataTable<Row> columns={cols} rows={rows} />);
    expect(screen.queryByText("⬇ CSV")).toBeNull();
  });

  it("shows NO Export button with an audit hook but no permission", () => {
    render(<DataTable<Row> columns={cols} rows={rows} exportGuard={okGuard2} exportAudit="finance/x" />);
    expect(screen.queryByText("⬇ CSV")).toBeNull();
    render(<DataTable<Row> columns={cols} rows={rows} exportable={false} exportGuard={okGuard2} />);
    expect(screen.queryByText("⬇ CSV")).toBeNull();
  });

  it("shows NO Export button with permission but no audit hook (onExport alone does not enable it)", () => {
    render(<DataTable<Row> columns={cols} rows={rows} exportable />);
    expect(screen.queryByText("⬇ CSV")).toBeNull();
    render(<DataTable<Row> columns={cols} rows={rows} exportable onExport={() => undefined} />);
    expect(screen.queryByText("⬇ CSV")).toBeNull();
  });

  it("with permission and the server-safe exportAudit key, the audit POST happens BEFORE the file is built", async () => {
    const order: string[] = [];
    const fetchMock = vi.fn(async (_u: string, init: { body: string }) => { order.push(`audit:${init.body}`); return { ok: true } as Response; });
    vi.stubGlobal("fetch", fetchMock);
    URL.createObjectURL = vi.fn(() => { order.push("file"); return "blob:x"; }); URL.revokeObjectURL = vi.fn();
    render(<DataTable<Row> columns={cols} rows={rows} exportable exportAudit="finance/treasury/cheques" />);
    fireEvent.click(screen.getByText("⬇ CSV"));
    await waitFor(() => expect(order).toHaveLength(2));
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/proxy/v1/admin/table-exports/audit");
    expect(JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body)).toEqual({ resource: "finance/treasury/cheques", rowCount: 1, filtered: false });
    expect(order[1]).toBe("file");
  });

  it("a failed audit response blocks the file and shows the not-recorded message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500 }) as Response));
    const made = vi.fn(() => "blob:x");
    URL.createObjectURL = made; URL.revokeObjectURL = vi.fn();
    render(<DataTable<Row> columns={cols} rows={rows} exportable exportAudit="finance/treasury/cheques" />);
    fireEvent.click(screen.getByText("⬇ CSV"));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/audit trail/i));
    expect(made).not.toHaveBeenCalled();
  });

  it("an unreachable audit endpoint blocks the file", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const made = vi.fn(() => "blob:x");
    URL.createObjectURL = made; URL.revokeObjectURL = vi.fn();
    render(<DataTable<Row> columns={cols} rows={rows} exportable exportAudit="finance/treasury/cheques" />);
    fireEvent.click(screen.getByText("⬇ CSV"));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(made).not.toHaveBeenCalled();
  });

  it("exportRoles: shown only to a signed-in user holding one of the roles", async () => {
    const { resetSessionIdentityCache } = await import("@/lib/auth/useSessionIdentity");
    resetSessionIdentityCache();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ authenticated: true, userId: "u1", roles: ["viewer"] }) }) as unknown as Response));
    const { unmount } = render(<DataTable<Row> columns={cols} rows={rows} exportable exportAudit="a/b" exportRoles={["finance_officer"]} />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText("⬇ CSV")).toBeNull();
    unmount();

    resetSessionIdentityCache();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ authenticated: true, userId: "u1", roles: ["finance_officer"] }) }) as unknown as Response));
    render(<DataTable<Row> columns={cols} rows={rows} exportable exportAudit="a/b" exportRoles={["finance_officer"]} />);
    await waitFor(() => expect(screen.getByText("⬇ CSV")).toBeInTheDocument());
  });
});
