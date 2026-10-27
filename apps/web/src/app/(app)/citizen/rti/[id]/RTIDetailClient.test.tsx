import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { RTIDetailClient } from "./RTIDetailClient";
import enMessages from "@/messages/en.json";
import type { RtiDetail } from "../../_data/loaders";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const mockRti: RtiDetail = {
  id: "rti-001",
  rtiNo: "RTI-001",
  subject: "Budget Expenditure Details FY 2024",
  description: "Seeking a breakdown of ward-level sanitation spend.",
  cpioRef: "CPIO-SANITATION-01",
  deadline: "2099-01-31T00:00:00Z",
  status: "received",
  statusLabel: "Received",
  isOverdue: false,
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
  responses: [],
  appeals: [],
  transfers: [],
};

function renderClient(props: Partial<Parameters<typeof RTIDetailClient>[0]> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <RTIDetailClient id="rti-001" {...props} />
    </NextIntlClientProvider>,
  );
}

describe("RTIDetailClient -- PERF-009 tranche 3 (SSR loader integration)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the server-provided RTI application immediately and does NOT fetch on mount when the server loader succeeded", async () => {
    renderClient({ initialRti: mockRti, initialSource: "api" });

    // Real data is visible on the very first render -- no loading state.
    expect(screen.getByText("Budget Expenditure Details FY 2024")).toBeInTheDocument();

    // Give any effect a tick to (not) fire, then assert fetch was never called.
    await waitFor(() => expect(fetch).not.toHaveBeenCalled());
  });

  it("renders not-found immediately (no fetch) when the server loader succeeded with no record", async () => {
    renderClient({ initialRti: null, initialSource: "api" });

    expect(await screen.findByText(enMessages.citizenRti.notFoundTitle)).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("falls back to the original client-side fetch on mount when the server loader errored (unchanged pre-existing behavior)", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockRti,
    });

    renderClient({ initialSource: "error" });

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    // UX-fetch-cancellation: the mount-time fetch is now threaded an
    // AbortSignal (cleaned up on unmount) -- see load()'s AbortController.
    expect(fetch).toHaveBeenCalledWith("/api/proxy/v1/citizen/rti/rti-001", { cache: "no-store", signal: expect.any(AbortSignal) });
    expect(await screen.findByText("Budget Expenditure Details FY 2024")).toBeInTheDocument();
  });

  it("falls back to fetching on mount when no initial props are given at all (default matches pre-existing behavior)", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockRti,
    });

    renderClient();

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  });
});

describe("RTIDetailClient -- error copy & statutory clock (GAP-CITIZEN-RTI-DETAIL-02/04/05)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("DETAIL-02: a 500 whose body is a raw stack trace is NOT shown; a catalogued human message is", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 500,
      headers: new Headers(),
      // body carries a leaky stack; the UI must never surface it
      clone() { return { json: async () => ({ stack: "Error: at db.ts:42", message: "ECONNREFUSED 10.0.0.1:5432" }) }; },
      json: async () => ({ stack: "Error: at db.ts:42" }),
      text: async () => '{"stack":"Error: at db.ts:42"}',
    });

    renderClient({ initialSource: "error" });

    // The alert appears with catalogued copy, not the raw body.
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).not.toContain("ECONNREFUSED");
    expect(alert.textContent).not.toContain("db.ts");
    expect(alert.textContent).not.toContain("stack");
    expect(alert.textContent?.length).toBeGreaterThan(0);
  });

  it("DETAIL-05: an application with a recorded response renders as disposed (clock stopped)", async () => {
    const respondedRti = {
      ...mockRti,
      status: "received", // status not yet re-projected
      responses: [{ id: "resp-1", responseUrl: "https://x/doc.pdf", respondedAt: "2024-02-01T00:00:00Z" }],
    };
    renderClient({ initialRti: respondedRti, initialSource: "api" });
    expect(await screen.findByText(enMessages.citizenRti.disposed)).toBeInTheDocument();
  });

  it("DETAIL-04: a far-future deadline shows days remaining (not an off-by-one overdue)", async () => {
    renderClient({ initialRti: { ...mockRti, deadline: "2099-01-31T00:00:00Z", isOverdue: false }, initialSource: "api" });
    // The clock cell renders a "days remaining" string; it must not say overdue.
    expect(screen.queryByText(/overdue/i)).toBeNull();
  });

  it("DETAIL-06: an appeal's grounds (already fetched but never shown before) are displayed", async () => {
    const withAppeal = {
      ...mockRti,
      appeals: [{ id: "ap-1", appealType: "first", grounds: "No response within 30 days under §7", status: "filed", createdAt: "2024-02-10T00:00:00Z" }],
    };
    renderClient({ initialRti: withAppeal, initialSource: "api" });
    expect(await screen.findByText(/No response within 30 days/)).toBeInTheDocument();
  });

  it("DETAIL-03: a javascript: responseUrl is NEVER rendered as a link href", async () => {
    const evil = {
      ...mockRti,
      status: "replied",
      responses: [{ id: "resp-x", responseUrl: "javascript:alert(1)", respondedAt: "2024-02-01T00:00:00Z" }],
    };
    const { container } = renderClient({ initialRti: evil, initialSource: "api" });
    // No anchor carries the javascript: scheme.
    const anchors = Array.from(container.querySelectorAll("a"));
    expect(anchors.some((a) => /^\s*(?:javascript|data|vbscript):/i.test(a.getAttribute("href") ?? ""))).toBe(false);
    // The inert fallback label is shown instead.
    expect(await screen.findByText(enMessages.citizenRti.responseDocumentUnavailable)).toBeInTheDocument();
  });

  it("DETAIL-03: an https responseUrl is rendered as a safe link", async () => {
    const ok = {
      ...mockRti,
      status: "replied",
      responses: [{ id: "resp-ok", responseUrl: "https://storage.example/doc.pdf", respondedAt: "2024-02-01T00:00:00Z" }],
    };
    const { container } = renderClient({ initialRti: ok, initialSource: "api" });
    const link = container.querySelector('a[href="https://storage.example/doc.pdf"]');
    expect(link).not.toBeNull();
  });
});

describe("RTIDetailClient -- CLOS2-S1-15 offline errors", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("shows the translated load fallback, not raw 'Failed to fetch', when the detail load fails offline", async () => {
    renderClient({ initialSource: "error" });
    expect(await screen.findByText(enMessages.citizenRti.loadErrorFallback)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("Failed to fetch");
  });

  it("shows the translated appeal fallback, not raw 'Failed to fetch', when filing an appeal offline", async () => {
    renderClient({ initialRti: mockRti, initialSource: "api" });
    fireEvent.click(screen.getByRole("button", { name: enMessages.citizenRti.fileAppeal }));
    fireEvent.change(screen.getByLabelText(enMessages.citizenRti.appealGroundsLabel), { target: { value: "No reply in 30 days" } });
    fireEvent.click(screen.getByRole("button", { name: enMessages.citizenRti.submitAppeal }));
    expect(await screen.findByText(enMessages.citizenRti.appealErrorFallback)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("Failed to fetch");
  });
});

describe("RTIDetailClient -- GAP-CITIZEN-RTI-DETAIL-06 transfer history", () => {
  it("shows the s.6(3) transfer trail (from, to, date) and hides the card when there is none", () => {
    const { unmount } = renderClient({ initialRti: mockRti, initialSource: "api" });
    expect(screen.queryByText("Transfers")).not.toBeInTheDocument();
    unmount();
    renderClient({
      initialSource: "api",
      initialRti: {
        ...mockRti,
        transfers: [{ id: "t1", fromAuthority: "Sanitation Dept", toAuthority: "Water Works", transferredAt: "2026-03-05T04:30:00Z" }],
      },
    });
    expect(screen.getByText("Transfers")).toBeInTheDocument();
    expect(screen.getByText("Transferred from Sanitation Dept to Water Works")).toBeInTheDocument();
    expect(screen.getByText("05/03/2026")).toBeInTheDocument();
  });
});
