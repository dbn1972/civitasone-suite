import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@/test-utils/intl-render";

const cookieGet = vi.fn();
vi.mock("next/headers", () => ({ cookies: () => ({ get: cookieGet }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }), redirect: vi.fn() }));

import MyDelegationsPage from "./page";

const ME = "11111111-1111-4111-8111-111111111111";
function token(payload: Record<string, unknown>): { value: string } {
  return { value: `h.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.s` };
}

beforeEach(() => {
  cookieGet.mockReset();
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: [], total: 0 }), { status: 200 }));
});

describe("My delegations page", () => {
  it("takes the user and role choices from the session token", async () => {
    cookieGet.mockReturnValue(token({ sub: ME, roles: ["workflow_user", "estab_officer"] }));
    render(<MyDelegationsPage />);
    expect(screen.getByRole("checkbox", { name: "Workflow user" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Estab officer" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Super admin" })).not.toBeInTheDocument();
    expect(await screen.findByText("No active delegations")).toBeInTheDocument();
  });

  it.each([["workflow_admin"], ["super_admin"], ["tenant_admin"]])("offers the legacy report link to %s", (role) => {
    cookieGet.mockReturnValue(token({ sub: ME, roles: ["workflow_user", role] }));
    render(<MyDelegationsPage />);
    expect(screen.getByRole("link", { name: "Legacy delegations" })).toBeInTheDocument();
  });

  it("does not offer the legacy report link to a plain workflow user", () => {
    cookieGet.mockReturnValue(token({ sub: ME, roles: ["workflow_user"] }));
    render(<MyDelegationsPage />);
    expect(screen.queryByRole("link", { name: "Legacy delegations" })).not.toBeInTheDocument();
  });
});
