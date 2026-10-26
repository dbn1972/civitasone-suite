import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@/test-utils/intl-render";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

import { RecordOrderForm } from "./RecordOrderForm";

const CASES = [{ id: "c1", label: "WP/1/2026 · A v B" }];
const DEPTS = [{ id: "99999999-aaaa-4000-8000-000000000001", name: "Revenue Department" }, { id: "99999999-aaaa-4000-8000-000000000002", name: "Public Works Department" }];

function mockFetch(impl: (url: string, init?: RequestInit) => Promise<Response>) {
  globalThis.fetch = vi.fn(impl as unknown as typeof fetch) as unknown as typeof fetch;
}

describe("RecordOrderForm owning department (GAP-LEGAL-COURT-ORDERS-NEW-04, decision #11)", () => {
  beforeEach(() => pushMock.mockReset());
  afterEach(() => vi.restoreAllMocks());

  it("offers the org-hierarchy departments in a select instead of free text", async () => {
    mockFetch(async () => new Response(JSON.stringify({ items: DEPTS }), { status: 200 }));
    render(<RecordOrderForm cases={CASES} />);
    await waitFor(() => expect(screen.getByRole("option", { name: "Revenue Department" })).toBeInTheDocument());
    const field = screen.getByLabelText("Owning department");
    expect(field.tagName).toBe("SELECT");
  });

  it("sends the department ID (deptRef), not the name, when recording the order", async () => {
    const calls: Array<{ url: string; body?: Record<string, unknown> }> = [];
    mockFetch(async (url, init) => {
      calls.push({ url, body: init?.body ? JSON.parse(init.body as string) : undefined });
      if (url.includes("/v1/legal/departments")) return new Response(JSON.stringify({ items: DEPTS }), { status: 200 });
      return new Response(JSON.stringify({ id: "o1", status: "accepted" }), { status: 202 });
    });
    render(<RecordOrderForm cases={CASES} />);
    await waitFor(() => expect(screen.getByRole("option", { name: "Revenue Department" })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Case *"), { target: { value: "c1" } });
    fireEvent.change(screen.getByLabelText("Order date *"), { target: { value: "2026-04-01" } });
    fireEvent.change(screen.getByLabelText("Summary *"), { target: { value: "Reply within 4 weeks" } });
    fireEvent.change(screen.getByLabelText("Owning department"), { target: { value: DEPTS[0]!.id } });
    fireEvent.click(screen.getByRole("button", { name: "Record order" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Record order" }));
    await waitFor(() => expect(calls.some((c) => c.url.includes("/cases/c1/orders"))).toBe(true));
    expect(calls.find((c) => c.url.includes("/cases/c1/orders"))!.body).toMatchObject({ deptRef: DEPTS[0]!.id });
  });

  it("says so when the department list cannot be loaded", async () => {
    mockFetch(async () => new Response("{}", { status: 503 }));
    render(<RecordOrderForm cases={CASES} />);
    expect(await screen.findByText(/department list could not be loaded/)).toBeInTheDocument();
    expect(screen.getByLabelText("Owning department")).toBeDisabled();
  });
});
