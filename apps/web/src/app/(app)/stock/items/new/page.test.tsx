import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const pushMock = vi.fn();
const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock, refresh: refreshMock }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
}));

import Page from "./page";

function res(ok: boolean, status: number, body: unknown): Response {
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body), headers: new Headers(), clone() { return this; } } as unknown as Response;
}

const CATS = { data: [{ id: "c1", name: "Stationery" }] };
const UOMS = { data: [{ id: "u1", symbol: "ea", name: "Each" }] };

/** Default happy fetch for the two lookups; the create call is set per-test. */
function installLookupFetch(createImpl?: (url: string) => Response | Promise<Response>) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes("/stock/categories")) return res(true, 200, CATS);
    if (url.includes("/stock/uoms")) return res(true, 200, UOMS);
    if (url.includes("/stock/items") && init?.method === "POST") {
      return createImpl ? createImpl(url) : res(true, 201, { id: "new1" });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function fillValid() {
  await waitFor(() => expect(screen.getByRole("option", { name: "Stationery" })).toBeInTheDocument());
  fireEvent.change(screen.getByLabelText("Item name"), { target: { value: "A4 Paper" } });
  fireEvent.change(screen.getByLabelText("Item code"), { target: { value: "STAT-001" } });
  fireEvent.change(screen.getByLabelText("Category"), { target: { value: "c1" } });
  fireEvent.change(screen.getByLabelText("Unit of measure"), { target: { value: "u1" } });
}

beforeEach(() => {
  pushMock.mockReset();
  refreshMock.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe("New Stock Item page", () => {
  // GAP-STOCK-ITEMS-NEW-05: Cancel link present.
  it("GAP-STOCK-ITEMS-NEW-05: renders a Cancel link to /stock/list", async () => {
    installLookupFetch();
    render(<Page />);
    const cancel = await screen.findByRole("link", { name: "Cancel" });
    expect(cancel).toHaveAttribute("href", "/stock/list");
  });

  // GAP-STOCK-ITEMS-NEW-07: item type helper text.
  it("GAP-STOCK-ITEMS-NEW-07: shows helper text for the selected item type", async () => {
    installLookupFetch();
    render(<Page />);
    expect(await screen.findByText(/used up when issued/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Item type"), { target: { value: "service" } });
    expect(screen.getByText(/non-stockable service item/i)).toBeInTheDocument();
  });

  // GAP-STOCK-ITEMS-NEW-03 / 08: blank code -> inline error, no POST.
  it("GAP-STOCK-ITEMS-NEW-03/08: blank code shows an inline error (aria-linked) and makes no create request", async () => {
    const fetchMock = installLookupFetch();
    render(<Page />);
    await waitFor(() => expect(screen.getByRole("option", { name: "Stationery" })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Item name"), { target: { value: "X" } });
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "c1" } });
    fireEvent.change(screen.getByLabelText("Unit of measure"), { target: { value: "u1" } });
    fireEvent.change(screen.getByLabelText("Item code"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Create item" }));
    expect(await screen.findByText("Item code is required.")).toBeInTheDocument();
    const code = screen.getByLabelText("Item code");
    expect(code).toHaveAttribute("aria-invalid", "true");
    expect(code).toHaveAttribute("aria-describedby", "item-code-err");
    expect(fetchMock.mock.calls.some((c) => (c[1] as RequestInit | undefined)?.method === "POST")).toBe(false);
  });

  // GAP-STOCK-ITEMS-NEW-03: backend 409 fieldErrors.code shown under the field.
  it("GAP-STOCK-ITEMS-NEW-03: a 409 with fieldErrors.code renders under Item code", async () => {
    installLookupFetch(() => res(false, 409, { code: "DUPLICATE_CODE", fieldErrors: [{ field: "code", message: "That item code is already in use." }] }));
    render(<Page />);
    await fillValid();
    fireEvent.click(screen.getByRole("button", { name: "Create item" }));
    expect(await screen.findByText("That item code is already in use.")).toBeInTheDocument();
  });

  // GAP-STOCK-ITEMS-NEW-01: 201 -> "created" + redirect to list.
  it("GAP-STOCK-ITEMS-NEW-01: 201 says 'created' and redirects to /stock/list", async () => {
    installLookupFetch(() => res(true, 201, { id: "new1" }));
    render(<Page />);
    await fillValid();
    fireEvent.click(screen.getByRole("button", { name: "Create item" }));
    expect(await screen.findByText("Stock item created.")).toBeInTheDocument();
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/stock/list"));
  });

  // GAP-STOCK-ITEMS-NEW-01: 202 -> "submitted" message, not "created".
  it("GAP-STOCK-ITEMS-NEW-01: 202 says 'submitted', not 'created'", async () => {
    installLookupFetch(() => res(false, 202, { id: "new1" }));
    render(<Page />);
    await fillValid();
    fireEvent.click(screen.getByRole("button", { name: "Create item" }));
    expect(await screen.findByText(/submitted — it will appear shortly/i)).toBeInTheDocument();
    expect(screen.queryByText("Stock item created.")).not.toBeInTheDocument();
  });

  // GAP-STOCK-ITEMS-NEW-02: a lookup failure shows Retry, not a UUID input.
  it("GAP-STOCK-ITEMS-NEW-02: category lookup 500 shows Retry (no UUID input), retry succeeds", async () => {
    let callCount = 0;
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/stock/uoms")) return res(true, 200, UOMS);
      if (url.includes("/stock/categories")) {
        callCount += 1;
        if (callCount === 1) return res(false, 500, {});
        return res(true, 200, CATS);
      }
      throw new Error(`unexpected ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<Page />);
    const retry = await screen.findByRole("button", { name: "Retry" });
    expect(screen.queryByPlaceholderText(/UUID/i)).not.toBeInTheDocument();
    fireEvent.click(retry);
    await waitFor(() => expect(screen.getByRole("option", { name: "Stationery" })).toBeInTheDocument());
  });

  // GAP-STOCK-ITEMS-NEW-04: negative reorder level -> error, not silent clamp.
  it("GAP-STOCK-ITEMS-NEW-04: a negative reorder level is rejected, not silently zeroed", async () => {
    const fetchMock = installLookupFetch();
    render(<Page />);
    await fillValid();
    fireEvent.change(screen.getByLabelText(/Reorder level/i), { target: { value: "-5" } });
    fireEvent.click(screen.getByRole("button", { name: "Create item" }));
    expect(await screen.findByText(/zero or a positive whole number/i)).toBeInTheDocument();
    expect(fetchMock.mock.calls.some((c) => (c[1] as RequestInit | undefined)?.method === "POST")).toBe(false);
  });

  // GAP-STOCK-ITEMS-NEW-04: selected UOM symbol shown beside reorder fields.
  it("GAP-STOCK-ITEMS-NEW-04: shows the selected UOM symbol on the reorder labels", async () => {
    installLookupFetch();
    render(<Page />);
    await fillValid();
    expect(screen.getByLabelText(/Reorder level \(ea\)/i)).toBeInTheDocument();
  });
});
