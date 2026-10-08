import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));

import { AddMemberForm } from "./AddMemberForm";

const UUID = "11111111-1111-4111-8111-111111111111";

/** A fetch stub: directory search/resolve returns one person; the members
 *  POST returns 202. */
function stubFetch() {
  return vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/identity/users/directory")) {
      return Promise.resolve(
        new Response(JSON.stringify({ data: [{ id: UUID, displayName: "Asha Rao" }] }), { status: 200 }),
      );
    }
    return Promise.resolve(new Response(JSON.stringify({ id: "m1", status: "accepted" }), { status: 202 }));
  });
}

describe("GAP-PROJECTS-DETAIL-MEMBERS-01 AddMemberForm (searchable directory picker)", () => {
  beforeEach(() => {
    refreshMock.mockReset();
    vi.restoreAllMocks();
  });

  it("replaces the raw UUID box with a searchable person picker (no UUID input label)", () => {
    render(<AddMemberForm projectId="p1" />);
    // The old free-text "User ID (UUID)" field is gone...
    expect(screen.queryByLabelText("User ID (UUID)")).not.toBeInTheDocument();
    // ...replaced by a labelled combobox for searching people.
    expect(screen.getByRole("combobox", { name: /member/i })).toBeInTheDocument();
  });

  it("blocks submit until a person is selected, without hitting the members API", async () => {
    const fetchSpy = stubFetch();
    render(<AddMemberForm projectId="p1" />);
    fireEvent.click(screen.getByText("Add Member"));
    expect(await screen.findByText("Search for and select a person to add.")).toBeInTheDocument();
    // No POST to the members endpoint happened.
    expect(fetchSpy.mock.calls.some((c) => String(c[0]).includes("/projects/p1/members"))).toBe(false);
  });

  it("searches by name, selects a person, and POSTs that person's uuid", async () => {
    const fetchSpy = stubFetch();
    render(<AddMemberForm projectId="p1" />);

    const combo = screen.getByRole("combobox", { name: /member/i });
    fireEvent.focus(combo);
    fireEvent.change(combo, { target: { value: "Asha" } });

    // The directory match appears; select it.
    const option = await screen.findByText("Asha Rao");
    fireEvent.mouseDown(option);

    fireEvent.click(screen.getByText("Add Member"));

    await waitFor(() =>
      expect(fetchSpy.mock.calls.some((c) => String(c[0]) === "/api/proxy/v1/projects/p1/members")).toBe(true),
    );
    const postCall = fetchSpy.mock.calls.find((c) => String(c[0]) === "/api/proxy/v1/projects/p1/members")!;
    const body = JSON.parse((postCall[1] as RequestInit).body as string);
    expect(body.userId).toBe(UUID);
  });
});
