import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";
import { DiscoveryRegistry } from "./DiscoveryRegistry";
import { mapDiscoveryRegistry, type DiscoveryRegistry as Registry } from "@/app/_data/loaders";

const reg = (over: Partial<Registry> = {}): Registry => ({
  services: [
    { serviceName: "identity-service", port: 3001, status: "ok", httpStatus: 200 },
    { serviceName: "billing-service", port: 3023, status: "down", httpStatus: 503 },
  ],
  checkedAt: "2026-10-03T06:00:00.000Z", overall: "degraded", throttled: false, ...over,
});
const ui = (props: Parameters<typeof DiscoveryRegistry>[0], locale: "en" | "hi" = "en") => (
  <NextIntlClientProvider locale={locale} messages={locale === "hi" ? hiMessages : enMessages}>
    <DiscoveryRegistry {...props} />
  </NextIntlClientProvider>
);
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });

// GAP-ADMIN-DISCOVERY-02
describe("DiscoveryRegistry", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it("lists the registered services with port, http status and a coloured status", () => {
    render(ui({ initial: reg(), source: "api" }));
    expect(screen.getByText("identity-service")).toBeInTheDocument();
    expect(screen.getByText("3023")).toBeInTheDocument();
    expect(screen.getByText("Down", { selector: ".pill" })).toHaveClass("bad");
    expect(screen.getByText("Services", { selector: ".lab" }).parentElement).toHaveTextContent("2");
    expect(screen.getByText("Running", { selector: ".lab" }).parentElement).toHaveTextContent("1");
  });

  it("an empty registry and a failed load are different screens", () => {
    const { unmount } = render(ui({ initial: reg({ services: [] }), source: "api" }));
    expect(screen.getByText("No services registered")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
    unmount();
    render(ui({ initial: reg({ services: [] }), source: "error", errorStatus: 500 }));
    expect(screen.queryByText("No services registered")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("Scan now asks the server to refresh and shows the new result", async () => {
    const fetchMock = vi.fn(async () => json({
      data: [{ serviceName: "identity-service", port: 3001, status: "ok", httpStatus: 200 }, { serviceName: "billing-service", port: 3023, status: "ok", httpStatus: 200 }],
      meta: { total: 2, overall: "ok", checkedAt: "2026-10-03T06:05:00.000Z", throttled: false },
    }));
    vi.stubGlobal("fetch", fetchMock);
    render(ui({ initial: reg(), source: "api" }));
    fireEvent.click(screen.getByRole("button", { name: "Scan now" }));
    await waitFor(() => expect(screen.getByText("Down", { selector: ".lab" }).parentElement).toHaveTextContent("0"));
    expect(fetchMock).toHaveBeenCalledWith("/api/proxy/v1/admin/discovery/services?refresh=1", { cache: "no-store" });
  });

  it("tells the operator when the scan was throttled, and keeps the rows when a scan fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ data: reg().services, meta: { total: 2, overall: "degraded", checkedAt: "2026-10-03T06:00:00.000Z", throttled: true } })));
    render(ui({ initial: reg(), source: "api" }));
    fireEvent.click(screen.getByRole("button", { name: "Scan now" }));
    expect(await screen.findByRole("status")).toHaveTextContent("A scan just ran");
    vi.stubGlobal("fetch", vi.fn(async () => json({ code: "X" }, 500)));
    fireEvent.click(screen.getByRole("button", { name: "Scan now" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("could not be completed");
    expect(screen.getByText("billing-service")).toBeInTheDocument();
  });

  it("renders in Hindi", () => {
    render(ui({ initial: reg(), source: "api" }, "hi"));
    expect(screen.getByText("सेवा खोज")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "अभी स्कैन करें" })).toBeInTheDocument();
  });

  it("mapDiscoveryRegistry reads the route payload and rejects a non-registry body", () => {
    expect(mapDiscoveryRegistry({ data: [{ serviceName: "a", port: 1, status: "ok", httpStatus: 200 }], meta: { checkedAt: "x", overall: "ok", throttled: true } }))
      .toEqual({ services: [{ serviceName: "a", port: 1, status: "ok", httpStatus: 200 }], checkedAt: "x", overall: "ok", throttled: true });
    expect(mapDiscoveryRegistry({ nope: 1 })).toBeNull();
  });
});
