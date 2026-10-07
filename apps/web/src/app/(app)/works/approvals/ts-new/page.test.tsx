import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/app/_components/ds/Toast", () => ({
  useToast: () => ({
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  }),
}));

import NewTsPage from "./page";

const WORK_ID = "123e4567-e89b-12d3-a456-426614174000";
const AUTH_ID = globalThis.crypto.randomUUID();

function stubFetch(createResponse: Response) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/v1/works/proposals")) {
      return new Response(JSON.stringify({ data: [{ id: WORK_ID, workNumber: "WK/2026/001", status: "dao_finalized" }] }), { status: 200 });
    }
    if (url.includes("/v1/identity/users")) {
      return new Response(JSON.stringify({ data: [{ id: AUTH_ID, name: "A. Officer", designation: "DAO" }] }), { status: 200 });
    }
    if (url.includes("/v1/works/approvals/ts") && (init?.method ?? "GET") === "POST") {
      return createResponse;
    }
    return new Response("{}", { status: 200 });
  });
}

async function fillValidForm() {
  fireEvent.focus(screen.getByLabelText("Work"));
  fireEvent.change(screen.getByLabelText("Work"), { target: { value: "WK" } });
  fireEvent.mouseDown(await screen.findByText("WK/2026/001"));

  fireEvent.focus(screen.getByLabelText("TS authority"));
  fireEvent.change(screen.getByLabelText("TS authority"), { target: { value: "Officer" } });
  fireEvent.mouseDown(await screen.findByText("A. Officer"));

  fireEvent.change(screen.getByLabelText(/TS Number/i), { target: { value: "TS/2026-27/001" } });
  fireEvent.change(screen.getByLabelText(/Sanction date/i), { target: { value: "2026-01-01" } });
  fireEvent.change(screen.getByLabelText(/Sanction amount/i), { target: { value: "100000" } });
}

describe("NewTsPage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("reports the async create truthfully as 'submitted' (202 != done) and sends BigInt-exact paise", async () => {
    const fetchSpy = stubFetch(new Response(JSON.stringify({ id: "ts1", status: "accepted" }), { status: 202 }));
    render(<NewTsPage />);
    await fillValidForm();
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() =>
      expect(
        screen.getByText("Technical sanction submitted. It will appear in the register once processed."),
      ).toBeInTheDocument(),
    );
    const post = fetchSpy.mock.calls.find(([u, i]) => String(u).includes("/approvals/ts") && (i as RequestInit)?.method === "POST");
    expect(post).toBeTruthy();
    const body = JSON.parse((post![1] as RequestInit).body as string);
    expect(body.tsAmountMinor).toBe("10000000"); // ₹100000.00 -> paise
    expect(body.workId).toBe(WORK_ID);
  });

  it("offers SR Year as a dropdown of recent financial years, not free text", () => {
    stubFetch(new Response("{}", { status: 202 }));
    render(<NewTsPage />);
    const select = screen.getByLabelText(/SR Year/i) as HTMLSelectElement;
    expect(select.tagName).toBe("SELECT");
    // Current + previous few FYs are offered (6 options + the placeholder).
    expect(select.querySelectorAll("option").length).toBeGreaterThanOrEqual(6);
  });

  it("has a Cancel action back to the register", () => {
    stubFetch(new Response("{}", { status: 202 }));
    render(<NewTsPage />);
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("shows a clerk-safe message, never the raw HTTP status, when the create fails", async () => {
    stubFetch(new Response("", { status: 500 }));
    render(<NewTsPage />);
    await fillValidForm();
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(alert).toHaveTextContent(/couldn't save/i));
    expect(alert.textContent).not.toMatch(/\b500\b/);
  });

  it("rejects an amount with more than two decimals before POSTing", async () => {
    const fetchSpy = stubFetch(new Response("{}", { status: 202 }));
    render(<NewTsPage />);
    await fillValidForm();
    fireEvent.change(screen.getByLabelText(/Sanction amount/i), { target: { value: "1.005" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(await screen.findByText(/valid amount in rupees/i)).toBeInTheDocument();
    expect(fetchSpy.mock.calls.filter(([u, i]) => String(u).includes("/approvals/ts") && (i as RequestInit)?.method === "POST")).toHaveLength(0);
  });
});
