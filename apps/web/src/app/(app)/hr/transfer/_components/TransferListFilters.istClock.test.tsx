import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { TransferListFilters } from "./TransferListFilters";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/_components/ds/Toast", () => ({ useToast: () => ({ toast: { success: vi.fn(), error: vi.fn() } }) }));

// CLOS2-S2-08: the CSV filename carries the IST date, not the UTC date.
const transfers = [{ id: "t1", employee: "Ramesh", fromOffice: "A", toOffice: "B", status: "requested" }];

describe("TransferListFilters CSV filename (IST)", () => {
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it("at 02:00 IST the file is named with the IST date", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-22T20:30:00Z"));
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true }) as Response));
    URL.createObjectURL = vi.fn(() => "blob:x"); URL.revokeObjectURL = vi.fn();
    const names: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { names.push(this.download); });
    render(<NextIntlClientProvider locale="en" messages={enMessages}><TransferListFilters transfers={transfers} /></NextIntlClientProvider>);
    fireEvent.click(screen.getByRole("button", { name: new RegExp(enMessages.transferUi.exportAria.slice(0, 8), "i") }));
    await waitFor(() => expect(names).toEqual(["transfers-2026-10-23.csv"]));
  });
});
