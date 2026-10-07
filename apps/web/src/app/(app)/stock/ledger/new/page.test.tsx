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

const ITEMS = { data: [{ id: "11111111-1111-4111-8111-111111111111", name: "A4 Paper", code: "STAT-001" }] };

function installFetch(createImpl?: () => Response) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes("/stock/items")) return res(true, 200, ITEMS);
    if (url.includes("/stock/entries") && init?.method === "POST") return createImpl ? createImpl() : res(true, 202, { id: "e1" });
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => { pushMock.mockReset(); refreshMock.mockReset(); });
afterEach(() => vi.unstubAllGlobals());

describe("New Stock Entry page (target of the /stock/ledger/new links)", () => {
  it("blocks submit and shows field errors when item and quantity are missing", async () => {
    const fetchMock = installFetch();
    render(<Page />);
    await waitFor(() => expect(screen.getByRole("option", { name: /A4 Paper/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Record entry" }));
    expect(await screen.findByText("Pick an item.")).toBeInTheDocument();
    expect(screen.getByText("Enter a whole quantity greater than zero.")).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "POST")).toBe(false);
  });

  it("posts the entry with the rate converted to paise", async () => {
    const fetchMock = installFetch();
    render(<Page />);
    await waitFor(() => expect(screen.getByRole("option", { name: /A4 Paper/ })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Item"), { target: { value: ITEMS.data[0]!.id } });
    fireEvent.change(screen.getByLabelText("Quantity"), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText("Rate per unit (₹)"), { target: { value: "12.50" } });
    fireEvent.click(screen.getByRole("button", { name: "Record entry" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/submitted/i));
    const post = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "POST")!;
    const body = JSON.parse((post[1] as RequestInit).body as string);
    expect(body.entryType).toBe("receipt");
    expect(body.items).toEqual([{ itemId: ITEMS.data[0]!.id, qty: 10, rateMinor: 1250, currency: "INR" }]);
  });
});
