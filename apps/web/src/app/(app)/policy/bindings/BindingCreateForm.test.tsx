import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { BindingCreateForm } from "./BindingCreateForm";

const SELF = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const ROLE = "33333333-3333-4333-8333-333333333333";

function mockApi() {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/identity/users")) {
      return { ok: true, status: 200, json: async () => ({ data: [
        { id: SELF, name: "Me Myself" },
        { id: OTHER, name: "Other Person" },
      ] }) } as unknown as Response;
    }
    if (url.includes("/policy/roles")) {
      return { ok: true, status: 200, json: async () => ({ data: [{ id: ROLE, name: "finance_clerk" }] }) } as unknown as Response;
    }
    // the create POST
    return { ok: true, status: 202, json: async () => ({ id: "new-binding" }), text: async () => "{}", headers: new Headers() } as unknown as Response;
  });
}

afterEach(() => vi.restoreAllMocks());

async function pick(label: string, type: string, optionText: string) {
  const input = screen.getByLabelText(label);
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: type } });
  const option = await screen.findByText(optionText);
  fireEvent.mouseDown(option);
}

describe("BindingCreateForm", () => {
  it("GAP-POLICY-BINDINGS-01: refuses to grant a role to one's own account", async () => {
    mockApi();
    render(<BindingCreateForm currentUserId={SELF} />);
    await pick("User", "Me", "Me Myself");
    await waitFor(() => expect(screen.getByText(/cannot bind a role to your own account/i)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Create binding" })).toBeDisabled();
  });

  it("GAP-POLICY-BINDINGS-01: picking another user + role opens a confirm dialog requiring a reason (no POST yet)", async () => {
    const spy = mockApi();
    render(<BindingCreateForm currentUserId={SELF} />);
    await pick("User", "Other", "Other Person");
    await pick("Role", "finance", "finance_clerk");
    fireEvent.click(screen.getByRole("button", { name: "Create binding" }));
    // confirm dialog shows; no create POST yet
    await screen.findByText("Grant role binding?");
    const createPosts = spy.mock.calls.filter((c) => String(c[0]).includes("/policy/bindings") && (c[1] as RequestInit)?.method === "POST");
    expect(createPosts.length).toBe(0);
  });
});
