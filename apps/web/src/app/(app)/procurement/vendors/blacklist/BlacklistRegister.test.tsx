import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("next-intl", async (orig) => {
  const actual = await orig<typeof import("next-intl")>();
  const messages = (await import("@/messages/en.json")).default;
  return { ...actual, useTranslations: (ns?: string) => actual.createTranslator({ locale: "en", messages, namespace: ns as never }) };
});

import { maskPan } from "@/app/_components/ds/Masked";
import { BlacklistRegister } from "./BlacklistRegister";

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
const local = { id: "b1", vendorId: "v-1", reason: "Forged invoices", blacklistedFrom: "2026-01-10", blacklistedUntil: null };
const central = { id: "c1", vendorId: "v-9", pan: "ABCDE1234F", reason: "Debarred by CVC", blacklistedFrom: "2026-02-01", blacklistedUntil: "2027-02-01", orderRef: "CVC/2026/14" };

let calls: Array<{ url: string; method: string; body?: string }>;
function stub(opts: { localRows?: unknown[]; failLocal?: boolean; mutate?: Response } = {}) {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({ url, method, body: init?.body as string | undefined });
    if (method !== "GET") return (opts.mutate ?? json({ taskId: "t" }, 202)).clone();
    if (url.includes("/vendor-blacklist")) return opts.failLocal ? new Response("{}", { status: 500 }) : json({ data: opts.localRows ?? [local], total: 1 });
    if (url.includes("/central-debarment")) return json({ data: [central], total: 1 });
    return json({ data: [{ id: "v-1", name: "Shree Ram Traders" }] });
  }));
}
beforeEach(() => vi.restoreAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe("BlacklistRegister", () => {
  it("lists blacklisted vendors by name and central debarments by PAN", async () => {
    stub();
    render(<BlacklistRegister canCentralDebar={false} />);
    expect(await screen.findByText("Shree Ram Traders")).toBeInTheDocument();
    expect(screen.getByText(maskPan(central.pan))).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add central debarment" })).not.toBeInTheDocument();
  });

  it("shows an empty state and an error state honestly", async () => {
    stub({ localRows: [] });
    const { unmount } = render(<BlacklistRegister canCentralDebar={false} />);
    expect(await screen.findByText("No vendors are currently blacklisted.")).toBeInTheDocument();
    unmount();
    stub({ failLocal: true });
    render(<BlacklistRegister canCentralDebar={false} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/Couldn.t load this register/);
    expect(screen.queryByText("No vendors are currently blacklisted.")).not.toBeInTheDocument();
  });

  it("reinstates via DELETE after a confirmation that states the consequence", async () => {
    stub();
    render(<BlacklistRegister canCentralDebar={false} />);
    fireEvent.click(await screen.findByRole("button", { name: "Reinstate" }));
    const dlg = screen.getByRole("alertdialog");
    expect(dlg).toHaveTextContent(/removed from the blacklist/);
    fireEvent.click(within(dlg).getByRole("button", { name: "Reinstate" }));
    await waitFor(() => expect(calls.some((c) => c.method === "DELETE")).toBe(true));
    expect(calls.find((c) => c.method === "DELETE")!.url).toBe("/api/proxy/v1/procurement/vendors/v-1/blacklist");
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/Request accepted/));
  });

  it("super_admin: blocks confirm until PAN is valid, then POSTs the debarment", async () => {
    stub();
    render(<BlacklistRegister canCentralDebar />);
    fireEvent.click(await screen.findByRole("button", { name: "Add central debarment" }));
    const dlg = screen.getByRole("alertdialog");
    const confirm = within(dlg).getAllByRole("button", { name: "Add central debarment" })[0];
    fireEvent.change(within(dlg).getByLabelText(/^PAN/), { target: { value: "abc" } });
    expect(within(dlg).getByText(/PAN must be 10/)).toBeInTheDocument();
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dlg).getByLabelText(/^PAN/), { target: { value: "pqrst5678u" } });
    fireEvent.change(within(dlg).getByLabelText(/^From/), { target: { value: "2026-11-01" } });
    fireEvent.change(within(dlg).getAllByRole("textbox").find((e) => e.tagName === "TEXTAREA")!, { target: { value: "Fraud per order 14" } });
    fireEvent.click(confirm);
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    const post = calls.find((c) => c.method === "POST")!;
    expect(post.url).toBe("/api/proxy/v1/procurement/central-debarment");
    expect(JSON.parse(post.body!)).toEqual({ pan: "PQRST5678U", reason: "Fraud per order 14", blacklistedFrom: "2026-11-01" });
  });

  it("requests vendor names in chunks of at most 100 ids", async () => {
    const many = Array.from({ length: 150 }, (_, i) => ({ ...local, id: `b${i}`, vendorId: `v-${i}` }));
    stub({ localRows: many });
    render(<BlacklistRegister canCentralDebar={false} />);
    await waitFor(() => expect(calls.filter((c) => c.url.includes("/vendors/names")).length).toBe(2));
    const sizes = calls.filter((c) => c.url.includes("/vendors/names")).map((c) => decodeURIComponent(c.url.split("ids=")[1]).split(",").length);
    expect(sizes.sort((x, y) => x - y)).toEqual([50, 100]);
  });
});
