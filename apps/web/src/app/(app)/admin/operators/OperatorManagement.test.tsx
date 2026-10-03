import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";
import { OperatorRowActions, type OperatorActionRow } from "./OperatorRowActions";
import { OperatorRequestsPanel } from "./OperatorRequestsPanel";
import { OperatorGrantButton } from "./OperatorGrantButton";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
const wrap = (ui: React.ReactNode, locale: "en" | "hi" = "en") => (
  <NextIntlClientProvider locale={locale} messages={locale === "hi" ? hiMessages : enMessages}>{ui}</NextIntlClientProvider>
);
const row = (over: Partial<OperatorActionRow> = {}): OperatorActionRow => ({ id: OTHER, name: "Pavan Platform", role: "platform_admin", status: "active", pendingRequest: null, ...over });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => { fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("OperatorRowActions (GAP-ADMIN-OPERATORS-05)", () => {
  it("offers Suspend and Change role for an active operator, never on your own row", () => {
    const { unmount } = render(wrap(<OperatorRowActions row={row()} viewerId={ME} onSent={() => {}} />));
    expect(screen.getByRole("button", { name: "Suspend: Pavan Platform" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change role: Pavan Platform" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Reactivate/ })).not.toBeInTheDocument();
    unmount();
    render(wrap(<OperatorRowActions row={row({ id: ME })} viewerId={ME} onSent={() => {}} />));
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows a pending badge instead of buttons while a change waits for approval", () => {
    render(wrap(<OperatorRowActions row={row({ pendingRequest: { id: "r", kind: "suspend", toRole: null, requestedBy: ME } })} viewerId={ME} onSent={() => {}} />));
    expect(screen.getByText("Change pending")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("will not send the request without a reason, then posts it and says nothing changes until approved", async () => {
    fetchMock.mockResolvedValue(json({ id: "x", status: "accepted" }, 202));
    const onSent = vi.fn();
    render(wrap(<OperatorRowActions row={row()} viewerId={ME} onSent={onSent} />));
    fireEvent.click(screen.getByRole("button", { name: "Suspend: Pavan Platform" }));
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText(/second super admin approves/)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Send for approval" })).toBeDisabled();
    fireEvent.change(within(dialog).getByRole("textbox", { name: /Reason/ }), { target: { value: "left the team" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send for approval" }));
    await waitFor(() => expect(onSent).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`/api/proxy/v1/admin/operators/${OTHER}/requests`);
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ kind: "suspend", reason: "left the team" });
  });

  it("a role change sends the other platform role", async () => {
    fetchMock.mockResolvedValue(json({ id: "x" }, 202));
    render(wrap(<OperatorRowActions row={row()} viewerId={ME} onSent={() => {}} />));
    fireEvent.click(screen.getByRole("button", { name: "Change role: Pavan Platform" }));
    fireEvent.change(screen.getByRole("textbox", { name: /Reason/ }), { target: { value: "promotion" } });
    fireEvent.click(screen.getByRole("button", { name: "Send for approval" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string)).toEqual({ kind: "role_change", reason: "promotion", toRole: "super_admin" });
  });

  it("shows catalogued copy, never the server's text or status, when refused (last super admin)", async () => {
    fetchMock.mockResolvedValue(json({ code: "LAST_SUPER_ADMIN", message: "raw server text 409" }, 409));
    render(wrap(<OperatorRowActions row={row({ role: "super_admin" })} viewerId={ME} onSent={() => {}} />));
    fireEvent.click(screen.getByRole("button", { name: "Suspend: Pavan Platform" }));
    fireEvent.change(screen.getByRole("textbox", { name: /Reason/ }), { target: { value: "rotate account" } });
    fireEvent.click(screen.getByRole("button", { name: "Send for approval" }));
    expect(await screen.findByText(/last active super admin/)).toBeInTheDocument();
    expect(screen.queryByText(/raw server text/)).not.toBeInTheDocument();
    expect(screen.queryByText(/409/)).not.toBeInTheDocument();
  });

  it("renders in Hindi", () => {
    render(wrap(<OperatorRowActions row={row()} viewerId={ME} onSent={() => {}} />, "hi"));
    expect(screen.getByRole("button", { name: /निलंबित करें/ })).toBeInTheDocument();
  });
});

const pending = (over: Record<string, unknown> = {}) => ({
  id: "r1", kind: "suspend", targetUserId: OTHER, targetName: "Bimal Super", fromRole: "super_admin", toRole: null, reason: "left the team",
  status: "pending", requestedBy: ME, requestedByName: "Asha Super", requestedAt: "2026-10-04T10:00:00Z", ...over,
});

describe("OperatorRequestsPanel (GAP-ADMIN-OPERATORS-05)", () => {
  it("loading, failed and empty are different screens, and failed can retry", async () => {
    let resolve: (r: Response) => void = () => {};
    fetchMock.mockReturnValueOnce(new Promise<Response>((r) => { resolve = r; }));
    render(wrap(<OperatorRequestsPanel viewerId={OTHER} viewerRoles={["super_admin"]} tick={0} />));
    expect(screen.getByText("Loading change requests…")).toBeInTheDocument();
    resolve(json({}, 500));
    expect(await screen.findByRole("alert")).toHaveTextContent("couldn't load the change requests");
    expect(screen.queryByText("Nothing is waiting for approval.")).not.toBeInTheDocument();
    fetchMock.mockResolvedValueOnce(json({ data: [] }));
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Nothing is waiting for approval.")).toBeInTheDocument();
  });

  it("a different super admin sees Approve and Reject; the maker sees Cancel and is told to wait", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(json({ data: [pending()] })));
    const { unmount } = render(wrap(<OperatorRequestsPanel viewerId={OTHER} viewerRoles={["super_admin"]} tick={0} />));
    expect(await screen.findByRole("button", { name: "Approve: Bimal Super" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reject: Bimal Super" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Cancel request/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Asha Super asked to suspend Bimal Super/)).toBeInTheDocument();
    unmount();
    render(wrap(<OperatorRequestsPanel viewerId={ME} viewerRoles={["super_admin"]} tick={0} />));
    expect(await screen.findByRole("button", { name: "Cancel request for Bimal Super" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Approve/ })).not.toBeInTheDocument();
    expect(screen.getByText("Waiting for a different super admin to decide.")).toBeInTheDocument();
  });

  it("a platform admin who is not the maker can see the request but not decide it", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(json({ data: [pending()] })));
    render(wrap(<OperatorRequestsPanel viewerId={OTHER} viewerRoles={["platform_admin"]} tick={0} />));
    await screen.findByText(/asked to suspend/);
    expect(screen.queryByRole("button", { name: /Approve|Reject/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Only a super admin other than the requester/)).toBeInTheDocument();
  });

  it("approve posts the decision with the optional note; reject needs a reason", async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) =>
      Promise.resolve(init?.method === "POST" ? json({ id: "x" }, 202) : json({ data: [pending()] })));
    render(wrap(<OperatorRequestsPanel viewerId={OTHER} viewerRoles={["super_admin"]} tick={0} />));
    fireEvent.click(await screen.findByRole("button", { name: "Reject: Bimal Super" }));
    let dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByRole("button", { name: "Reject" })).toBeDisabled();
    fireEvent.change(within(dialog).getByRole("textbox", { name: /Reason for rejecting/ }), { target: { value: "not approved" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Reject" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Done."));
    let post = fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "POST")!;
    expect(String(post[0])).toBe("/api/proxy/v1/admin/operators/requests/r1/reject");
    expect(JSON.parse((post[1] as RequestInit).body as string)).toEqual({ note: "not approved" });

    fetchMock.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Approve: Bimal Super" }));
    dialog = screen.getByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    post = fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "POST")!;
    expect(String(post[0])).toBe("/api/proxy/v1/admin/operators/requests/r1/approve");
  });

  it("an approval the server refuses shows catalogued copy", async () => {
    fetchMock.mockImplementation((_u: string, init?: RequestInit) =>
      Promise.resolve(init?.method === "POST" ? json({ code: "NOT_PENDING", message: "already approved 409" }, 409) : json({ data: [pending()] })));
    render(wrap(<OperatorRequestsPanel viewerId={OTHER} viewerRoles={["super_admin"]} tick={0} />));
    fireEvent.click(await screen.findByRole("button", { name: "Approve: Bimal Super" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Approve" }));
    expect(await screen.findByText(/already been decided or cancelled/)).toBeInTheDocument();
    expect(screen.queryByText(/409/)).not.toBeInTheDocument();
  });

  it("describes a role change request in words", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(json({ data: [pending({ kind: "role_change", fromRole: "platform_admin", toRole: "super_admin" })] })));
    render(wrap(<OperatorRequestsPanel viewerId={OTHER} viewerRoles={["super_admin"]} tick={0} />));
    expect(await screen.findByText(/change Bimal Super from Platform admin to Super admin/)).toBeInTheDocument();
  });

  it("describes a grant request in words and lets another super admin decide it", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(json({ data: [pending({ kind: "grant", fromRole: "none", toRole: "platform_admin" })] })));
    render(wrap(<OperatorRequestsPanel viewerId={OTHER} viewerRoles={["super_admin"]} tick={0} />));
    expect(await screen.findByText(/asked to give Bimal Super the platform role Platform admin/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve: Bimal Super" })).toBeInTheDocument();
  });
});

const people = [
  { id: "44444444-4444-4444-8444-444444444444", name: "Asha New", email: "asha@dept.gov.in" },
  { id: "33333333-3333-4333-8333-333333333333", name: "Zoya New", email: "zoya@dept.gov.in" },
];
const candidatesFor = (url: string) => {
  const q = new URL(url, "http://x").searchParams.get("q")?.toLowerCase() ?? "";
  return { data: people.filter((p) => !q || p.name.toLowerCase().includes(q) || p.email.includes(q)) };
};

describe("OperatorGrantButton (GAP-ADMIN-OPERATORS-05)", () => {
  it("lists the server's candidates, requires a person and a reason, then posts a grant request", async () => {
    fetchMock.mockImplementation((u: string, init?: RequestInit) =>
      Promise.resolve(init?.method === "POST" ? json({ id: "x" }, 202) : json(candidatesFor(u))));
    const onSent = vi.fn();
    render(wrap(<OperatorGrantButton onSent={onSent} />));
    fireEvent.click(screen.getByRole("button", { name: "Grant operator role" }));
    const dialog = await screen.findByRole("alertdialog");
    const person = await within(dialog).findByRole("combobox", { name: "Person" });
    expect(within(person).getAllByRole("option").map((o) => o.textContent)).toEqual(["Choose a person", "Asha New (asha@dept.gov.in)", "Zoya New (zoya@dept.gov.in)"]);
    expect(String(fetchMock.mock.calls[0]![0])).toBe("/api/proxy/v1/admin/operators/candidates?limit=25");
    expect(within(dialog).getByRole("button", { name: "Send for approval" })).toBeDisabled();
    fireEvent.change(person, { target: { value: "33333333-3333-4333-8333-333333333333" } });
    fireEvent.change(within(dialog).getByRole("combobox", { name: "Platform role" }), { target: { value: "super_admin" } });
    fireEvent.change(within(dialog).getByRole("textbox", { name: /Reason/ }), { target: { value: "joins the platform team" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send for approval" }));
    await waitFor(() => expect(onSent).toHaveBeenCalled());
    const post = fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "POST")!;
    expect(String(post[0])).toBe("/api/proxy/v1/admin/operators/33333333-3333-4333-8333-333333333333/requests");
    expect(JSON.parse((post[1] as RequestInit).body as string)).toEqual({ kind: "grant", reason: "joins the platform team", toRole: "super_admin" });
  });

  it("the search box asks the server (not a client-side filter of a first page)", async () => {
    fetchMock.mockImplementation((u: string) => Promise.resolve(json(candidatesFor(u))));
    render(wrap(<OperatorGrantButton onSent={() => {}} />));
    fireEvent.click(screen.getByRole("button", { name: "Grant operator role" }));
    await screen.findByRole("combobox", { name: "Person" });
    fireEvent.change(screen.getByRole("searchbox", { name: "Search people" }), { target: { value: "zoy a" } });
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("q=zoy%20a"))).toBe(true), { timeout: 3000 });
    fireEvent.change(screen.getByRole("searchbox", { name: "Search people" }), { target: { value: "zoya" } });
    const person = await screen.findByRole("combobox", { name: "Person" }, { timeout: 3000 });
    await waitFor(() => expect(within(person).getAllByRole("option").map((o) => o.textContent)).toEqual(["Choose a person", "Zoya New (zoya@dept.gov.in)"]), { timeout: 3000 });
    fireEvent.change(screen.getByRole("searchbox", { name: "Search people" }), { target: { value: "nobody-here" } });
    expect(await screen.findByText("Nobody matches that search.", {}, { timeout: 3000 })).toBeInTheDocument();
  });

  it("loading, failed (with retry) and nobody-left are different screens", async () => {
    let resolve: (r: Response) => void = () => {};
    fetchMock.mockReturnValueOnce(new Promise<Response>((r) => { resolve = r; }));
    render(wrap(<OperatorGrantButton onSent={() => {}} />));
    fireEvent.click(screen.getByRole("button", { name: "Grant operator role" }));
    expect(await screen.findByText("Loading people…")).toBeInTheDocument();
    resolve(json({}, 500));
    expect(await screen.findByText(/couldn't load the list of people/)).toBeInTheDocument();
    fetchMock.mockImplementationOnce(() => Promise.resolve(json({ data: [] })));
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("There is nobody left to grant a platform role to.")).toBeInTheDocument();
  });

  it("shows catalogued copy when the server refuses", async () => {
    fetchMock.mockImplementation((u: string, init?: RequestInit) =>
      Promise.resolve(init?.method === "POST" ? json({ code: "ALREADY_PENDING", message: "raw 409" }, 409) : json(candidatesFor(u))));
    render(wrap(<OperatorGrantButton onSent={() => {}} />));
    fireEvent.click(screen.getByRole("button", { name: "Grant operator role" }));
    const person = await screen.findByRole("combobox", { name: "Person" });
    fireEvent.change(person, { target: { value: "33333333-3333-4333-8333-333333333333" } });
    fireEvent.change(screen.getByRole("textbox", { name: /Reason/ }), { target: { value: "needs access" } });
    fireEvent.click(screen.getByRole("button", { name: "Send for approval" }));
    expect(await screen.findByText(/already waiting for approval/)).toBeInTheDocument();
    expect(screen.queryByText(/raw 409/)).not.toBeInTheDocument();
  });

  it("renders in Hindi", () => {
    render(wrap(<OperatorGrantButton onSent={() => {}} />, "hi"));
    expect(screen.getByRole("button", { name: "ऑपरेटर भूमिका दें" })).toBeInTheDocument();
  });
});
