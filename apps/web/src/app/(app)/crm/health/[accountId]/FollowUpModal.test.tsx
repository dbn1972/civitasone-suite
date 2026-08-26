import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
}));

import { FollowUpModal } from "./FollowUpModal";

const ACCOUNT_ID = "acct-0001";

describe("FollowUpModal", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    pushMock.mockReset();
  });

  // Regression test for the CRITICAL bug: the follow-up modal posted to
  // fetch("/api/v1/crm/service-requests") instead of the only working
  // client-mutation prefix "/api/proxy/v1/crm/service-requests" — creating a
  // follow-up from the Account Health screen 404'd every time.
  it("creates the follow-up service request against the correct proxied endpoint", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { id: "sr-followup-1" } }), { status: 201 }),
    );

    render(<FollowUpModal accountId={ACCOUNT_ID} />);
    fireEvent.click(screen.getByRole("button", { name: "Create Follow-up" }));

    fireEvent.change(screen.getByLabelText(/contact name/i), { target: { value: "Suresh Rao" } });
    fireEvent.change(screen.getByLabelText(/service type/i), { target: { value: "Renewal Support" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Service Request" }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/crm/service-requests/sr-followup-1"));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/proxy/v1/crm/service-requests");
    expect((init as RequestInit).method).toBe("POST");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.citizenName).toBe("Suresh Rao");
    expect(body.relatedAccountId).toBe(ACCOUNT_ID);
  });

  it("shows the server error inside the modal instead of navigating away", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ message: "subject is required" }), { status: 422 }),
    );

    render(<FollowUpModal accountId={ACCOUNT_ID} />);
    fireEvent.click(screen.getByRole("button", { name: "Create Follow-up" }));
    fireEvent.change(screen.getByLabelText(/contact name/i), { target: { value: "Suresh Rao" } });
    fireEvent.change(screen.getByLabelText(/service type/i), { target: { value: "Renewal Support" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Service Request" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("subject is required");
    expect(pushMock).not.toHaveBeenCalled();
  });
});
