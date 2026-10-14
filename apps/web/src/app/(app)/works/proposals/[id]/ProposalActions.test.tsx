import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { ToastProvider } from "@/app/_components/ds/Toast";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { ProposalActions } from "./ProposalActions";

const ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

function renderWithToast(ui: ReactElement) {
  return render(<ToastProvider>{ui}</ToastProvider>);
}

describe("ProposalActions", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("does NOT fire the DAO-finalize until the officer confirms (L4)", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ status: "accepted" }), { status: 202 }));

    renderWithToast(<ProposalActions id={ID} status="submitted" roles={["works_admin"]} />);

    fireEvent.click(screen.getByRole("button", { name: "DAO Finalize" }));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(screen.getByText("Finalize for DAO Approval")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Finalize" }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    expect(fetchSpy.mock.calls[0][0]).toBe(`/api/proxy/v1/works/proposals/${ID}/dao-finalize`);
  });

  it("reports the DAO-finalize as SUBMITTED (async 202), not as already finalized (L3: 202 != done)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "accepted" }), { status: 202 }),
    );

    renderWithToast(<ProposalActions id={ID} status="submitted" roles={["works_admin"]} />);
    fireEvent.click(screen.getByRole("button", { name: "DAO Finalize" }));
    fireEvent.click(screen.getByRole("button", { name: "Finalize" }));

    await waitFor(() =>
      expect(
        screen.getByText("Proposal submitted for DAO finalization. It will show as finalized once processed."),
      ).toBeInTheDocument(),
    );
  });

  it("renders nothing for a user without a proposal write role", () => {
    const { container } = render(
      <ToastProvider>
        <ProposalActions id={ID} status="submitted" roles={["viewer"]} />
      </ToastProvider>,
    );
    expect(container).not.toHaveTextContent("DAO Finalize");
  });

  // UX-016: this dialog used to fall back to
  // `await res.text().catch(() => "Request failed")` verbatim on failure —
  // the same class of raw-text leak useFormError closes fleet-wide (UX-003).
  it("shows a clerk-safe message, never the raw server text, when DAO-finalize fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Request failed", { status: 500 }),
    );

    renderWithToast(<ProposalActions id={ID} status="submitted" roles={["works_admin"]} />);
    fireEvent.click(screen.getByRole("button", { name: "DAO Finalize" }));
    fireEvent.click(screen.getByRole("button", { name: "Finalize" }));

    await waitFor(() => expect(screen.getByText(/couldn't save/i)).toBeInTheDocument());
    expect(screen.queryByText(/^Request failed$/)).not.toBeInTheDocument();
  });

  it("GAP-WORKS-PROPOSALS-DETAIL-09: follows the queued finalize until the proposal really is dao_finalized, then refreshes the page", async () => {
    let polls = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      if ((init as RequestInit | undefined)?.method === "POST") return new Response(JSON.stringify({ status: "accepted" }), { status: 202 });
      polls += 1;
      return new Response(JSON.stringify({ data: { status: polls >= 2 ? "dao_finalized" : "submitted" } }), { status: 200 });
    });
    renderWithToast(<ProposalActions id={ID} status="submitted" roles={["works_admin"]} />);
    fireEvent.click(screen.getByRole("button", { name: "DAO Finalize" }));
    fireEvent.click(screen.getByRole("button", { name: "Finalize" }));
    // while the consumer has not applied it, the notice says it is still being applied and the button is locked
    await waitFor(() => expect(document.querySelector('[data-accepted-phase="pending"]')).not.toBeNull());
    expect(screen.getByRole("button", { name: "DAO Finalize" })).toBeDisabled();
    await waitFor(() => expect(document.querySelector('[data-accepted-phase="confirmed"]')).not.toBeNull(), { timeout: 5000 });
    expect(refreshMock).toHaveBeenCalled();
  });
});
