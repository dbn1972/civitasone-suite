import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));

import { AddMemberForm } from "./AddMemberForm";

describe("GAP-PROJECTS-DETAIL-MEMBERS-01 AddMemberForm uuid guard", () => {
  beforeEach(() => {
    refreshMock.mockReset();
    vi.restoreAllMocks();
  });

  it("blocks a non-UUID user id without hitting the server", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<AddMemberForm projectId="p1" />);
    fireEvent.change(screen.getByLabelText("User ID (UUID)"), { target: { value: "not-a-uuid" } });
    fireEvent.click(screen.getByText("Add Member"));
    expect(await screen.findByText("Enter a valid User ID (UUID).")).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("POSTs a valid UUID", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "m1", status: "accepted" }), { status: 202 }),
    );
    render(<AddMemberForm projectId="p1" />);
    fireEvent.change(screen.getByLabelText("User ID (UUID)"), {
      target: { value: "11111111-1111-4111-8111-111111111111" },
    });
    fireEvent.click(screen.getByText("Add Member"));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    expect(fetchSpy.mock.calls[0]![0]).toBe("/api/proxy/v1/projects/p1/members");
  });
});
