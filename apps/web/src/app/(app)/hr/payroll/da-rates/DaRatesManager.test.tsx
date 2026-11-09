import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }), usePathname: () => "/" }));
const browserJson = vi.fn();
vi.mock("@/lib/api/browserClient", () => ({ browserJson: (...a: unknown[]) => browserJson(...a) }));

import { DaRatesManager } from "./DaRatesManager";

const ROWS = [
  { id: "r1", effectiveFrom: "2026-01-01", rateBps: 5800, orderRef: "MoF DoE OM dated 28.03.2026" },
  { id: "r2", effectiveFrom: "2026-07-01", rateBps: 6000, orderRef: "MoF DoE OM dated 30.09.2026" },
];
const ui = (canWrite: boolean, rows = ROWS) => render(
  <NextIntlClientProvider locale="en" messages={enMessages}><DaRatesManager rows={rows} canWrite={canWrite} /></NextIntlClientProvider>,
);

beforeEach(() => { browserJson.mockReset().mockResolvedValue({ id: "x", status: "accepted" }); refresh.mockReset(); });

describe("DaRatesManager", () => {
  it("lists rates newest first with the order reference; a read-only role gets no form or remove buttons", () => {
    ui(false);
    const cells = screen.getAllByRole("row").slice(1).map((r) => r.textContent);
    expect(cells[0]).toContain("60.00%");
    expect(cells[1]).toContain("58.00%");
    expect(screen.getByText("MoF DoE OM dated 28.03.2026")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /add da rate/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^remove$/i })).toBeNull();
  });

  it("an empty tenant says payroll cannot run until a rate is added", () => {
    ui(true, []);
    expect(screen.getByText(/Payroll cannot run until a rate is added/)).toBeTruthy();
  });

  it("validates, confirms, then POSTs the revision", async () => {
    ui(true);
    fireEvent.click(screen.getByRole("button", { name: /add da rate/i }));
    expect(screen.getByRole("alert").textContent).toMatch(/first day of a month/);
    expect(browserJson).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/Effective from/), { target: { value: "2027-01-01" } });
    fireEvent.change(screen.getByLabelText(/DA rate/), { target: { value: "62" } });
    fireEvent.change(screen.getByLabelText(/Government order reference/), { target: { value: "MoF DoE OM No. 1/1/2027-E.II(B) dated 28.03.2027" } });
    fireEvent.click(screen.getByRole("button", { name: /add da rate/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Add rate" }));
    await waitFor(() => expect(browserJson).toHaveBeenCalledWith("v1/payroll/da-rates", {
      method: "POST",
      body: JSON.stringify({ effectiveFrom: "2027-01-01", rateBps: 6200, orderRef: "MoF DoE OM No. 1/1/2027-E.II(B) dated 28.03.2027" }),
    }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("refuses a duplicate effective date before calling the server", () => {
    ui(true);
    fireEvent.change(screen.getByLabelText(/Effective from/), { target: { value: "2026-07-01" } });
    fireEvent.change(screen.getByLabelText(/DA rate/), { target: { value: "61" } });
    fireEvent.change(screen.getByLabelText(/Government order reference/), { target: { value: "MoF DoE OM dated 01.10.2026" } });
    fireEvent.click(screen.getByRole("button", { name: /add da rate/i }));
    expect(screen.getByRole("alert").textContent).toMatch(/already takes effect on 2026-07-01/);
    expect(browserJson).not.toHaveBeenCalled();
  });

  it("removes a rate through a confirmation and shows the server's refusal inside the dialog", async () => {
    browserJson.mockRejectedValueOnce(new Error("This DA rate is used by processed payroll for 2026-03 and cannot be deleted."));
    ui(true);
    fireEvent.click(screen.getAllByRole("button", { name: /^remove$/i })[1]!);
    fireEvent.click(await screen.findByRole("button", { name: "Remove rate" }));
    await waitFor(() => expect(browserJson).toHaveBeenCalledWith("v1/payroll/da-rates/r1", { method: "DELETE" }));
    expect(await screen.findByText(/cannot be deleted/)).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
  });
});
