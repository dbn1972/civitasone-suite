import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// next/navigation globally mocked in vitest.setup.ts

const identity = vi.hoisted(() => ({ roles: ["estab_officer"] as string[] }));
vi.mock("@/lib/auth/useSessionIdentity", () => ({
  useSessionIdentity: () => ({ loaded: true, userId: "u1", roles: identity.roles }),
}));

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

import DispatchRegistryPage from "./page";

const ROW = {
  id: "ds1", dispatchNo: "DIS/2026/001", toAddress: "District Collector",
  subject: "Transfer order", mode: "speed_post", status: "dispatched",
  fileId: "file-123", dispatchedAt: "2026-10-01", deliveryStatus: "pending",
};

describe("DISPATCH-01: file link column", () => {
  beforeEach(() => { vi.restoreAllMocks(); identity.roles = ["estab_officer"]; });

  it("renders a 'View file' link when fileId is set", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ data: [ROW] }));
    render(<DispatchRegistryPage />);
    const link = await screen.findByRole("link", { name: /View file/i });
    expect(link).toHaveAttribute("href", "/estab/files/file-123");
  });

  it("renders '—' when fileId is null", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ data: [{ ...ROW, fileId: null }] }));
    render(<DispatchRegistryPage />);
    await screen.findByText("DIS/2026/001");
    expect(screen.queryByRole("link", { name: /View file/i })).not.toBeInTheDocument();
  });
});

describe("DISPATCH-02: record acknowledgement", () => {
  beforeEach(() => { vi.restoreAllMocks(); identity.roles = ["estab_officer"]; });

  it("shows an Acknowledge button for dispatched-but-undelivered rows", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ data: [ROW] }));
    render(<DispatchRegistryPage />);
    expect(await screen.findByRole("button", { name: /Acknowledge/i })).toBeInTheDocument();
  });

  it("POSTs delivery with the POD remarks when confirmed", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("delivery")) return Promise.resolve(jsonResponse({ id: "ds1", status: "accepted" }, 202));
      return Promise.resolve(jsonResponse({ data: [ROW] }));
    });
    render(<DispatchRegistryPage />);
    fireEvent.click(await screen.findByRole("button", { name: /Acknowledge/i }));
    const dialog = await screen.findByRole("alertdialog");
    const textarea = dialog.querySelector("textarea");
    fireEvent.change(textarea!, { target: { value: "SPEEDPOST-ABC123" } });
    const confirm = Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === "Mark delivered");
    fireEvent.click(confirm!);

    await waitFor(() => {
      const call = fetchSpy.mock.calls.find((c) => String(c[0]).includes("delivery"));
      expect(call).toBeDefined();
      const body = JSON.parse((call![1] as RequestInit).body as string);
      expect(body.dispatchId).toBe("ds1");
      expect(body.deliveryStatus).toBe("delivered");
      expect(body.deliveryProof).toBe("SPEEDPOST-ABC123");
    });
  });

  it("shows '✔ Delivered' for already-delivered rows", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ data: [{ ...ROW, deliveryStatus: "delivered" }] }));
    render(<DispatchRegistryPage />);
    expect(await screen.findByText(/Delivered/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Acknowledge/i })).not.toBeInTheDocument();
  });
});

describe("DISPATCH-03: humanized mode + date copy", () => {
  beforeEach(() => { vi.restoreAllMocks(); identity.roles = ["estab_officer"]; });

  it("humanizes the mode (speed_post → Speed Post)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ data: [ROW] }));
    render(<DispatchRegistryPage />);
    await screen.findByText("DIS/2026/001");
    expect(screen.getByText("Speed Post")).toBeInTheDocument();
    expect(screen.queryByText("speed_post")).not.toBeInTheDocument();
  });

  it("shows 'Not yet dispatched' for a null date", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ data: [{ ...ROW, dispatchedAt: null, status: "pending" }] }));
    render(<DispatchRegistryPage />);
    await screen.findByText("DIS/2026/001");
    expect(screen.getByText(/Not yet dispatched/i)).toBeInTheDocument();
  });
});

describe("DISPATCH-02: manual dispatch entry and role gate", () => {
  beforeEach(() => { vi.restoreAllMocks(); identity.roles = ["estab_officer"]; });

  it("posts a manual dispatch with the addressee, subject and mode the service accepts", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((_i: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") return Promise.resolve(jsonResponse({ id: "n", status: "accepted" }, 202));
      return Promise.resolve(jsonResponse({ data: [] }));
    });
    render(<DispatchRegistryPage />);
    await screen.findByRole("button", { name: "Log dispatch" });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "District Collector" } });
    fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "Transfer order" } });
    fireEvent.change(screen.getByLabelText("Mode"), { target: { value: "post" } });
    fireEvent.click(screen.getByRole("button", { name: "Log dispatch" }));
    await waitFor(() => {
      const call = fetchSpy.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "POST");
      expect(call).toBeDefined();
      expect(String(call![0])).toBe("/api/proxy/v1/estab/dispatch");
      expect(JSON.parse((call![1] as RequestInit).body as string)).toEqual({ toAddress: "District Collector", subject: "Transfer order", mode: "post" });
    });
    expect(await screen.findByText(/dispatch number appears in the register/i)).toBeInTheDocument();
  });

  it("Given a blank addressee, Then nothing is posted", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ data: [] }));
    render(<DispatchRegistryPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Log dispatch" }));
    expect(await screen.findByText(/Enter who the dispatch is addressed to/i)).toBeInTheDocument();
    expect(fetchSpy.mock.calls.some((c) => (c[1] as RequestInit | undefined)?.method === "POST")).toBe(false);
  });

  it("shows the delivery date and POD for a delivered row", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ data: [{ ...ROW, deliveryStatus: "delivered", deliveredAt: "2026-10-03T05:00:00.000Z", deliveryProof: "SPEEDPOST-ABC123" }] }));
    render(<DispatchRegistryPage />);
    expect(await screen.findByText(/Delivered on 03 Oct 2026/)).toBeInTheDocument();
    expect(screen.getByText("SPEEDPOST-ABC123")).toBeInTheDocument();
  });

  it("GAP-ESTAB-DISPATCH-02: an audit officer sees the register but no log form and no Acknowledge button", async () => {
    identity.roles = ["audit_officer"];
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ data: [ROW] }));
    render(<DispatchRegistryPage />);
    await screen.findByText("DIS/2026/001");
    expect(screen.queryByRole("button", { name: "Log dispatch" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Acknowledge/i })).not.toBeInTheDocument();
  });
});

describe("DISPATCH-04: the register is searched and paged on the server", () => {
  beforeEach(() => { vi.restoreAllMocks(); identity.roles = ["estab_officer"]; });

  const rowsOf = (n: number, from = 0) => Array.from({ length: n }, (_, i) => ({ ...ROW, id: `d${from + i}`, dispatchNo: `DIS/${from + i}` }));

  it("shows how many of the matching entries are on screen and loads the next page with the right offset", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
      const offset = Number(new URL(String(input), "http://x").searchParams.get("offset"));
      return Promise.resolve(jsonResponse({ data: offset === 0 ? rowsOf(50) : rowsOf(25, 50), pagination: { total: 75 } }));
    });
    render(<DispatchRegistryPage />);
    expect(await screen.findByText("Showing 50 of 75")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(await screen.findByText("Showing 75 of 75")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
    expect(fetchSpy.mock.calls.map((c) => new URL(String(c[0]), "http://x").searchParams.get("offset"))).toEqual(["0", "50"]);
  });

  it("sends the search term to the server so an old dispatch is found", async () => {
    const old = { ...ROW, id: "old", dispatchNo: "DIS/2024/9" };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
      const q = new URL(String(input), "http://x").searchParams.get("q");
      return Promise.resolve(jsonResponse(q === "2024/9" ? { data: [old], pagination: { total: 1 } } : { data: rowsOf(50), pagination: { total: 300 } }));
    });
    render(<DispatchRegistryPage />);
    await screen.findByText("Showing 50 of 300");
    fireEvent.change(screen.getByLabelText(/search/i), { target: { value: "2024/9" } });
    expect(await screen.findByText("DIS/2024/9")).toBeInTheDocument();
    expect(fetchSpy.mock.calls.some((c) => new URL(String(c[0]), "http://x").searchParams.get("q") === "2024/9")).toBe(true);
  });

  it("does not show Load more for a single short page", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ data: [ROW], pagination: { total: 1 } }));
    render(<DispatchRegistryPage />);
    await screen.findByText("DIS/2026/001");
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  });
});
