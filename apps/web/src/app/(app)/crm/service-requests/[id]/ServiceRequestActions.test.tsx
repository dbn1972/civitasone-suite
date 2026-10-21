import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, fireEvent, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

function render(ui: ReactElement) {
  return rtlRender(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { ServiceRequestActions } from "./ServiceRequestActions";

const SR_ID = "c535cf46-8472-40d9-9207-b13f54097255";

describe("ServiceRequestActions", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("renders a terminal message and no action buttons once closed", () => {
    render(<ServiceRequestActions id={SR_ID} status="closed" />);
    expect(screen.getByText(/This request is closed — no further action available/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  // Regression test for the CRITICAL bug: every status transition called
  // fetch("/api/v1/crm/service-requests/.../status") instead of the only
  // working client-mutation prefix "/api/proxy/v1/crm/service-requests/...".
  // Before the fix this 404'd against the Next.js app itself every time.
  it("moves an open request to in-progress via the correct proxied endpoint", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { id: SR_ID } }), { status: 200 }),
    );

    render(<ServiceRequestActions id={SR_ID} status="open" />);
    fireEvent.click(screen.getByRole("button", { name: "Start work" }));
    await waitFor(() => expect(screen.getByText("Move to in progress?")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(`/api/proxy/v1/crm/service-requests/${SR_ID}/status`);
    expect((init as RequestInit).method).toBe("PATCH");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ status: "in_progress" });
  });

  it("resolves with a resolution note, notifying the citizen, via the correct proxied endpoint", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { id: SR_ID } }), { status: 200 }),
    );

    render(<ServiceRequestActions id={SR_ID} status="in_progress" />);
    fireEvent.click(screen.getByRole("button", { name: "Resolve" }));
    await waitFor(() => expect(screen.getByText("Resolve this request?")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Resolution"), { target: { value: "Certificate issued" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(`/api/proxy/v1/crm/service-requests/${SR_ID}/status`);
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      status: "resolved",
      resolution: "Certificate issued",
    });
  });
  // GAP-CRM-SERVICE-REQUESTS-DETAIL-01: a Mark-pending reason is a waiting note,
  // not a resolution — it must be sent as `statusNote`, never `resolution`.
  it("marks pending with the reason under statusNote (not resolution)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { id: SR_ID } }), { status: 200 }),
    );

    render(<ServiceRequestActions id={SR_ID} status="in_progress" />);
    fireEvent.click(screen.getByRole("button", { name: "Mark pending" }));
    await waitFor(() => expect(screen.getByText("Mark this request pending?")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("What is it waiting on?"), { target: { value: "Awaiting citizen documents" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    const [, init] = fetchSpy.mock.calls[0];
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      status: "pending",
      statusNote: "Awaiting citizen documents",
    });
  });


  it("closes (danger action) via the correct proxied endpoint", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { id: SR_ID } }), { status: 200 }),
    );

    render(<ServiceRequestActions id={SR_ID} status="in_progress" />);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.getByText("Close this request?")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Closing remarks"), { target: { value: "Duplicate request" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(`/api/proxy/v1/crm/service-requests/${SR_ID}/status`);
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      status: "closed",
      statusNote: "Duplicate request",
    });
  });

  // UX-016: `setStatus` used to echo the backend's raw `message` field (or a
  // bare `HTTP ${status}` fallback) verbatim. It must now show only the
  // catalogued, clerk-safe copy — never the raw server text — and must not
  // refresh on failure.
  it("surfaces a clerk-safe error inside the dialog instead of the raw server text, and does not refresh", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ message: "request already closed" }), { status: 409 }),
    );

    render(<ServiceRequestActions id={SR_ID} status="open" />);
    fireEvent.click(screen.getByRole("button", { name: "Start work" }));
    await waitFor(() => expect(screen.getByText("Move to in progress?")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    expect(await screen.findByText(/couldn't save/i)).toBeInTheDocument();
    expect(screen.queryByText("request already closed")).not.toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  // GAP-CRM-SERVICE-REQUESTS-DETAIL-03: the PATCH must carry the version the
  // page read, so the server can reject a stale write.
  it("includes the fetched version in the PATCH body", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { id: SR_ID } }), { status: 200 }),
    );

    render(<ServiceRequestActions id={SR_ID} status="open" version={7} />);
    fireEvent.click(screen.getByRole("button", { name: "Start work" }));
    await waitFor(() => expect(screen.getByText("Move to in progress?")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    const [, init] = fetchSpy.mock.calls[0];
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      status: "in_progress",
      version: 7,
    });
  });

  // GAP-CRM-SERVICE-REQUESTS-DETAIL-03: a VERSION_CONFLICT (someone else changed
  // the request) must show a reload message and refresh — not the generic error.
  it("on a VERSION_CONFLICT shows a reload message and refreshes", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "VERSION_CONFLICT" } }), { status: 409 }),
    );

    render(<ServiceRequestActions id={SR_ID} status="open" version={2} />);
    fireEvent.click(screen.getByRole("button", { name: "Start work" }));
    await waitFor(() => expect(screen.getByText("Move to in progress?")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    expect(await screen.findByText(/someone else changed this request/i)).toBeInTheDocument();
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  // GAP-CRM-SERVICE-REQUESTS-DETAIL-05: Cancel sends status=cancelled with a reason.
  it("cancels a request (status=cancelled) with a mandatory reason", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { id: SR_ID } }), { status: 200 }),
    );

    render(<ServiceRequestActions id={SR_ID} status="open" version={1} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel request" }));
    await waitFor(() => expect(screen.getByText("Cancel this request?")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Reason for cancellation"), { target: { value: "Filed in error" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    const [, init] = fetchSpy.mock.calls[0];
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      status: "cancelled",
      statusNote: "Filed in error",
      version: 1,
    });
  });

  // GAP-CRM-SERVICE-REQUESTS-DETAIL-05: a cancelled request is terminal.
  it("renders a terminal message once cancelled", () => {
    render(<ServiceRequestActions id={SR_ID} status="cancelled" />);
    expect(screen.getByText(/This request is cancelled — no further action available/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  // GAP-CRM-SERVICE-REQUESTS-DETAIL-06: Close is not offered while the request
  // is still 'open' (never worked) — it must be started/resolved first, or
  // cancelled if withdrawn.
  it("does not offer Close while the request is still open", () => {
    render(<ServiceRequestActions id={SR_ID} status="open" />);
    expect(screen.queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
    // Start work and Cancel request remain available.
    expect(screen.getByRole("button", { name: "Start work" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel request" })).toBeInTheDocument();
  });

  // GAP-CRM-SERVICE-REQUESTS-DETAIL-06: a reason-bearing transition now needs a
  // meaningful note — Confirm stays disabled at a 2-char "ok" and enables at 10+.
  it("requires a ≥10-char closing remark before Close can be confirmed", async () => {
    render(<ServiceRequestActions id={SR_ID} status="in_progress" />);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.getByText("Close this request?")).toBeInTheDocument());
    const confirm = screen.getByRole("button", { name: "Confirm" });
    const reason = screen.getByLabelText("Closing remarks");
    fireEvent.change(reason, { target: { value: "ok" } });
    expect(confirm).toBeDisabled();
    fireEvent.change(reason, { target: { value: "Duplicate request" } });
    expect(confirm).not.toBeDisabled();
  });
});

// GAP-CRM-SERVICE-REQUESTS-DETAIL-04 — the status response says what happens to the citizen notice.
describe("ServiceRequestActions - citizen notice outcome (DETAIL-04)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  async function resolveWith(notification: unknown, status = "in_progress", action = "Resolve", label = "Resolution") {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { id: SR_ID, ...(notification ? { notification } : {}) } }), { status: 200 }),
    );
    render(<ServiceRequestActions id={SR_ID} status={status} version={3} />);
    fireEvent.click(screen.getByRole("button", { name: action }));
    await screen.findByLabelText(label);
    fireEvent.change(screen.getByLabelText(label), { target: { value: "Certificate issued today" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  }

  it("tells the officer the citizen was NOT notified when there is no phone or email on file", async () => {
    await resolveWith({ state: "no_contact", channel: null });
    expect(await screen.findByText(/citizen was not notified: there is no phone number or email on this request/i)).toBeInTheDocument();
    expect(screen.queryByText(/is being sent/i)).not.toBeInTheDocument();
  });

  it("tells the officer a notice is on its way, and by which channel", async () => {
    await resolveWith({ state: "queued", channel: "sms" });
    expect(await screen.findByText(/A notice is being sent to the citizen by SMS/)).toBeInTheDocument();
    expect(screen.queryByText(/was not notified/i)).not.toBeInTheDocument();
  });

  it("says a notice is on its way even if the channel is unknown", async () => {
    await resolveWith({ state: "queued", channel: null });
    expect(await screen.findByText(/A notice is being sent to the citizen; the result will show/)).toBeInTheDocument();
  });

  it("also reports it for a Close", async () => {
    await resolveWith({ state: "no_contact", channel: null }, "in_progress", "Close", "Closing remarks");
    expect(await screen.findByText(/citizen was not notified/i)).toBeInTheDocument();
  });

  it("says nothing about notification when the server reports none (a transition that notifies nobody)", async () => {
    await resolveWith(undefined);
    expect(screen.queryByText(/notified/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/is being sent/i)).not.toBeInTheDocument();
  });
});

// GAP-CRM-SERVICE-REQUESTS-DETAIL-05 — assign / reassign.
describe("ServiceRequestActions - assign officer (DETAIL-05)", () => {
  const USERS = [
    { id: "u-1", name: "Kavita Rao" },
    { id: "u-2", name: "Meera Nair" },
  ];

  /** Route the directory GET and the assign PATCH separately; return the spy. */
  function mockApi(assign: Response | (() => Response) = new Response(JSON.stringify({ data: { id: SR_ID } }), { status: 200 }), directory?: Response) {
    return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/v1/crm/directory/users")) {
        return directory ?? new Response(JSON.stringify({ data: USERS }), { status: 200 });
      }
      return typeof assign === "function" ? assign() : assign.clone();
    });
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("is not offered to a viewer who may not assign", () => {
    render(<ServiceRequestActions id={SR_ID} status="open" version={1} />);
    expect(screen.queryByRole("button", { name: /^(Re)?assign$/i })).not.toBeInTheDocument();
  });

  it("offers Assign when nobody owns the request, and Reassign when somebody does", () => {
    const { unmount } = render(<ServiceRequestActions id={SR_ID} status="open" version={1} canAssign />);
    expect(screen.getByRole("button", { name: "Assign" })).toBeInTheDocument();
    unmount();
    render(<ServiceRequestActions id={SR_ID} status="open" version={1} canAssign assignedTo="u-1" assignedToName="Kavita Rao" />);
    expect(screen.getByRole("button", { name: "Reassign" })).toBeInTheDocument();
  });

  it("is not offered once the request is closed or cancelled", () => {
    render(<ServiceRequestActions id={SR_ID} status="closed" version={1} canAssign />);
    expect(screen.queryByRole("button", { name: /assign/i })).not.toBeInTheDocument();
  });

  it("assigns the chosen officer with the version the page read, then refreshes", async () => {
    const spy = mockApi();
    render(<ServiceRequestActions id={SR_ID} status="open" version={4} canAssign />);
    fireEvent.click(screen.getByRole("button", { name: "Assign" }));
    const dialog = await screen.findByRole("dialog");
    // The directory is loaded and listed BY NAME.
    const select = (await within(dialog).findByLabelText("Officer")) as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(["Select an officer…", "Kavita Rao", "Meera Nair"]);
    // Nothing can be submitted until an officer is chosen.
    expect(within(dialog).getByRole("button", { name: "Assign" })).toBeDisabled();
    fireEvent.change(select, { target: { value: "u-2" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Assign" }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    const patch = spy.mock.calls.find(([u]) => String(u).endsWith("/assign"))!;
    expect(String(patch[0])).toBe(`/api/proxy/v1/crm/service-requests/${SR_ID}/assign`);
    expect((patch[1] as RequestInit).method).toBe("PATCH");
    expect(JSON.parse((patch[1] as RequestInit).body as string)).toEqual({ assignedTo: "u-2", version: 4 });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("on reassign names the current officer and does not offer them again", async () => {
    mockApi();
    render(<ServiceRequestActions id={SR_ID} status="open" version={1} canAssign assignedTo="u-1" assignedToName="Kavita Rao" />);
    fireEvent.click(screen.getByRole("button", { name: "Reassign" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Currently assigned to Kavita Rao/)).toBeInTheDocument();
    const select = (await within(dialog).findByLabelText("Officer")) as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).not.toContain("Kavita Rao");
    expect(Array.from(select.options).map((o) => o.textContent)).toContain("Meera Nair");
  });

  it("on a version conflict reloads the page and says someone else changed the request", async () => {
    mockApi(new Response(JSON.stringify({ code: "VERSION_CONFLICT" }), { status: 409 }));
    render(<ServiceRequestActions id={SR_ID} status="open" version={2} canAssign />);
    fireEvent.click(screen.getByRole("button", { name: "Assign" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(await within(dialog).findByLabelText("Officer"), { target: { value: "u-1" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Assign" }));
    expect(await within(dialog).findByText(/someone else changed this request/i)).toBeInTheDocument();
    expect(refreshMock).toHaveBeenCalled();
  });

  it("explains an officer the server rejects as not an active user", async () => {
    mockApi(new Response(JSON.stringify({ code: "INVALID_ASSIGNEE" }), { status: 422 }));
    render(<ServiceRequestActions id={SR_ID} status="open" version={2} canAssign />);
    fireEvent.click(screen.getByRole("button", { name: "Assign" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(await within(dialog).findByLabelText("Officer"), { target: { value: "u-1" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Assign" }));
    expect(await within(dialog).findByText(/not an active user of this office/i)).toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("shows a clerk-safe message, not the server text, for any other failure", async () => {
    mockApi(new Response(JSON.stringify({ message: "stack trace here" }), { status: 500 }));
    render(<ServiceRequestActions id={SR_ID} status="open" version={2} canAssign />);
    fireEvent.click(screen.getByRole("button", { name: "Assign" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(await within(dialog).findByLabelText("Officer"), { target: { value: "u-1" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Assign" }));
    expect(await within(dialog).findByText(/couldn't save/i)).toBeInTheDocument();
    expect(within(dialog).queryByText(/stack trace here/)).not.toBeInTheDocument();
  });

  it("says the officer list is unavailable (no empty picker) when the directory cannot be loaded", async () => {
    mockApi(undefined, new Response("{}", { status: 503 }));
    render(<ServiceRequestActions id={SR_ID} status="open" version={2} canAssign />);
    fireEvent.click(screen.getByRole("button", { name: "Assign" }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText(/officer list is unavailable right now/i)).toBeInTheDocument();
    expect(within(dialog).queryByLabelText("Officer")).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Assign" })).toBeDisabled();
  });
});
