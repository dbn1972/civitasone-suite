import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { SeniorityListActions } from "./SeniorityListActions";

describe("SeniorityListActions", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("renders no action for a role outside the backend's HR_ROLES gate", () => {
    render(<SeniorityListActions canAdminister={false} />);
    expect(screen.queryByRole("button", { name: "Generate Seniority List" })).not.toBeInTheDocument();
  });

  it("renders the Generate action for an hr_admin/hr_officer/super_admin-gated caller", () => {
    render(<SeniorityListActions canAdminister={true} />);
    expect(screen.getByRole("button", { name: "Generate Seniority List" })).toBeInTheDocument();
    // Approve has nothing to act on until a list has been generated.
    expect(screen.queryByRole("button", { name: /Approve List/ })).not.toBeInTheDocument();
  });

  it("calls POST /v1/hrms/seniority/generate, shows the returned list id, and reveals Approve (happy path)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ id: "11111111-1111-1111-1111-111111111111", status: "accepted", correlationId: "c-1" }),
        { status: 202 },
      ),
    );

    render(<SeniorityListActions canAdminister={true} />);
    fireEvent.click(screen.getByRole("button", { name: "Generate Seniority List" }));

    await waitFor(() => expect(screen.getByText("Generate a new seniority list?")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));

    await waitFor(() => {
      expect(screen.getByText(/Seniority list generation queued/)).toBeInTheDocument();
    });
    expect(screen.getByText(/11111111-1111-1111-1111-111111111111/)).toBeInTheDocument();
    expect(refreshMock).toHaveBeenCalled();

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/proxy/v1/hrms/seniority/generate");
    expect(init.method).toBe("POST");

    // The approve action for the freshly generated list is now visible.
    expect(
      screen.getByRole("button", { name: "Approve List 11111111…" }),
    ).toBeInTheDocument();
  });

  it("surfaces a generate failure on the confirm dialog instead of swallowing it", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ code: "FORBIDDEN", message: "HR admin role required." }), { status: 403 }),
    );

    render(<SeniorityListActions canAdminister={true} />);
    fireEvent.click(screen.getByRole("button", { name: "Generate Seniority List" }));
    await waitFor(() => expect(screen.getByText("Generate a new seniority list?")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));

    await waitFor(() => {
      expect(screen.getByText(/HR admin role required\./)).toBeInTheDocument();
    });
    // Failure must stay visible in the dialog, not disappear silently, and
    // must not fabricate a success message or reveal the Approve action.
    expect(screen.queryByText(/Seniority list generation queued/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Approve List/ })).not.toBeInTheDocument();
  });

  it("calls POST /v1/hrms/seniority/:id/approve for the generated list (happy path)", async () => {
    const listId = "22222222-2222-2222-2222-222222222222";
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: listId, status: "accepted" }), { status: 202 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: listId, status: "accepted" }), { status: 202 }),
      );

    render(<SeniorityListActions canAdminister={true} />);
    fireEvent.click(screen.getByRole("button", { name: "Generate Seniority List" }));
    await waitFor(() => expect(screen.getByText("Generate a new seniority list?")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    await waitFor(() => expect(screen.getByText(new RegExp(listId))).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: `Approve List ${listId.slice(0, 8)}…` }));
    await waitFor(() => expect(screen.getByText("Approve this seniority list?")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));

    await waitFor(() => {
      expect(screen.getByText(`Seniority list ${listId} approved.`)).toBeInTheDocument();
    });

    const [url, init] = fetchSpy.mock.calls[1] as [string, RequestInit];
    expect(url).toBe(`/api/proxy/v1/hrms/seniority/${listId}/approve`);
    expect(init.method).toBe("POST");
    // The action is consumed once approved -- no dangling Approve button for
    // a list that no longer needs approving.
    expect(screen.queryByRole("button", { name: /Approve List/ })).not.toBeInTheDocument();
  });

  it("surfaces an approve failure on its confirm dialog instead of swallowing it", async () => {
    const listId = "33333333-3333-3333-3333-333333333333";
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: listId, status: "accepted" }), { status: 202 }))
      .mockResolvedValueOnce(new Response(null, { status: 500 }));

    render(<SeniorityListActions canAdminister={true} />);
    fireEvent.click(screen.getByRole("button", { name: "Generate Seniority List" }));
    await waitFor(() => expect(screen.getByText("Generate a new seniority list?")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    await waitFor(() => expect(screen.getByText(new RegExp(listId))).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: `Approve List ${listId.slice(0, 8)}…` }));
    await waitFor(() => expect(screen.getByText("Approve this seniority list?")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));

    await waitFor(() => {
      expect(screen.getByText(/API_ERROR: 500/)).toBeInTheDocument();
    });
    // The list is still pending approval -- the action must stay available,
    // not be silently consumed on a failed attempt.
    expect(
      screen.getByRole("button", { name: `Approve List ${listId.slice(0, 8)}…` }),
    ).toBeInTheDocument();
  });
});
