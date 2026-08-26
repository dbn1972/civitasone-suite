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
});
