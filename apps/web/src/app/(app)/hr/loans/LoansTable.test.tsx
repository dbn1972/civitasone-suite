import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
import { LoansTable } from "./LoansTable";

const fetchMock = vi.fn();
const rows = [
  { id: "1", employee: "Asha", status: "active" },
  { id: "2", employee: "Ravi", status: "active" },
];
const columns = [{ key: "employee" as const, label: "Employee" }, { key: "status" as const, label: "Status" }];

function setup() {
  vi.stubGlobal("fetch", fetchMock);
  URL.createObjectURL = vi.fn(() => "blob:x");
  URL.revokeObjectURL = vi.fn();
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <LoansTable columns={columns} rows={rows} exportable />
    </NextIntlClientProvider>,
  );
}

// GAP-HR-LOANS-02
describe("LoansTable CSV export", () => {
  beforeEach(() => { fetchMock.mockReset(); fetchMock.mockResolvedValue(new Response("{}", { status: 202 })); });

  it("warns first, then records the export in the audit trail with the row count", async () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: /CSV/ }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText("Export loan data?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/proxy/v1/hrms/loans/export-audit");
    expect(JSON.parse(init.body)).toEqual({ rowCount: 2 });
  });

  it("does not record anything if the user cancels the warning", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: /CSV/ }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
