import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: refreshMock }) }));

import { ToastProvider } from "@/app/_components/ds";
import { BillPassPayActions, SanctionRejectAction, JournalReverseAction } from "./FinanceActions";

const JID = "8582e532-7041-45d3-93ef-1d8a89066f81";
const wrap = (ui: React.ReactNode, locale: "en" | "hi" = "en") => (
  <NextIntlClientProvider locale={locale} messages={locale === "hi" ? hiMessages : enMessages}>
    <ToastProvider>{ui}</ToastProvider>
  </NextIntlClientProvider>
);

describe("finance maker-checker: reject and reverse are wired (were dark: no web caller)", () => {
  beforeEach(() => { refreshMock.mockReset(); vi.restoreAllMocks(); });

  it("bill: Reject calls PATCH bills/:id/reject with the reason, only after a reason of 3+ characters", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 202 }));
    render(wrap(<BillPassPayActions id="b1" status="pending" threeWayMatch="matched" />));
    fireEvent.click(screen.getByRole("button", { name: "Reject bill" }));
    const confirm = within(screen.getByRole("alertdialog")).getByRole("button", { name: "Reject bill" });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Reason for rejection/), { target: { value: "ab" } });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Reason for rejection/), { target: { value: "GRN quantity mismatch" } });
    fireEvent.click(confirm);
    await waitFor(() => expect(f).toHaveBeenCalledTimes(1));
    const [url, init] = f.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe("/api/proxy/v1/finance/bills/b1/reject");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({ reason: "GRN quantity mismatch" });
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("bill: Reject is not offered to a role the server 403s, nor on a passed/paid/rejected bill", () => {
    render(wrap(<BillPassPayActions id="b1" status="pending" canPass={false} />));
    expect(screen.queryByRole("button", { name: "Reject bill" })).not.toBeInTheDocument();
    render(wrap(<BillPassPayActions id="b2" status="passed" />));
    expect(screen.queryByRole("button", { name: "Reject bill" })).not.toBeInTheDocument();
  });

  it("bill: a 403 keeps the dialog open with a readable message and does not refresh", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ code: "FORBIDDEN" }), { status: 403 }));
    render(wrap(<BillPassPayActions id="b1" status="pending" threeWayMatch="matched" />));
    fireEvent.click(screen.getByRole("button", { name: "Reject bill" }));
    fireEvent.change(screen.getByLabelText(/Reason for rejection/), { target: { value: "Duplicate invoice" } });
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Reject bill" }));
    await waitFor(() => expect(f).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("sanction: Reject calls PATCH sanctions/:id/reject with the reason", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 202 }));
    render(wrap(<SanctionRejectAction id="s1" />));
    fireEvent.click(screen.getByRole("button", { name: "Reject sanction" }));
    const confirm = within(screen.getByRole("alertdialog")).getByRole("button", { name: "Reject sanction" });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Reason for rejection/), { target: { value: "No budget provision" } });
    fireEvent.click(confirm);
    await waitFor(() => expect(f).toHaveBeenCalledTimes(1));
    const [url, init] = f.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe("/api/proxy/v1/finance/sanctions/s1/reject");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({ reason: "No budget provision" });
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("sanction: a 422 is surfaced in the dialog, no refresh", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 422 }));
    render(wrap(<SanctionRejectAction id="s1" />));
    fireEvent.click(screen.getByRole("button", { name: "Reject sanction" }));
    fireEvent.change(screen.getByLabelText(/Reason for rejection/), { target: { value: "No budget provision" } });
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Reject sanction" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("journal: Reverse POSTs journals/:id/reverse only after confirmation, then refreshes", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 202 }));
    render(wrap(<JournalReverseAction journalId={JID} voucherNo="JV-1" />));
    fireEvent.click(screen.getByRole("button", { name: "Reverse voucher" }));
    expect(f).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Reverse voucher" }));
    await waitFor(() => expect(f).toHaveBeenCalledTimes(1));
    const [url, init] = f.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe(`/api/proxy/v1/finance/journals/${JID}/reverse`);
    expect(init.method).toBe("POST");
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("journal: a 403/409 is shown in the dialog and nothing is refreshed", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 409 }));
    render(wrap(<JournalReverseAction journalId={JID} />));
    fireEvent.click(screen.getByRole("button", { name: "Reverse voucher" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Reverse voucher" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("renders Hindi copy for all three actions", () => {
    render(wrap(<><BillPassPayActions id="b1" status="pending" threeWayMatch="matched" /><SanctionRejectAction id="s1" /><JournalReverseAction journalId={JID} /></>, "hi"));
    expect(screen.getByRole("button", { name: "बिल अस्वीकार करें" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "मंजूरी अस्वीकार करें" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "वाउचर उलटें" })).toBeInTheDocument();
  });
});
