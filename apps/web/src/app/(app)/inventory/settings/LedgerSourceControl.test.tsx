import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
vi.mock("@/app/_components/ds", async () => {
  const actual = await vi.importActual<typeof import("@/app/_components/ds")>("@/app/_components/ds");
  return { ...actual, useToast: () => ({ toast }) };
});
const purge = vi.hoisted(() => ({ purgeInventoryCache: vi.fn(async () => undefined) }));
vi.mock("../_revalidate", () => purge);

const { LedgerSourceControl } = await import("./LedgerSourceControl");
const fetchMock = vi.fn();
const show = (initial: "stock" | "inventory") =>
  render(<NextIntlClientProvider locale="en" messages={enMessages}><LedgerSourceControl initial={initial} /></NextIntlClientProvider>);

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
});

describe("LedgerSourceControl", () => {
  it("shows the current choice and saves only the changed setting", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 202 }));
    show("stock");
    expect(screen.getByRole("radio", { name: /Stock register \(legacy\)/ })).toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: /^Inventory:/ }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/proxy/v1/inventory/settings");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body)).toEqual({ ledgerSource: "inventory" });
    expect(purge.purgeInventoryCache).toHaveBeenCalled();
    expect(screen.getByRole("radio", { name: /^Inventory:/ })).toBeChecked();
  });

  it("a failed save keeps the old choice and shows a plain message", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 403 }));
    show("stock");
    fireEvent.click(screen.getByRole("radio", { name: /^Inventory:/ }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Stock register \(legacy\)/ })).toBeChecked();
    expect(purge.purgeInventoryCache).not.toHaveBeenCalled();
  });
});
