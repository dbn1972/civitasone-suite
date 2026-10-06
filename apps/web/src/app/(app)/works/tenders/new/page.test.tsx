import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock("@/app/_components/ds/Toast", () => ({
  useToast: () => ({
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  }),
}));

import NewTenderPage from "./page";

const WORK_ID = "123e4567-e89b-12d3-a456-426614174000";

/** Mock fetch for the masters tender-types load, the work-proposals search,
 *  and the pre-tender POST. */
function mockFetch(postStatus = 202, postBody: unknown = { id: "x", status: "accepted" }) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/masters/tender-types")) {
      return new Response(JSON.stringify({ data: [{ id: "tt1", name: "Open Tender", code: "open" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("/works/proposals")) {
      return new Response(JSON.stringify({ data: [{ id: WORK_ID, workNumber: "WRK-1", description: "Road" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    // pre-tender POST
    if (init?.method === "POST") {
      return new Response(JSON.stringify(postBody), {
        status: postStatus,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("{}", { status: 200 });
  });
}

async function pickWork() {
  const picker = screen.getByLabelText("Work");
  fireEvent.focus(picker);
  fireEvent.change(picker, { target: { value: "WRK" } });
  const option = await screen.findByText("WRK-1");
  fireEvent.mouseDown(option);
}

describe("NewTenderPage — NEW-01 work picker", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    pushMock.mockReset();
  });

  it("blocks submit (and does not POST) until a work is picked", async () => {
    const spy = mockFetch();
    render(<NewTenderPage />);
    fireEvent.click(screen.getByRole("button", { name: "Create Pre-Tender" }));
    await waitFor(() => expect(screen.getByText("Select the work this tender belongs to.")).toBeInTheDocument());
    expect(spy.mock.calls.some((c) => (c[1] as RequestInit | undefined)?.method === "POST")).toBe(false);
  });

  it("posts the chosen work id once a work is picked", async () => {
    const spy = mockFetch();
    render(<NewTenderPage />);
    await pickWork();
    fireEvent.click(screen.getByRole("button", { name: "Create Pre-Tender" }));
    await waitFor(() =>
      expect(spy.mock.calls.some((c) => String(c[0]).endsWith("/tenders/pre-tender"))).toBe(true),
    );
    const call = spy.mock.calls.find((c) => String(c[0]).endsWith("/tenders/pre-tender"))!;
    const body = JSON.parse((call[1] as RequestInit).body as string);
    expect(body.workId).toBe(WORK_ID);
  });
});

describe("NewTenderPage — NEW-05 fee validation (no float math)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    pushMock.mockReset();
  });

  it("rejects a sub-paise fee and converts a valid one without float error", async () => {
    const spy = mockFetch();
    render(<NewTenderPage />);
    await pickWork();

    // 1.005 has 3 decimals -> rejected, no POST.
    fireEvent.change(screen.getByLabelText(/Tender fee/i), { target: { value: "1.005" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Pre-Tender" }));
    await waitFor(() => expect(screen.getByText(/valid tender fee/i)).toBeInTheDocument());
    expect(spy.mock.calls.some((c) => String(c[0]).endsWith("/tenders/pre-tender"))).toBe(false);

    // 150.50 -> "15050" paise, exact (rupeesToMinorString, no float math).
    fireEvent.change(screen.getByLabelText(/Tender fee/i), { target: { value: "150.50" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Pre-Tender" }));
    await waitFor(() => expect(spy.mock.calls.some((c) => String(c[0]).endsWith("/tenders/pre-tender"))).toBe(true));
    const call = spy.mock.calls.find((c) => String(c[0]).endsWith("/tenders/pre-tender"))!;
    const body = JSON.parse((call[1] as RequestInit).body as string);
    expect(body.fees).toBe("15050");
  });
});

describe("NewTenderPage — NEW-04 accessible error + UX-016 clerk-safe errors", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    pushMock.mockReset();
  });

  it("announces a clerk-safe submit error via role=alert, never the raw backend text", async () => {
    mockFetch(409, { message: "duplicate reference number" });
    render(<NewTenderPage />);
    await pickWork();
    fireEvent.click(screen.getByRole("button", { name: "Create Pre-Tender" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/This pre-tender was changed by someone else\. Refresh to see the latest version, then try again\./);
    expect(document.body.textContent).not.toMatch(/duplicate reference number/i);
    expect(document.body.textContent).not.toMatch(/\b409\b/);
  });
});
