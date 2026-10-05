import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderWithIntl } from "@/lib/testUtils/intl";
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

const pushMock = vi.fn();
const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
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
    renderWithIntl(<NewDealPage />);
    const stageSelect = screen.getByLabelText(/stage/i);
    const options = within(stageSelect).getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["Lead", "Proposal", "Negotiation"]);
    expect(options).not.toContain("Won");
    expect(options).not.toContain("Lost");
  });

  it("has no option whose value is a terminal/closed stage", () => {
    renderWithIntl(<NewDealPage />);
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
    renderWithIntl(<NewDealPage />);
    fireEvent.change(screen.getByLabelText(/value/i), { target: { value: "1234567" } });
    expect(screen.getByText(/Will be stored as ₹12,34,567\.00/)).toBeInTheDocument();
  });

  it("blocks submit and shows a field error for a non-numeric value (GAP-CRM-DEALS-NEW-03/05)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: [] }), { status: 200 }),
    );
    renderWithIntl(<NewDealPage />);
    fireEvent.change(screen.getByLabelText(/engagement name/i), { target: { value: "Test" } });
    fireEvent.change(screen.getByLabelText(/value/i), { target: { value: "abc" } });
    fireEvent.click(screen.getByRole("button", { name: /create engagement/i }));
    expect(await screen.findByText(/enter a valid amount/i)).toBeInTheDocument();
    // Only the on-mount contacts GET happened; no POST to create the deal.
    const postCalls = fetchSpy.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "POST");
    expect(postCalls).toHaveLength(0);
  });

  it("blocks submit and shows a field error for an empty name (GAP-CRM-DEALS-NEW-05)", async () => {
    renderWithIntl(<NewDealPage />);
    fireEvent.change(screen.getByLabelText(/value/i), { target: { value: "1000" } });
    fireEvent.click(screen.getByRole("button", { name: /create engagement/i }));
    expect(await screen.findByText(/enter an engagement name/i)).toBeInTheDocument();
  });

  it("defaults probability from the stage on change (GAP-CRM-DEALS-NEW-05)", () => {
    renderWithIntl(<NewDealPage />);
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
    renderWithIntl(<NewDealPage />);
    fireEvent.change(screen.getByLabelText(/engagement name/i), { target: { value: "Precise" } });
    fireEvent.change(screen.getByLabelText(/value/i), { target: { value: "1234567.89" } });
    fireEvent.click(screen.getByRole("button", { name: /create engagement/i }));
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
    renderWithIntl(<NewDealPage />);
    const picker = screen.getByRole("combobox", { name: /contact \(optional\)/i });
    expect(picker).toBeInTheDocument();
    // The contact lookup is only hit when the user types, so nothing fires yet.
    expect(fetchSpy).not.toHaveBeenCalled();
    // The deal can still be created without a contact (picker is optional).
    expect(screen.getByRole("button", { name: /create engagement/i })).toBeEnabled();
  });

  it("queries the server contact lookup endpoint as the user types", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: "c1", name: "Asha Rao", phone: "98xxxx3210" }] }), { status: 200 }),
    );
    renderWithIntl(<NewDealPage />);
    const picker = screen.getByRole("combobox", { name: /contact \(optional\)/i });
    fireEvent.change(picker, { target: { value: "Asha" } });
    await waitFor(() => {
      const call = fetchSpy.mock.calls.find(([url]) => String(url).includes("/v1/crm/contacts/lookup"));
      expect(call).toBeTruthy();
      expect(String(call![0])).toContain("q=Asha");
    });
  });
});

describe("NewDealPage navigation after create (GAP-CRM-DEALS-NEW-06)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    pushMock.mockReset();
    refreshMock.mockReset();
  });

  async function createWith(responseBody: unknown, status: number) {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      if ((init as RequestInit | undefined)?.method === "POST") {
        return new Response(JSON.stringify(responseBody), { status });
      }
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    });
    renderWithIntl(<NewDealPage />);
    fireEvent.change(screen.getByLabelText(/engagement name/i), { target: { value: "Nav test" } });
    fireEvent.change(screen.getByLabelText(/value/i), { target: { value: "1000" } });
    fireEvent.click(screen.getByRole("button", { name: /create engagement/i }));
  }

  it("navigates straight to the new engagement when the response carries { data: { id } }", async () => {
    await createWith({ data: { id: "d1" } }, 202);
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/crm/deals/d1"));
    expect(refreshMock).toHaveBeenCalled();
  });

  it("navigates to the new engagement when the response carries a top-level { id }", async () => {
    await createWith({ id: "d7" }, 201);
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/crm/deals/d7"));
  });

  it("falls back to the list when the response carries no id", async () => {
    await createWith({ ok: true }, 202);
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/crm/deals"));
  });

  it("does not use a fixed setTimeout bounce (navigation is immediate)", async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    await createWith({ data: { id: "d9" } }, 202);
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/crm/deals/d9"));
    // The old code deferred router.push via setTimeout(..., 600); the new code
    // must navigate synchronously after the await, with no 600ms timer.
    const navTimer = setTimeoutSpy.mock.calls.some(([, delay]) => delay === 600);
    expect(navTimer).toBe(false);
  });
});

describe("NewDealPage save failures use the shared human error", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    pushMock.mockReset();
  });

  function submitWith(post: () => Promise<Response>) {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      if ((init as RequestInit | undefined)?.method === "POST") return post();
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    });
    renderWithIntl(<NewDealPage />);
    fireEvent.change(screen.getByLabelText(/engagement name/i), { target: { value: "Err test" } });
    fireEvent.change(screen.getByLabelText(/value/i), { target: { value: "1000" } });
    fireEvent.click(screen.getByRole("button", { name: /create engagement/i }));
  }

  it("never shows a raw network exception (Failed to fetch)", async () => {
    submitWith(async () => { throw new TypeError("Failed to fetch"); });
    const alert = await screen.findByRole("alert");
    expect(alert.textContent ?? "").not.toMatch(/failed to fetch/i);
    expect((alert.textContent ?? "").trim().length).toBeGreaterThan(0);
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("shows the standard message (not server text or a status code) for a 403", async () => {
    submitWith(async () => new Response(JSON.stringify({ code: "FORBIDDEN", message: "requires one of: crm_user" }), { status: 403 }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent ?? "").not.toMatch(/403|requires one of|crm_user/);
    expect((alert.textContent ?? "").trim().length).toBeGreaterThan(0);
  });
});
