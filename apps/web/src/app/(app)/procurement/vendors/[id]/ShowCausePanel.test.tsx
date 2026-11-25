import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("next-intl", async (orig) => {
  const actual = await orig<typeof import("next-intl")>();
  const messages = (await import("@/messages/en.json")).default;
  return { ...actual, useTranslations: (ns?: string) => actual.createTranslator({ locale: "en", messages, namespace: ns as never }) };
});

import { ShowCausePanel } from "./ShowCausePanel";

const row = (o: Record<string, unknown>) => ({ id: "sc-1", status: "issued", reason: "Repeated late supply", issuedBy: "u-maker", ...o });
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

let calls: Array<{ url: string; method: string; body?: string }>;
function stub(rows: unknown[], mutate: Response = json({ taskId: "t1" }, 202)) {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? "GET", body: init?.body as string | undefined });
    return (init?.method ?? "GET") === "GET" ? json({ data: rows }) : mutate.clone();
  }));
}
beforeEach(() => vi.restoreAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe("ShowCausePanel", () => {
  it("shows an empty state", async () => {
    stub([]);
    render(<ShowCausePanel vendorId="v1" canWrite canDecide={false} currentUserId="u1" />);
    expect(await screen.findByText(/No show-cause notices/)).toBeInTheDocument();
  });

  it("shows a retryable error, not an empty list, when the load fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));
    render(<ShowCausePanel vendorId="v1" canWrite canDecide={false} currentUserId="u1" />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/Couldn.t load/);
    expect(screen.queryByText(/No show-cause notices/)).not.toBeInTheDocument();
  });

  it("issues a notice with POST { reason } and reports acceptance, not completion", async () => {
    stub([]);
    render(<ShowCausePanel vendorId="v1" canWrite canDecide={false} currentUserId="u1" />);
    await screen.findByText(/No show-cause notices/);
    fireEvent.click(screen.getByRole("button", { name: "Issue show-cause" }));
    const dlg = screen.getByRole("alertdialog");
    fireEvent.change(within(dlg).getByRole("textbox"), { target: { value: "  Repeated late supply  " } });
    fireEvent.click(within(dlg).getByRole("button", { name: "Issue show-cause" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/Request accepted/));
    const post = calls.find((c) => c.method === "POST")!;
    expect(post.url).toBe("/api/proxy/v1/procurement/vendors/v1/show-cause");
    expect(JSON.parse(post.body!)).toEqual({ reason: "Repeated late supply" });
  });

  it("hides write controls from read-only roles", async () => {
    stub([row({})]);
    render(<ShowCausePanel vendorId="v1" canWrite={false} canDecide={false} currentUserId="u1" />);
    await screen.findByText("Repeated late supply");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("offers respond only on an issued notice and PATCHes { response }", async () => {
    stub([row({})]);
    render(<ShowCausePanel vendorId="v1" canWrite canDecide={false} currentUserId="u1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Record response" }));
    const dlg = screen.getByRole("alertdialog");
    fireEvent.change(within(dlg).getByRole("textbox"), { target: { value: "Delay was due to floods" } });
    fireEvent.click(within(dlg).getByRole("button", { name: "Record response" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));
    const p = calls.find((c) => c.method === "PATCH")!;
    expect(p.url).toBe("/api/proxy/v1/procurement/show-cause/sc-1/respond");
    expect(JSON.parse(p.body!)).toEqual({ response: "Delay was due to floods" });
  });

  it("offers appeal only after a response, and uphold only after response/appeal", async () => {
    stub([row({ status: "responded", response: "Floods" })]);
    render(<ShowCausePanel vendorId="v1" canWrite canDecide currentUserId="u-checker" />);
    expect(await screen.findByRole("button", { name: "File appeal" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Uphold" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Record response" })).not.toBeInTheDocument();
  });

  it("does not offer uphold on a merely issued notice", async () => {
    stub([row({})]);
    render(<ShowCausePanel vendorId="v1" canWrite canDecide currentUserId="u-checker" />);
    await screen.findByRole("button", { name: "Close without action" });
    expect(screen.queryByRole("button", { name: "Uphold" })).not.toBeInTheDocument();
  });

  it("upholds with the debarment-proposal warning and PATCHes { decision, uphold: true }", async () => {
    stub([row({ status: "appealed" })]);
    render(<ShowCausePanel vendorId="v1" canWrite canDecide currentUserId="u-checker" />);
    fireEvent.click(await screen.findByRole("button", { name: "Uphold" }));
    const dlg = screen.getByRole("alertdialog");
    expect(dlg).toHaveTextContent(/proposes debarment/);
    fireEvent.change(within(dlg).getByRole("textbox"), { target: { value: "Appeal rejected" } });
    fireEvent.click(within(dlg).getByRole("button", { name: "Uphold" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));
    const p = calls.find((c) => c.method === "PATCH")!;
    expect(p.url).toBe("/api/proxy/v1/procurement/show-cause/sc-1/decide");
    expect(JSON.parse(p.body!)).toEqual({ decision: "Appeal rejected", uphold: true });
  });

  it("maker-checker: the issuer is not offered decide controls", async () => {
    stub([row({ status: "responded" })]);
    render(<ShowCausePanel vendorId="v1" canWrite canDecide currentUserId="u-maker" />);
    await screen.findByText(/different officer must decide/);
    expect(screen.queryByRole("button", { name: "Uphold" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Close without action" })).not.toBeInTheDocument();
  });

  it("surfaces a server rejection instead of faking success", async () => {
    stub([row({})], json({ code: "FORBIDDEN", message: "x" }, 403));
    render(<ShowCausePanel vendorId="v1" canWrite canDecide={false} currentUserId="u1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Record response" }));
    const dlg = screen.getByRole("alertdialog");
    fireEvent.change(within(dlg).getByRole("textbox"), { target: { value: "ok" } });
    fireEvent.click(within(dlg).getByRole("button", { name: "Record response" }));
    await waitFor(() => expect(within(screen.getByRole("alertdialog")).getByRole("alert")).toBeInTheDocument());
    expect(screen.queryByText(/Request accepted/)).not.toBeInTheDocument();
  });
});
