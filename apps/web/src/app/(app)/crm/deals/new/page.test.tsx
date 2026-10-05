import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, within, fireEvent, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

function render(ui: ReactElement) {
  return rtlRender(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/app/_components/ds/Toast", () => ({
  useToast: () => ({ toast: { success: vi.fn(), error: vi.fn() } }),
}));

import NewDealPage from "./page";

describe("NewDealPage stage options (GAP-CRM-DEALS-NEW-01)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // The contact picker fetches /v1/crm/contacts on mount; keep it quiet.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: [] }), { status: 200 }),
    );
  });

  it("offers only open stages — no Won or Lost option on create", () => {
    render(<NewDealPage />);
    const stageSelect = screen.getByLabelText(/stage/i);
    const options = within(stageSelect).getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["Lead", "Proposal", "Negotiation"]);
    expect(options).not.toContain("Won");
    expect(options).not.toContain("Lost");
  });

  it("has no option whose value is a terminal/closed stage", () => {
    render(<NewDealPage />);
    const stageSelect = screen.getByLabelText(/stage/i) as HTMLSelectElement;
    const values = Array.from(stageSelect.options).map((o) => o.value);
    expect(values).not.toContain("Won");
    expect(values).not.toContain("Lost");
  });
});

describe("NewDealPage money + validation (GAP-CRM-DEALS-NEW-03/05)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: [] }), { status: 200 }),
    );
  });

  it("shows a live formatMoney preview of the entered amount (GAP-CRM-DEALS-NEW-03)", () => {
    render(<NewDealPage />);
    fireEvent.change(screen.getByLabelText(/value/i), { target: { value: "1234567" } });
    expect(screen.getByText(/Will be stored as ₹12,34,567\.00/)).toBeInTheDocument();
  });

  it("blocks submit and shows a field error for a non-numeric value (GAP-CRM-DEALS-NEW-03/05)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: [] }), { status: 200 }),
    );
    render(<NewDealPage />);
    fireEvent.change(screen.getByLabelText(/deal name/i), { target: { value: "Test" } });
    fireEvent.change(screen.getByLabelText(/value/i), { target: { value: "abc" } });
    fireEvent.click(screen.getByRole("button", { name: /create deal/i }));
    expect(await screen.findByText(/enter a valid amount/i)).toBeInTheDocument();
    // Only the on-mount contacts GET happened; no POST to create the deal.
    const postCalls = fetchSpy.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "POST");
    expect(postCalls).toHaveLength(0);
  });

  it("blocks submit and shows a field error for an empty name (GAP-CRM-DEALS-NEW-05)", async () => {
    render(<NewDealPage />);
    fireEvent.change(screen.getByLabelText(/value/i), { target: { value: "1000" } });
    fireEvent.click(screen.getByRole("button", { name: /create deal/i }));
    expect(await screen.findByText(/enter a deal name/i)).toBeInTheDocument();
  });

  it("defaults probability from the stage on change (GAP-CRM-DEALS-NEW-05)", () => {
    render(<NewDealPage />);
    const prob = screen.getByLabelText(/probability/i) as HTMLInputElement;
    // Lead default is 10.
    expect(prob.value).toBe("10");
    fireEvent.change(screen.getByLabelText(/stage/i), { target: { value: "Negotiation" } });
    expect(prob.value).toBe("70");
  });

  it("converts rupees to exact paise with no float rounding (GAP-CRM-DEALS-NEW-03)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "d1" }), { status: 201 }),
    );
    render(<NewDealPage />);
    fireEvent.change(screen.getByLabelText(/deal name/i), { target: { value: "Precise" } });
    fireEvent.change(screen.getByLabelText(/value/i), { target: { value: "1234567.89" } });
    fireEvent.click(screen.getByRole("button", { name: /create deal/i }));
    await waitFor(() => {
      const post = fetchSpy.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "POST");
      expect(post).toBeTruthy();
      const body = JSON.parse((post![1] as RequestInit).body as string);
      expect(body.valueMinor).toBe("123456789");
    });
  });
});

describe("NewDealPage contact picker (GAP-CRM-DEALS-NEW-04)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders an async contact search combobox (not a wholesale <select>)", () => {
    // No eager fetch happens on mount any more; the picker searches on demand.
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<NewDealPage />);
    const picker = screen.getByRole("combobox", { name: /contact \(optional\)/i });
    expect(picker).toBeInTheDocument();
    // The contact lookup is only hit when the user types, so nothing fires yet.
    expect(fetchSpy).not.toHaveBeenCalled();
    // The deal can still be created without a contact (picker is optional).
    expect(screen.getByRole("button", { name: /create deal/i })).toBeEnabled();
  });

  it("queries the server contact lookup endpoint as the user types", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: "c1", name: "Asha Rao", phone: "98xxxx3210" }] }), { status: 200 }),
    );
    render(<NewDealPage />);
    const picker = screen.getByRole("combobox", { name: /contact \(optional\)/i });
    fireEvent.change(picker, { target: { value: "Asha" } });
    await waitFor(() => {
      const call = fetchSpy.mock.calls.find(([url]) => String(url).includes("/v1/crm/contacts/lookup"));
      expect(call).toBeTruthy();
      expect(String(call![0])).toContain("q=Asha");
    });
  });
});
