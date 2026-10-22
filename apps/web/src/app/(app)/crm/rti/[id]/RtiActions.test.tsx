import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider as __Intl } from "next-intl";
import __enMessages from "@/messages/en.json";
function render(ui: React.ReactElement) {
  return rtlRender(<__Intl locale="en" messages={__enMessages}>{ui}</__Intl>);
}
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { RtiActions } from "./RtiActions";

const RTI_ID = "9e10b6c1-2222-4444-8888-000000000001";

describe("RtiActions", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("renders a read-only disposal message with the disposal date once DISPOSED, with no action buttons", () => {
    render(<NextIntlClientProvider locale="en" messages={enMessages}><RtiActions id={RTI_ID} status="DISPOSED" canDecide disposedAt="2026-10-20T06:30:00.000Z" /></NextIntlClientProvider>);
    expect(screen.getByText(/disposed \(on /i)).toBeInTheDocument();
    expect(screen.getByText(/closed, read-only record/i)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  // GAP-CRM-RTI-DETAIL-01: FIRST_APPEAL used to dead-end at "no further action
  // available here". It now offers the appeal-chain actions.
  describe("appeal chain (GAP-CRM-RTI-DETAIL-01)", () => {
    function okFetch() {
      return vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ data: { id: RTI_ID } }), { status: 200 }),
      );
    }

    it("FIRST_APPEAL (undecided, admin): offers Record FAA decision + Record second appeal, not Dispose; shows the deadline", () => {
      render(<NextIntlClientProvider locale="en" messages={enMessages}><RtiActions id={RTI_ID} status="FIRST_APPEAL" canDecide firstAppealDueAt="2026-10-31T00:00:00.000Z" /></NextIntlClientProvider>);
      expect(screen.getByText(/First Appellate Authority/)).toBeInTheDocument();
      expect(screen.getByText(/First-appeal decision due/)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Record FAA decision" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Record second appeal" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Dispose" })).not.toBeInTheDocument();
    });

    it("FIRST_APPEAL for a non-admin CRM user: only Record second appeal; decision/disposal need an administrator", () => {
      render(<NextIntlClientProvider locale="en" messages={enMessages}><RtiActions id={RTI_ID} status="FIRST_APPEAL" /></NextIntlClientProvider>);
      expect(screen.getByRole("button", { name: "Record second appeal" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Record FAA decision" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Dispose" })).not.toBeInTheDocument();
      expect(screen.getByText(/needs a CRM administrator/)).toBeInTheDocument();
    });

    it("records the FAA decision with the chosen outcome and order text", async () => {
      const fetchSpy = okFetch();
      render(<NextIntlClientProvider locale="en" messages={enMessages}><RtiActions id={RTI_ID} status="FIRST_APPEAL" canDecide /></NextIntlClientProvider>);
      fireEvent.click(screen.getByRole("button", { name: "Record FAA decision" }));
      await waitFor(() => expect(screen.getByText("Record the First Appellate Authority's decision?")).toBeInTheDocument());
      fireEvent.change(screen.getByLabelText("Outcome"), { target: { value: "partly_allowed" } });
      fireEvent.change(screen.getByLabelText("Text of the appellate order"), {
        target: { value: "Appeal partly allowed; furnish items 1 and 3 within 15 days." },
      });
      fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

      await waitFor(() => expect(refreshMock).toHaveBeenCalled());
      const [url, init] = fetchSpy.mock.calls[0];
      expect(url).toBe(`/api/proxy/v1/crm/rti/${RTI_ID}/first-appeal/decide`);
      expect((init as RequestInit).method).toBe("PATCH");
      expect(JSON.parse((init as RequestInit).body as string)).toEqual({
        outcome: "partly_allowed",
        orderText: "Appeal partly allowed; furnish items 1 and 3 within 15 days.",
      });
    });

    it("decided FIRST_APPEAL (admin): no second decision; offers Record second appeal + Dispose", () => {
      render(<NextIntlClientProvider locale="en" messages={enMessages}><RtiActions id={RTI_ID} status="FIRST_APPEAL" canDecide firstAppealDecidedAt="2026-10-15T05:00:00.000Z" /></NextIntlClientProvider>);
      expect(screen.getByText(/order was recorded on/)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Record FAA decision" })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Record second appeal" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Dispose" })).toBeInTheDocument();
    });

    it("records a second appeal with the Commission reference", async () => {
      const fetchSpy = okFetch();
      render(<NextIntlClientProvider locale="en" messages={enMessages}><RtiActions id={RTI_ID} status="FIRST_APPEAL" /></NextIntlClientProvider>);
      fireEvent.click(screen.getByRole("button", { name: "Record second appeal" }));
      await waitFor(() => expect(screen.getByText(/Record a second appeal to the Information Commission/)).toBeInTheDocument());
      fireEvent.change(screen.getByLabelText("Commission reference"), { target: { value: "SIC/2026/0457" } });
      fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

      await waitFor(() => expect(refreshMock).toHaveBeenCalled());
      const [url, init] = fetchSpy.mock.calls[0];
      expect(url).toBe(`/api/proxy/v1/crm/rti/${RTI_ID}/second-appeal`);
      expect(JSON.parse((init as RequestInit).body as string)).toEqual({ reference: "SIC/2026/0457" });
    });

    it("SECOND_APPEAL (admin): disposes with a reason", async () => {
      const fetchSpy = okFetch();
      render(<NextIntlClientProvider locale="en" messages={enMessages}><RtiActions id={RTI_ID} status="SECOND_APPEAL" canDecide /></NextIntlClientProvider>);
      expect(screen.getByText(/Information Commission/)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Record second appeal" })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Dispose" }));
      await waitFor(() => expect(screen.getByText("Dispose of this RTI request?")).toBeInTheDocument());
      fireEvent.change(screen.getByLabelText("Reason for disposal"), {
        target: { value: "Commission decided the appeal; information furnished." },
      });
      fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

      await waitFor(() => expect(refreshMock).toHaveBeenCalled());
      const [url, init] = fetchSpy.mock.calls[0];
      expect(url).toBe(`/api/proxy/v1/crm/rti/${RTI_ID}/dispose`);
      expect(JSON.parse((init as RequestInit).body as string)).toEqual({
        reason: "Commission decided the appeal; information furnished.",
      });
    });

    it("SECOND_APPEAL for a non-admin: read-only guidance, no buttons", () => {
      render(<NextIntlClientProvider locale="en" messages={enMessages}><RtiActions id={RTI_ID} status="SECOND_APPEAL" /></NextIntlClientProvider>);
      expect(screen.getByText(/Information Commission/)).toBeInTheDocument();
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    });
  });

  // GAP-CRM-RTI-DETAIL-02: a user without a CRM write role sees no action
  // buttons at all (the server would 403 them regardless).
  it("hides all action buttons when the user cannot act (no CRM role)", () => {
    render(<NextIntlClientProvider locale="en" messages={enMessages}><RtiActions id={RTI_ID} status="RECEIVED" canAct={false} /></NextIntlClientProvider>);
    expect(screen.getByText(/do not have permission/i)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows Forward and Respond while RECEIVED, but not First Appeal", () => {
    render(<NextIntlClientProvider locale="en" messages={enMessages}><RtiActions id={RTI_ID} status="RECEIVED" /></NextIntlClientProvider>);
    expect(screen.getByRole("button", { name: "Forward" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Respond" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "First Appeal" })).not.toBeInTheDocument();
  });

  it("shows only First Appeal once RESPONDED", () => {
    render(<NextIntlClientProvider locale="en" messages={enMessages}><RtiActions id={RTI_ID} status="RESPONDED" /></NextIntlClientProvider>);
    expect(screen.getByRole("button", { name: "First Appeal" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Forward" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Respond" })).not.toBeInTheDocument();
  });

  it("forwards to another department via the proxied endpoint", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { id: RTI_ID } }), { status: 200 }),
    );

    render(<NextIntlClientProvider locale="en" messages={enMessages}><RtiActions id={RTI_ID} status="RECEIVED" /></NextIntlClientProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Forward" }));
    await waitFor(() => expect(screen.getByText("Forward this RTI request?")).toBeInTheDocument());
    // GAP-CRM-RTI-DETAIL-04: the target is chosen from the shared authority list.
    fireEvent.change(screen.getByLabelText("Public authority to transfer to"), {
      target: { value: "Department of Revenue" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(`/api/proxy/v1/crm/rti/${RTI_ID}/forward`);
    expect((init as RequestInit).method).toBe("PATCH");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ departmentRef: "Department of Revenue" });
  });

  // GAP-CRM-RTI-DETAIL-04: forwarding without selecting an authority is blocked.
  it("blocks Forward until a public authority is selected", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<RtiActions id={RTI_ID} status="RECEIVED" />);
    fireEvent.click(screen.getByRole("button", { name: "Forward" }));
    await waitFor(() => expect(screen.getByText("Forward this RTI request?")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(await screen.findByText(/Select the public authority/i)).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  // GAP-CRM-RTI-DETAIL-04: a warning appears when the s.6(3) 5-day transfer
  // window has already passed.
  it("warns when the s.6(3) transfer window has passed", async () => {
    const longAgo = new Date(Date.now() - 20 * 86_400_000).toISOString();
    render(<RtiActions id={RTI_ID} status="RECEIVED" receivedAt={longAgo} />);
    fireEvent.click(screen.getByRole("button", { name: "Forward" }));
    await waitFor(() => expect(screen.getByText("Forward this RTI request?")).toBeInTheDocument());
    expect(screen.getByText(/s\.6\(3\) requires a transfer within 5 days/i)).toBeInTheDocument();
  });

  it("records a response within the statutory deadline via the proxied endpoint", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { id: RTI_ID } }), { status: 200 }),
    );

    render(<NextIntlClientProvider locale="en" messages={enMessages}><RtiActions id={RTI_ID} status="TRANSFERRED" /></NextIntlClientProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Respond" }));
    await waitFor(() => expect(screen.getByText("Record the response to this RTI request?")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Response to applicant"), { target: { value: "Information enclosed as annexure A to this reply." } });
    // GAP-CRM-RTI-DETAIL-02: step 1 only moves to the read-back; nothing is sent yet.
    fireEvent.click(screen.getByRole("button", { name: "Review response" }));
    expect(await screen.findByText("Check the response before sending")).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Send response" }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(`/api/proxy/v1/crm/rti/${RTI_ID}/respond`);
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      responseText: "Information enclosed as annexure A to this reply.",
    });
  });

  // GAP-CRM-RTI-DETAIL-02: the response is a statutory record — a too-short
  // reply (under 20 chars) must be rejected client-side (the old default
  // minReasonLength of 1 accepted a single character).
  it("rejects a too-short response (statutory record requires substantive text)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { id: RTI_ID } }), { status: 200 }),
    );

    render(<NextIntlClientProvider locale="en" messages={enMessages}><RtiActions id={RTI_ID} status="RECEIVED" /></NextIntlClientProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Respond" }));
    await waitFor(() => expect(screen.getByText("Record the response to this RTI request?")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Response to applicant"), { target: { value: "see attached" } });
    // Under 20 characters: the hint says so and the Review step is not reachable.
    expect(screen.getByText(/12 of 10000 characters \(at least 20 required\)/)).toBeInTheDocument();
    const review = screen.getByRole("button", { name: "Review response" });
    expect(review).toBeDisabled();
    fireEvent.click(review);

    // Neither the read-back nor a request appears; no refresh.
    await waitFor(() => {});
    expect(screen.queryByText("Check the response before sending")).not.toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  // GAP-CRM-RTI-DETAIL-02: the exact text is read back in a separate step, and
  // "Back to edit" returns to the draft intact (nothing sent).
  it("reads the response back before sending and lets the clerk go back to edit", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { id: RTI_ID } }), { status: 200 }),
    );
    const draft = "Information is enclosed as annexure A.\nThe fee has been refunded.";
    render(<NextIntlClientProvider locale="en" messages={enMessages}><RtiActions id={RTI_ID} status="RECEIVED" /></NextIntlClientProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Respond" }));
    fireEvent.change(await screen.findByLabelText("Response to applicant"), { target: { value: `  ${draft}  ` } });
    fireEvent.click(screen.getByRole("button", { name: "Review response" }));

    // The read-back shows the exact (trimmed) text that will be recorded.
    const readBack = await screen.findByLabelText("Response text to be sent");
    expect(readBack).toHaveTextContent("Information is enclosed as annexure A.");
    expect(readBack).toHaveTextContent("The fee has been refunded.");
    expect(readBack.textContent).toBe(draft);

    // Back to edit: the draft is still in the textarea and nothing was sent.
    fireEvent.click(screen.getByRole("button", { name: "Back to edit" }));
    expect(await screen.findByLabelText("Response to applicant")).toHaveValue(`  ${draft}  `);
    expect(fetchSpy).not.toHaveBeenCalled();

    // Review again and send: the trimmed text is what goes over the wire.
    fireEvent.click(screen.getByRole("button", { name: "Review response" }));
    fireEvent.click(await screen.findByRole("button", { name: "Send response" }));
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toEqual({ responseText: draft });
  });

  it("keeps the read-back open with a clerk-safe error when sending the response fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ message: "RTI request already disposed" }), { status: 409 }),
    );
    render(<NextIntlClientProvider locale="en" messages={enMessages}><RtiActions id={RTI_ID} status="RECEIVED" /></NextIntlClientProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Respond" }));
    fireEvent.change(await screen.findByLabelText("Response to applicant"), { target: { value: "Information is enclosed as annexure A." } });
    fireEvent.click(screen.getByRole("button", { name: "Review response" }));
    fireEvent.click(await screen.findByRole("button", { name: "Send response" }));
    expect(await screen.findByText(/couldn't save/i)).toBeInTheDocument();
    expect(screen.queryByText("RTI request already disposed")).not.toBeInTheDocument();
    expect(screen.getByText("Check the response before sending")).toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  // GAP-CRM-RTI-NEW-04 / DETAIL-04: an "Other" authority is folded to the canonical
  // casing of a listed one, exactly like the New RTI form.
  it("folds an 'Other' authority typed in different casing to the listed authority", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { id: RTI_ID } }), { status: 200 }),
    );
    render(<NextIntlClientProvider locale="en" messages={enMessages}><RtiActions id={RTI_ID} status="RECEIVED" /></NextIntlClientProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Forward" }));
    await waitFor(() => expect(screen.getByText("Forward this RTI request?")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Public authority to transfer to"), { target: { value: "__other__" } });
    fireEvent.change(screen.getByLabelText("Other authority name"), { target: { value: "  ministry   of finance " } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string)).toEqual({ departmentRef: "Ministry of Finance" });
  });

  it("raises a first appeal via the proxied endpoint", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { id: RTI_ID } }), { status: 200 }),
    );

    render(<NextIntlClientProvider locale="en" messages={enMessages}><RtiActions id={RTI_ID} status="RESPONDED" /></NextIntlClientProvider>);
    fireEvent.click(screen.getByRole("button", { name: "First Appeal" }));
    await waitFor(() => expect(screen.getByText("Raise a first appeal?")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    const [url] = fetchSpy.mock.calls[0];
    expect(url).toBe(`/api/proxy/v1/crm/rti/${RTI_ID}/first-appeal`);
  });

  // UX-016: `patch` used to echo the backend's raw `message` field (or a
  // bare `HTTP ${status}` fallback) verbatim. It must now show only the
  // catalogued, clerk-safe copy — never the raw server text — and must not
  // refresh on failure.
  it("surfaces a clerk-safe error inside the dialog instead of the raw server text, and does not refresh", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ message: "RTI request already disposed" }), { status: 409 }),
    );

    render(<NextIntlClientProvider locale="en" messages={enMessages}><RtiActions id={RTI_ID} status="RECEIVED" /></NextIntlClientProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Forward" }));
    await waitFor(() => expect(screen.getByText("Forward this RTI request?")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Public authority to transfer to"), {
      target: { value: "Department of Revenue" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    expect(await screen.findByText(/couldn't save/i)).toBeInTheDocument();
    expect(screen.queryByText("RTI request already disposed")).not.toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
