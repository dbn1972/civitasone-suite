import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@/test-utils/intl-render";

const cookieGet = vi.fn();
const redirectMock = vi.fn((to: string) => { throw new Error(`NEXT_REDIRECT:${to}`); });
vi.mock("next/headers", () => ({ cookies: () => ({ get: cookieGet }) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  redirect: (to: string) => redirectMock(to),
}));

import LegacyDelegationsPage from "./page";

function token(roles: string[]): { value: string } {
  return { value: `h.${Buffer.from(JSON.stringify({ sub: "u1", roles })).toString("base64url")}.s` };
}

beforeEach(() => {
  cookieGet.mockReset();
  redirectMock.mockClear();
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: [], total: 0 }), { status: 200 }));
});

describe("Legacy delegations page: admin gate (mirrors the service: workflow_admin, super_admin, tenant_admin)", () => {
  it.each([["workflow_admin"], ["super_admin"], ["tenant_admin"]])("renders for %s", async (role) => {
    cookieGet.mockReturnValue(token([role]));
    render(<LegacyDelegationsPage />);
    expect(screen.getByRole("heading", { name: "Legacy delegations" })).toBeInTheDocument();
    expect(await screen.findByText("No legacy delegations")).toBeInTheDocument();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it.each([[["workflow_user"]], [["estab_admin", "hr_admin"]], [[]]])("redirects %j before rendering or fetching", (roles) => {
    cookieGet.mockReturnValue(token(roles as string[]));
    expect(() => render(<LegacyDelegationsPage />)).toThrow("NEXT_REDIRECT:/workflow/delegations");
    expect(redirectMock).toHaveBeenCalledWith("/workflow/delegations");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("redirects when there is no session at all", () => {
    cookieGet.mockReturnValue(undefined);
    expect(() => render(<LegacyDelegationsPage />)).toThrow("NEXT_REDIRECT");
  });
});
