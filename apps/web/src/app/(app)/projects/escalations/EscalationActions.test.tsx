import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { EscalationActions } from "./EscalationActions";

function renderActions(status: string, extra: Record<string, string> = {}) {
  render(
    <EscalationActions
      projectId="p-1"
      escalationId="ESC-001"
      status={status}
      severity={extra.severity}
      issue={extra.issue}
    />,
  );
}

describe("EscalationActions (GAP-PROJECTS-ESCALATIONS-02)", () => {
  beforeEach(() => {
    refresh.mockReset();
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => vi.unstubAllGlobals());

  it("renders nothing on a cleared escalation", () => {
    const { container } = render(<EscalationActions projectId="p-1" escalationId="ESC-001" status="cleared" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("acknowledge POSTs to the acknowledge route with the projection snapshot and refreshes", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });
    renderActions("open", { severity: "blocked", issue: "Critical blocker" });
    fireEvent.click(screen.getByRole("button", { name: /Acknowledge/i }));
    const confirmBtn = screen.getAllByRole("button", { name: /Acknowledge/i }).pop()!;
    expect(confirmBtn).not.toBeDisabled(); // acknowledge needs no reason
    fireEvent.click(confirmBtn);

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/proxy/v1/projects/p-1/escalation/acknowledge");
    expect((init as RequestInit).method).toBe("POST");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.severity).toBe("blocked");
    expect(body.issue).toBe("Critical blocker");
    await waitFor(() => expect(screen.getByText(/acknowledged/i)).toBeInTheDocument());
    expect(refresh).toHaveBeenCalled();
  });

  it("clear keeps Confirm disabled until a resolution note is given, then POSTs reason", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });
    renderActions("acknowledged");
    fireEvent.click(screen.getByRole("button", { name: /Clear/i }));
    const confirmBtn = screen.getAllByRole("button", { name: /Clear/i }).pop()!;
    expect(confirmBtn).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Resolution note/i), { target: { value: "Resolved on site" } });
    expect(confirmBtn).not.toBeDisabled();
    fireEvent.click(confirmBtn);

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/proxy/v1/projects/p-1/escalation/clear");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.reason).toBe("Resolved on site");
    await waitFor(() => expect(screen.getByText(/cleared/i)).toBeInTheDocument());
    expect(refresh).toHaveBeenCalled();
  });

  it("reassign keeps Confirm disabled until a new owner is given, then POSTs escalatedTo", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });
    renderActions("acknowledged");
    fireEvent.click(screen.getByRole("button", { name: /Reassign/i }));
    const confirmBtn = screen.getAllByRole("button", { name: /Reassign/i }).pop()!;
    expect(confirmBtn).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Reassign to/i), { target: { value: "Chief Engineer" } });
    expect(confirmBtn).not.toBeDisabled();
    fireEvent.click(confirmBtn);

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/proxy/v1/projects/p-1/escalation/reassign");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.escalatedTo).toBe("Chief Engineer");
    await waitFor(() => expect(screen.getByText(/reassigned/i)).toBeInTheDocument());
    expect(refresh).toHaveBeenCalled();
  });
});
