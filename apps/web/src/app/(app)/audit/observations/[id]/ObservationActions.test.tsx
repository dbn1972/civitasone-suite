import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { ObservationActions } from "./ObservationActions";

const OBS_ID = "3d5f9c1a-0000-4444-8888-000000000001";

describe("ObservationActions", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("records a reply against the correct proxied endpoint and refreshes on success", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));

    render(<ObservationActions obsId={OBS_ID} department="Finance Wing" canReply canRefer />);
    fireEvent.click(screen.getByRole("button", { name: "Record Reply" }));
    fireEvent.change(screen.getByLabelText("Compliance reply"), { target: { value: "Vouchers now attached." } });
    fireEvent.click(screen.getByRole("button", { name: "Record reply" }));

    await waitFor(() => expect(screen.getByText("Record auditee reply?")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/Reason \/ ATN reference/), { target: { value: "ATN-441" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm & record" }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    const [url] = fetchSpy.mock.calls[0];
    expect(url).toBe(`/api/proxy/v1/audit/observations/${OBS_ID}/reply`);
  });

  // GAP-AUDIT-OBSERVATIONS-DETAIL-02: a role with no permission sees no action buttons.
  it("renders no action buttons when the role may neither reply nor refer", () => {
    render(<ObservationActions obsId={OBS_ID} department="Finance Wing" canReply={false} canRefer={false} />);
    expect(screen.queryByRole("button", { name: "Record Reply" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Refer" })).not.toBeInTheDocument();
  });

  // UX-016: this used to build the error from `Action failed (${status}).
  // ${rawResponseText}` verbatim. It must now show only the catalogued,
  // clerk-safe copy — never the raw server text.
  it("shows a clerk-safe error, not the raw server text, when the confirmed action fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("workflow_service: observation already closed", { status: 409 }),
    );

    render(<ObservationActions obsId={OBS_ID} department="Finance Wing" canReply canRefer />);
    fireEvent.click(screen.getByRole("button", { name: "Record Reply" }));
    fireEvent.change(screen.getByLabelText("Compliance reply"), { target: { value: "Vouchers now attached." } });
    fireEvent.click(screen.getByRole("button", { name: "Record reply" }));
    await waitFor(() => expect(screen.getByText("Record auditee reply?")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/Reason \/ ATN reference/), { target: { value: "ATN-441" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm & record" }));

    expect(await screen.findByText(/This observation action was changed by someone else\. Refresh to see the latest version, then try again\./)).toBeInTheDocument();
    expect(screen.queryByText(/observation already closed/)).not.toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  // GAP-AUDIT-OBSERVATIONS-DETAIL-05: a reviewer accepts the auditee reply via
  // the existing review endpoint with decision=accepted and the required
  // reason carried as remarks.
  it("accepts the auditee reply against the review endpoint with decision+remarks", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 202 }));

    render(<ObservationActions obsId={OBS_ID} department="Finance Wing" status="replied" canReview />);
    fireEvent.click(screen.getByRole("button", { name: "Accept reply" }));

    await waitFor(() => expect(screen.getByText("Accept auditee reply?")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/Reason \/ order reference/), { target: { value: "Order-99" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm & accept" }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/proxy/v1/audit/observations/${OBS_ID}/review`);
    const body = JSON.parse(init.body as string);
    expect(body.decision).toBe("accepted");
    expect(body.remarks).toBe("Order-99");
  });

  it("rejects the auditee reply with decision=rejected", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 202 }));

    render(<ObservationActions obsId={OBS_ID} department="Finance Wing" status="replied" canReview />);
    fireEvent.click(screen.getByRole("button", { name: "Reject reply" }));

    await waitFor(() => expect(screen.getByText("Reject auditee reply?")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/Reason for rejection/), { target: { value: "Insufficient evidence" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm & reject" }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/proxy/v1/audit/observations/${OBS_ID}/review`);
    const body = JSON.parse(init.body as string);
    expect(body.decision).toBe("rejected");
  });

  // Review controls are only meaningful once the auditee has replied, and only
  // for the review authority; the server re-enforces both.
  it("hides Accept/Reject when the observation is not in 'replied' status", () => {
    render(<ObservationActions obsId={OBS_ID} department="Finance Wing" status="open" canReview />);
    expect(screen.queryByRole("button", { name: "Accept reply" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reject reply" })).not.toBeInTheDocument();
  });

  it("hides Accept/Reject when the role is not a reviewer", () => {
    render(<ObservationActions obsId={OBS_ID} department="Finance Wing" status="replied" canReview={false} />);
    expect(screen.queryByRole("button", { name: "Accept reply" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reject reply" })).not.toBeInTheDocument();
  });
});
