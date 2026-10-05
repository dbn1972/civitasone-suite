import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { GrievanceActions } from "./GrievanceActions";

const GRIEVANCE_ID = "8cf7f7eb-1de6-4a31-b48c-1f598ecf33c0";

describe("GrievanceActions", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("renders a terminal message and no action buttons once DISPOSED", () => {
    render(<NextIntlClientProvider locale="en" messages={enMessages}><GrievanceActions id={GRIEVANCE_ID} status="DISPOSED" /></NextIntlClientProvider>);
    expect(screen.getByText(/disposed — no further action available/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  // Regression test for the CRITICAL bug: every grievance action called
  // fetch("/api/v1/crm/grievances/...") instead of the only working
  // client-mutation prefix, "/api/proxy/v1/crm/grievances/...". Before the
  // fix this assertion failed because the code requested the wrong (404)
  // path — the app has no Next.js route handler under /api/v1/*.
  it("forwards to the correct proxied endpoint and refreshes on success", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { id: GRIEVANCE_ID } }), { status: 200 }),
    );

    render(<NextIntlClientProvider locale="en" messages={enMessages}><GrievanceActions id={GRIEVANCE_ID} status="REGISTERED" /></NextIntlClientProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Forward" }));

    await waitFor(() => expect(screen.getByText("Forward this grievance?")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Department / Office"), { target: { value: "Water Board" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalled());

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(`/api/proxy/v1/crm/grievances/${GRIEVANCE_ID}/forward`);
    expect((init as RequestInit).method).toBe("PATCH");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ forwardedTo: "Water Board" });
  });

  it("resolves to the correct proxied endpoint with the resolution note", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { id: GRIEVANCE_ID } }), { status: 200 }),
    );

    render(<NextIntlClientProvider locale="en" messages={enMessages}><GrievanceActions id={GRIEVANCE_ID} status="ATTENDED" /></NextIntlClientProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Resolve" }));
    await waitFor(() => expect(screen.getByText("Resolve this grievance?")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Resolution"), { target: { value: "Pipe repaired" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    const [url] = fetchSpy.mock.calls[0];
    expect(url).toBe(`/api/proxy/v1/crm/grievances/${GRIEVANCE_ID}/resolve`);
  });

  // The appeal-reason field is meant to be captured (the fetch handler reads
  // `reason` off ConfirmDialog), but the ActionButton omitted `requireReason`,
  // so ConfirmDialog never rendered the textarea at all — appealReason could
  // never be sent. This proves the field now actually renders and is wired.
  it("captures and sends an appeal reason for First Appeal", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { id: GRIEVANCE_ID } }), { status: 200 }),
    );

    render(<NextIntlClientProvider locale="en" messages={enMessages}><GrievanceActions id={GRIEVANCE_ID} status="ATTENDED" /></NextIntlClientProvider>);
    fireEvent.click(screen.getByRole("button", { name: "First Appeal" }));
    await waitFor(() => expect(screen.getByText("File a first appeal?")).toBeInTheDocument());

    expect(screen.getByLabelText("Reason for appeal")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Reason for appeal"), { target: { value: "No response in 30 days" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(`/api/proxy/v1/crm/grievances/${GRIEVANCE_ID}/first-appeal`);
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ appealReason: "No response in 30 days" });
  });

  it("closes (danger action) to the correct proxied endpoint", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));

    render(<NextIntlClientProvider locale="en" messages={enMessages}><GrievanceActions id={GRIEVANCE_ID} status="ATTENDED" /></NextIntlClientProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.getByText("Close this grievance?")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    const [url] = fetchSpy.mock.calls[0];
    expect(url).toBe(`/api/proxy/v1/crm/grievances/${GRIEVANCE_ID}/close`);
  });

  // UX-016: this used to surface the backend's raw `message` field (or a
  // bare `HTTP ${status}` fallback) verbatim in the dialog. It must now show
  // only the catalogued, clerk-safe copy — never the raw server text.
  it("surfaces a clerk-safe error inside the dialog instead of the raw server text, and does not refresh", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ message: "Grievance already disposed" }), { status: 409 }),
    );

    render(<NextIntlClientProvider locale="en" messages={enMessages}><GrievanceActions id={GRIEVANCE_ID} status="ATTENDED" /></NextIntlClientProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.getByText("Close this grievance?")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    expect(await screen.findByText(/couldn't save/i)).toBeInTheDocument();
    expect(screen.queryByText("Grievance already disposed")).not.toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  // GAP-CRM-GRIEVANCES-DETAIL-01 — concurrency guard. The version rendered by
  // the page must travel on the PATCH as an If-Match header; before the fix no
  // version was ever sent, so two clerks silently overwrote each other.
  it("sends the grievance version as If-Match on a lifecycle action", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { id: GRIEVANCE_ID } }), { status: 200 }),
    );

    render(<NextIntlClientProvider locale="en" messages={enMessages}><GrievanceActions id={GRIEVANCE_ID} status="REGISTERED" version={7} /></NextIntlClientProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Forward" }));
    await waitFor(() => expect(screen.getByText("Forward this grievance?")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Department / Office"), { target: { value: "Water Board" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    const [, init] = fetchSpy.mock.calls[0];
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers["If-Match"]).toBe("7");
  });

  // A 412 (failed If-Match precondition) is a version conflict, not a generic
  // save error: it must show the dedicated "changed by someone else" copy AND
  // refresh the page to pull in the latest version. A business-rule 409 (tested
  // above) must still NOT refresh — the two are deliberately kept distinct.
  it("surfaces a conflict message and refreshes on a 412 version conflict", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ code: "VERSION_CONFLICT" }), { status: 412 }),
    );

    render(<NextIntlClientProvider locale="en" messages={enMessages}><GrievanceActions id={GRIEVANCE_ID} status="ATTENDED" version={3} /></NextIntlClientProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Resolve" }));
    await waitFor(() => expect(screen.getByText("Resolve this grievance?")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Resolution"), { target: { value: "Pipe repaired" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    expect(await screen.findByText(/changed by someone else/i)).toBeInTheDocument();
    expect(screen.queryByText(/couldn't save/i)).not.toBeInTheDocument();
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });
});
