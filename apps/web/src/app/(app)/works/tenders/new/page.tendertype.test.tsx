/**
 * Owner decision D4c #40: the pre-tender form sends the chosen tender type by its master record id (tenderTypeId),
 * keeping the text code beside it for the views that still read it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  useSearchParams: () => new URLSearchParams(`workId=${WORK_ID}`),
}));
vi.mock("@/app/_components/ds/Toast", () => ({
  useToast: () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }),
}));

import NewTenderPage from "./page";

const WORK_ID = "123e4567-e89b-12d3-a456-426614174000";
const TYPE_ID = "223e4567-e89b-12d3-a456-426614174000";

describe("NewTenderPage: tender type by master record (D4c #40)", () => {
  beforeEach(() => { vi.restoreAllMocks(); pushMock.mockReset(); });

  it("posts tenderTypeId (the master id) and the code for the chosen type", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/masters/tender-types")) {
        return new Response(JSON.stringify({ data: [{ id: TYPE_ID, name: "Open Tender", code: "open" }] }), { status: 200 });
      }
      if (init?.method === "POST") return new Response(JSON.stringify({ id: "x", status: "accepted" }), { status: 202 });
      return new Response(JSON.stringify({ data: [{ id: WORK_ID, workNumber: "WRK-1", description: "Road" }] }), { status: 200 });
    });
    render(<NewTenderPage />);
    await screen.findByRole("option", { name: "Open Tender" });
    fireEvent.change(screen.getByLabelText(/Tender type/i), { target: { value: TYPE_ID } });
    fireEvent.click(screen.getByRole("button", { name: /create|save|submit/i }));
    await waitFor(() => expect(spy.mock.calls.some((c) => (c[1] as RequestInit | undefined)?.method === "POST")).toBe(true));
    const post = spy.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "POST")!;
    const body = JSON.parse((post[1] as RequestInit).body as string);
    expect(body.tenderTypeId).toBe(TYPE_ID);
    expect(body.tenderType).toBe("open");
  });

  it("sends neither when no type is chosen", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("/masters/tender-types")) return new Response(JSON.stringify({ data: [] }), { status: 200 });
      if (init?.method === "POST") return new Response(JSON.stringify({ id: "x", status: "accepted" }), { status: 202 });
      return new Response("{}", { status: 200 });
    });
    render(<NewTenderPage />);
    fireEvent.click(screen.getByRole("button", { name: /create|save|submit/i }));
    await waitFor(() => expect(spy.mock.calls.some((c) => (c[1] as RequestInit | undefined)?.method === "POST")).toBe(true));
    const post = spy.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "POST")!;
    const body = JSON.parse((post[1] as RequestInit).body as string);
    expect(body.tenderTypeId).toBeUndefined();
    expect(body.tenderType).toBeUndefined();
  });
});
