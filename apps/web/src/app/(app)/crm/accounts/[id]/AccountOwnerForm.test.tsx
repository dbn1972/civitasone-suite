import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@/test-utils/intl-render";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock, push: vi.fn() }) }));

const browserFetchMock = vi.fn();
vi.mock("@/lib/api/browserClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/browserClient")>("@/lib/api/browserClient");
  return { ...actual, browserFetch: (...args: unknown[]) => browserFetchMock(...args) };
});

// F5-01: resolve the current + searchable owners via the agent directory.
vi.mock("@/lib/crm/assignment", () => ({
  getAgents: vi.fn(async () => ({
    data: [
      { agentId: "agent-1", name: "Asha Rao", activeLeads: 0, maxLeads: 10, available: true, onLeave: false },
      { agentId: "agent-2", name: "Vikram Singh", activeLeads: 0, maxLeads: 10, available: true, onLeave: false },
    ],
    source: "api",
  })),
}));

import { AccountOwnerForm } from "./AccountOwnerForm";

function makeRes(ok: boolean, status: number, body: unknown): Response {
  return { ok, status, json: async () => body, clone: () => makeRes(ok, status, body) } as unknown as Response;
}

describe("AccountOwnerForm (F5-01)", () => {
  beforeEach(() => {
    refreshMock.mockReset();
    browserFetchMock.mockReset();
  });

  it("disables the save button until the owner actually changes", () => {
    render(<AccountOwnerForm accountId="acc-1" currentOwnerId="agent-1" currentOwnerName="Asha Rao" />);
    expect(screen.getByRole("button", { name: "Change owner" })).toBeDisabled();
  });

  it("never shows a raw UUID when the owner name is unresolved: shows 'Unknown user'", () => {
    const uuid = "7f0c2d1e-5b8a-4c3d-9e6f-1a2b3c4d5e6f";
    const { container } = render(<AccountOwnerForm accountId="acc-1" currentOwnerId={uuid} currentOwnerName={null} />);
    expect(container.innerHTML).not.toContain(uuid);
    expect(screen.queryByDisplayValue(uuid)).toBeNull();
    expect(screen.getByDisplayValue("Unknown user")).toBeInTheDocument();
  });

  it("PATCHes the new owner to /v1/crm/accounts/:id and confirms the async apply", async () => {
    browserFetchMock.mockResolvedValue(makeRes(true, 202, {}));
    render(<AccountOwnerForm accountId="acc-1" currentOwnerId={null} currentOwnerName={null} />);

    // Pick an owner by name through the EntityPicker search box.
    const input = screen.getByLabelText("Account owner");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "Vikram" } });
    const option = await screen.findByText("Vikram Singh");
    // EntityPicker commits selection on mousedown (before blur closes the list).
    fireEvent.mouseDown(option);

    const save = await screen.findByRole("button", { name: "Change owner" });
    await waitFor(() => expect(save).not.toBeDisabled());
    fireEvent.click(save);

    await waitFor(() => expect(browserFetchMock).toHaveBeenCalled());
    const patch = browserFetchMock.mock.calls.find((c) => c[0] === "v1/crm/accounts/acc-1");
    expect(patch).toBeDefined();
    expect((patch![1] as { method: string }).method).toBe("PATCH");
    const body = JSON.parse((patch![1] as { body: string }).body) as { ownerId: string };
    expect(body.ownerId).toBe("agent-2");
    expect(await screen.findByText(/takes effect shortly/i)).toBeInTheDocument();
  });
});
