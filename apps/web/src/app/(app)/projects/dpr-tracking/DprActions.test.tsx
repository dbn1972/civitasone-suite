import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { DprActions } from "./DprActions";

function renderActions(status: string) {
  render(<DprActions projectId="p-1" dprId="dpr-1" dprNo="DPR-001" status={status} />);
}

describe("DprActions (GAP-PROJECTS-DPR-TRACKING-01)", () => {
  beforeEach(() => {
    refresh.mockReset();
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => vi.unstubAllGlobals());

  it("offers only 'Start review' on a submitted DPR", () => {
    renderActions("submitted");
    expect(screen.getByRole("button", { name: /Start review/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Approve/i })).not.toBeInTheDocument();
  });

  it("renders nothing on a terminal status", () => {
    const { container } = render(<DprActions projectId="p-1" dprId="dpr-1" dprNo="DPR-001" status="approved" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("return-for-revision keeps Confirm disabled until a reason is given, then PATCHes action+reason and refreshes", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });
    renderActions("under_review");
    fireEvent.click(screen.getByRole("button", { name: /Return for revision/i }));

    // The confirm button in the dialog shares the "Return for revision" name.
    const confirmBtn = screen.getAllByRole("button", { name: /Return for revision/i }).pop()!;
    expect(confirmBtn).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/Revision instruction/i), { target: { value: "Revise the cost estimate" } });
    expect(confirmBtn).not.toBeDisabled();
    fireEvent.click(confirmBtn);

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/proxy/v1/projects/p-1/dpr/dpr-1/transition");
    expect((init as RequestInit).method).toBe("PATCH");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({ action: "return", reason: "Revise the cost estimate" });

    await waitFor(() => expect(screen.getByText(/returned for revision/i)).toBeInTheDocument());
    expect(refresh).toHaveBeenCalled();
  });

  it("approve sends action=approve (reason optional) and shows success", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });
    renderActions("under_review");
    fireEvent.click(screen.getByRole("button", { name: /Approve/i }));
    const confirmBtn = screen.getAllByRole("button", { name: /Approve/i }).pop()!;
    // Approve does not require a reason → Confirm enabled immediately.
    expect(confirmBtn).not.toBeDisabled();
    fireEvent.click(confirmBtn);

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/proxy/v1/projects/p-1/dpr/dpr-1/transition");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.action).toBe("approve");
    await waitFor(() => expect(screen.getByText(/DPR DPR-001 approved/i)).toBeInTheDocument());
    expect(refresh).toHaveBeenCalled();
  });
});
