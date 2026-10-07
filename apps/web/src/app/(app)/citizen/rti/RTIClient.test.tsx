import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { RTIClient } from "./RTIClient";
import enMessages from "@/messages/en.json";

const refresh = vi.fn();
const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push, prefetch: vi.fn(), replace: vi.fn() }),
}));

type RTIApplication = Parameters<typeof RTIClient>[0]["rtis"][number];

const transferable: RTIApplication = {
  id: "rti-open-1",
  rtiNo: "RTI-OPEN-1",
  applicantName: "Asha Devi",
  subject: "Ward sanitation spend",
  publicAuthority: "PWD",
  filedDate: "2099-01-01",
  deadlineDate: "2099-01-31",
  status: "received", // transferable + open
  isFirstAppeal: false,
};

const closed: RTIApplication = {
  id: "rti-closed-1",
  rtiNo: "RTI-CLOSED-1",
  applicantName: "Ravi Kumar",
  subject: "Budget details",
  publicAuthority: "Finance",
  filedDate: "2020-01-01",
  deadlineDate: "2020-01-31",
  status: "replied", // closed
  isFirstAppeal: true,
};

function renderClient(rtis: RTIApplication[]) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <RTIClient rtis={rtis} />
    </NextIntlClientProvider>,
  );
}

describe("RTIClient", () => {
  beforeEach(() => {
    refresh.mockClear();
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => vi.unstubAllGlobals());

  it("GAP-CITIZEN-RTI-02: after a 2xx transfer it shows a success notice, calls router.refresh, and hides the row's Transfer button", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, status: 202, headers: new Headers(), json: async () => ({}) });
    renderClient([transferable]);

    // Transfer button is offered for an open, transferable row.
    const transferBtn = screen.getByRole("button", { name: /transfer rti rti-open-1/i });
    fireEvent.click(transferBtn);

    // Fill the required reason and confirm.
    const reason = await screen.findByLabelText(enMessages.citizenRti.transferReasonLabel);
    fireEvent.change(reason, { target: { value: "District Collectorate" } });
    const dialog = screen.getByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: enMessages.citizenRti.transfer }));

    // POST hit the transfer endpoint.
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/proxy/v1/citizen/rti/rti-open-1/transfer",
        expect.objectContaining({ method: "POST" }),
      ),
    );

    // Success notice visible (fails on old code: it only had a comment).
    expect(await screen.findByRole("status")).toHaveTextContent(/transferred to District Collectorate/i);
    // router.refresh called (fails on old code: router not even imported).
    expect(refresh).toHaveBeenCalledTimes(1);
    // Transfer button no longer offered for that row.
    await waitFor(() => expect(screen.queryByRole("button", { name: /transfer rti rti-open-1/i })).toBeNull());
  });

  it("GAP-CITIZEN-RTI-05: a closed (replied) application is not offered a Transfer button", () => {
    renderClient([closed]);
    expect(screen.queryByRole("button", { name: /transfer/i })).toBeNull();
  });

  it("GAP-CITIZEN-RTI-04/07: segment labels are localized (Open/Overdue), not the old 'Due' literal", () => {
    renderClient([transferable, closed]);
    // Localized segment labels present.
    expect(screen.getByRole("tab", { name: enMessages.citizenRti.segOpen })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: enMessages.citizenRti.segOverdue })).toBeInTheDocument();
  });
});
