import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { NominationActions } from "./NominationActions";

function renderActions(status: string) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <NominationActions id="nom-1" trainingId="training-1" status={status} />
    </NextIntlClientProvider>,
  );
}

describe("NominationActions — GAP-HR-TRAINING-NOMINATIONS-02", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    refreshMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("shows Approve and Reject for a 'nominated' row", () => {
    renderActions("nominated");
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reject" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Complete" })).not.toBeInTheDocument();
  });

  it("shows Complete for an 'approved' row", () => {
    renderActions("approved");
    expect(screen.getByRole("button", { name: "Complete" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
  });

  it("shows no action for a 'completed' or 'rejected' row", () => {
    renderActions("completed");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("Approve: fetches sessions for the row's trainingId, then posts the chosen sessionId", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (String(url).endsWith("/sessions")) {
        return Promise.resolve(new Response(JSON.stringify([
          { id: "session-1", title: "Batch A", sessionDate: "2026-11-05" },
        ]), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify({ id: "nom-1", status: "approved" }), { status: 200 }));
    });

    renderActions("nominated");
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));

    expect(fetchMock).toHaveBeenCalledWith("/api/proxy/v1/hrms/trainings/training-1/sessions");

    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(within(dialog).getByText(/Batch A/)).toBeInTheDocument());

    fireEvent.change(within(dialog).getByLabelText(/^session/i), { target: { value: "session-1" } });
    // Scoped to the dialog's own button -- the outer trigger button (also
    // named "Approve") lives outside it in the DOM.
    fireEvent.click(within(dialog).getByRole("button", { name: "Approve" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/proxy/v1/hrms/nominations/nom-1/approve",
        expect.objectContaining({ method: "POST", body: JSON.stringify({ sessionId: "session-1" }) }),
      ),
    );
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("Approve: shows a friendly message on a 409 MAKER_CHECKER response", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (String(url).endsWith("/sessions")) {
        return Promise.resolve(new Response(JSON.stringify([{ id: "session-1", title: "Batch A", sessionDate: "2026-11-05" }]), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify({ code: "MAKER_CHECKER", message: "nope" }), { status: 409 }));
    });

    renderActions("nominated");
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(await within(dialog).findByLabelText(/^session/i), { target: { value: "session-1" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Approve" }));

    await waitFor(() => expect(within(dialog).getByText(/different approver is required/i)).toBeInTheDocument());
  });

  it("Reject: posts to the reject endpoint with no body and refreshes on success", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "nom-1", status: "rejected" }), { status: 200 }));

    renderActions("nominated");
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/proxy/v1/hrms/nominations/nom-1/reject",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("Complete: posts completedDate/result/score and refreshes on success", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "nom-1", status: "completed" }), { status: 200 }));

    renderActions("approved");
    fireEvent.click(screen.getByRole("button", { name: "Complete" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Assessment score/i), { target: { value: "85" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/proxy/v1/hrms/nominations/nom-1/complete",
      expect.objectContaining({ method: "POST" }),
    ));
    const [, opts] = fetchMock.mock.calls.find(([u]) => String(u).endsWith("/complete"))!;
    const body = JSON.parse((opts as RequestInit).body as string);
    expect(body.result).toBe("pass");
    expect(body.score).toBe(85);
    expect(typeof body.completedDate).toBe("string");
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });
});
