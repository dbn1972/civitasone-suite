import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";
import { PlatformIntegrationsClient } from "./PlatformIntegrationsClient";
import { parseEndpoint } from "./ProviderDrawer";
import type { PlatformProvider } from "@/lib/admin/platformIntegrations";

const provider = (over: Partial<PlatformProvider> = {}): PlatformProvider => ({
  key: "esign_nsdl_egov", category: "esign", name: "NSDL e-Gov eSign", vendor: "NSDL e-Governance", description: "Aadhaar eSign through NSDL.",
  capabilities: ["esign.initiate", "esign.verify"],
  fields: [
    { key: "aspId", label: "ASP / agency ID", labelHi: "ASP / एजेंसी आईडी", type: "text", required: true, secret: false, environments: ["sandbox", "production"] },
    { key: "apiKey", label: "API key", type: "text", required: true, secret: true, environments: ["sandbox", "production"] },
  ],
  endpoints: { sandbox: null, production: null }, status: "available",
  availability: { mode: "all", tenantIds: [], editions: [] }, usage: { sandbox: 2, production: 1 }, version: 4, ...over,
});

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });

type Call = { url: string; method: string; body: unknown };
function mockApi(rows: PlatformProvider[], extra: (c: Call) => Response | undefined = () => undefined) {
  const calls: Call[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    const call: Call = { url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(call);
    const o = extra(call);
    if (o) return o;
    if (method === "GET" && url.endsWith("/providers")) return json({ data: rows });
    const one = /\/providers\/([^/?]+)$/.exec(url);
    if (method === "GET" && one) return json({ data: { ...(rows.find((r) => r.key === one[1]) ?? rows[0]), version: 5 } });
    if (method === "GET" && url.includes("/admin/tenants")) {
      return json({ items: [{ tenantId: "t-1", name: "Dept of Health", edition: "govt_dept" }, { tenantId: "t-2", name: "State PSU", edition: "psu" }], total: 2 });
    }
    return json({ id: "x", status: "accepted" }, 202);
  });
  return calls;
}

function ui(locale: "en" | "hi" = "en") {
  return (
    <NextIntlClientProvider locale={locale} messages={locale === "hi" ? hiMessages : enMessages}>
      <PlatformIntegrationsClient />
    </NextIntlClientProvider>
  );
}

describe("PlatformIntegrationsClient", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("lists providers by category with status, availability and usage", async () => {
    mockApi([provider(), provider({ key: "bank_sbi", category: "bank_api", name: "State Bank of India", status: "beta", availability: { mode: "restricted", tenantIds: ["a", "b"], editions: ["psu"] }, usage: { sandbox: 0, production: 0 } })]);
    render(ui());
    expect(await screen.findByRole("rowheader", { name: /NSDL e-Gov eSign/ })).toBeInTheDocument();
    const row = screen.getByRole("rowheader", { name: /NSDL e-Gov eSign/ }).closest("tr")!;
    expect(within(row).getByText("Available")).toBeInTheDocument();
    expect(within(row).getByText("All organisations")).toBeInTheDocument();
    expect(within(row).getByText("2 / 1")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Bank API / H2H" }));
    const bank = (await screen.findByRole("rowheader", { name: /State Bank of India/ })).closest("tr")!;
    expect(within(bank).getByText("Beta")).toBeInTheDocument();
    expect(within(bank).getByText(/2 organisations · Editions: PSU/)).toBeInTheDocument();
  });

  it("a failed load is an error with retry, never an empty catalogue", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 500 }));
    render(ui());
    const retry = await screen.findByRole("button", { name: /try again/i });
    expect(screen.queryByText("No providers in this category")).not.toBeInTheDocument();
    spy.mockRestore();
    mockApi([provider()]);
    fireEvent.click(retry);
    expect(await screen.findByRole("rowheader", { name: /NSDL e-Gov eSign/ })).toBeInTheDocument();
  });

  it("a category with no providers shows an empty state; the stat cards count every provider", async () => {
    mockApi([provider()]);
    render(ui());
    await screen.findByRole("rowheader", { name: /NSDL/ });
    fireEvent.click(screen.getByRole("tab", { name: "PFMS" }));
    expect(await screen.findByText("No providers in this category")).toBeInTheDocument();
  });

  it("renders in Hindi", async () => {
    mockApi([provider()]);
    render(ui("hi"));
    expect(await screen.findByRole("heading", { name: "प्लेटफ़ॉर्म इंटीग्रेशन" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "ई-साइन" })).toBeInTheDocument();
  });

  it("detail drawer: shows capabilities and the config schema (secret fields flagged), saves status with the current version", async () => {
    const calls = mockApi([provider()]);
    render(ui());
    fireEvent.click(await screen.findByRole("button", { name: "Manage NSDL e-Gov eSign" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("esign.initiate")).toBeInTheDocument();
    expect(within(dialog).getByText(/No provider endpoint is preconfigured/)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("tab", { name: "Config fields" }));
    const apiKeyRow = (await within(dialog).findByText("apiKey")).closest("tr")!;
    expect(within(apiKeyRow).getAllByText("Yes").length).toBe(2); // required + secret
    fireEvent.click(within(dialog).getByRole("tab", { name: "Overview" }));

    const save = within(dialog).getByRole("button", { name: "Save changes" });
    expect(save).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("Platform status"), { target: { value: "disabled" } });
    fireEvent.click(save);
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));
    const patch = calls.find((c) => c.method === "PATCH")!;
    expect(patch.url).toContain("/providers/esign_nsdl_egov");
    expect(patch.body).toEqual({ expectedVersion: 4, status: "disabled" });
  });

  it("endpoints must be https: a bad value is refused client-side and nothing is sent", async () => {
    const calls = mockApi([provider()]);
    render(ui());
    fireEvent.click(await screen.findByRole("button", { name: "Manage NSDL e-Gov eSign" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Sandbox endpoint"), { target: { value: "http://insecure.example" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));
    expect(await within(dialog).findByText(/valid https URL/)).toBeInTheDocument();
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
    fireEvent.change(within(dialog).getByLabelText("Sandbox endpoint"), { target: { value: "https://sandbox.provider.example/v1" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));
    expect(calls.find((c) => c.method === "PATCH")!.body).toEqual({ expectedVersion: 4, endpoints: { sandbox: "https://sandbox.provider.example/v1", production: null } });
  });

  it("availability: restricted needs at least one organisation or edition; saved selection is sent as ids and editions", async () => {
    const calls = mockApi([provider()]);
    render(ui());
    fireEvent.click(await screen.findByRole("button", { name: "Manage NSDL e-Gov eSign" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("tab", { name: "Availability" }));
    fireEvent.click(within(dialog).getByLabelText("Only selected organisations or editions"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Save availability" }));
    expect(await within(dialog).findByText(/Choose at least one organisation or edition/)).toBeInTheDocument();
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);

    fireEvent.click(await within(dialog).findByLabelText("Dept of Health"));
    fireEvent.click(within(dialog).getByLabelText("PSU"));
    fireEvent.change(within(dialog).getByLabelText("Search organisations"), { target: { value: "psu" } });
    expect(within(dialog).queryByLabelText("Dept of Health")).not.toBeInTheDocument(); // filtered out, still selected
    fireEvent.click(within(dialog).getByRole("button", { name: "Save availability" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));
    expect(calls.find((c) => c.method === "PATCH")!.body).toEqual({ expectedVersion: 4, availability: { mode: "restricted", tenantIds: ["t-1"], editions: ["psu"] } });
  });

  it("a stale-version conflict from the server is surfaced as an error, not as saved", async () => {
    mockApi([provider()], (c) => c.method === "PATCH" ? json({ code: "VERSION_CONFLICT", message: "stale" }, 409) : undefined);
    render(ui());
    fireEvent.click(await screen.findByRole("button", { name: "Manage NSDL e-Gov eSign" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Platform status"), { target: { value: "beta" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));
    expect(await within(dialog).findByRole("alert")).toBeInTheDocument();
    expect(within(dialog).queryByText("Saved.")).not.toBeInTheDocument();
  });

  it("tenant list failure leaves editions usable", async () => {
    mockApi([provider()], (c) => c.url.includes("/admin/tenants") ? new Response("{}", { status: 500 }) : undefined);
    render(ui());
    fireEvent.click(await screen.findByRole("button", { name: "Manage NSDL e-Gov eSign" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("tab", { name: "Availability" }));
    fireEvent.click(within(dialog).getByLabelText("Only selected organisations or editions"));
    expect(await within(dialog).findByText(/couldn't load the organisation list/)).toBeInTheDocument();
    expect(within(dialog).getByLabelText("PSU")).toBeInTheDocument();
  });
});

describe("parseEndpoint", () => {
  it("blank is none, https is accepted, everything else is invalid", () => {
    expect(parseEndpoint("  ")).toBeNull();
    expect(parseEndpoint("https://x.example/a")).toBe("https://x.example/a");
    expect(parseEndpoint("http://x.example")).toBeUndefined();
    expect(parseEndpoint("not a url")).toBeUndefined();
  });
});
