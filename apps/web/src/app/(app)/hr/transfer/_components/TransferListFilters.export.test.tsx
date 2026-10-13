import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { TransferListFilters } from "./TransferListFilters";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/_components/ds/Toast", () => ({ useToast: () => ({ toast: { success: vi.fn(), error: vi.fn() } }) }));

// W1 SF-08: the transfer-order CSV names employees; it is audited BEFORE the file is built (fail-closed).
const transfers = [{ id: "t1", employee: "Ramesh", fromOffice: "A", toOffice: "B", status: "requested" }];
const show = () => render(<NextIntlClientProvider locale="en" messages={enMessages}><TransferListFilters transfers={transfers} /></NextIntlClientProvider>);
const exportBtn = () => screen.getByRole("button", { name: new RegExp(enMessages.transferUi.exportAria.slice(0, 8), "i") });

describe("TransferListFilters CSV export (audit first)", () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it("records the audit, then builds the file", async () => {
    const order: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: { body: string }) => { order.push(`audit:${JSON.parse(init.body).resource}`); return { ok: true } as Response; }));
    URL.createObjectURL = vi.fn(() => { order.push("file"); return "blob:x"; }); URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    show();
    fireEvent.click(exportBtn());
    await waitFor(() => expect(order).toEqual(["audit:hr/transfer", "file"]));
  });

  it("a failed audit builds no file and shows the not-recorded alert", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500 }) as Response));
    const made = vi.fn(() => "blob:x");
    URL.createObjectURL = made; URL.revokeObjectURL = vi.fn();
    show();
    fireEvent.click(exportBtn());
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(enMessages.tableExport.notRecorded));
    expect(made).not.toHaveBeenCalled();
  });
});
