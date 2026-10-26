/** Q28: the policy console collects a reason (min 5 chars) before any role-feature / binding revoke or restore. */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { GrantRowActions } from "./role-features/GrantRowActions";
import { BindingRowActions } from "./bindings/BindingRowActions";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

const GRANT = "44444444-4444-4444-8444-444444444444";
const BINDING = "55555555-5555-4555-8555-555555555555";
const REASON = "left the finance desk";

const ok = () => ({ ok: true, status: 202, json: async () => ({}), text: async () => "{}", headers: new Headers() }) as unknown as Response;

afterEach(() => vi.restoreAllMocks());

describe.each([
  ["role-feature revoke", () => render(<GrantRowActions grantId={GRANT} roleName="hr_admin" featureKey="hrms.leave" granted />), "Revoke", "DELETE", `/api/proxy/v1/policy/role-features/${GRANT}`],
  ["role-feature restore", () => render(<GrantRowActions grantId={GRANT} roleName="hr_admin" featureKey="hrms.leave" granted={false} />), "Restore", "POST", "/api/proxy/v1/policy/role-features"],
  ["binding revoke", () => render(<BindingRowActions bindingId={BINDING} label="Asha / clerk" status="active" />), "Revoke", "DELETE", `/api/proxy/v1/policy/bindings/${BINDING}`],
] as const)("%s", (_name, mount, action, method, url) => {
  it("keeps Confirm disabled until 5+ characters are typed, then sends the trimmed reason", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(ok());
    mount();
    fireEvent.click(screen.getByRole("button", { name: action }));
    const dialog = screen.getByRole("alertdialog");
    const confirm = Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === action)!;
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "abcd" } });
    expect(confirm).toBeDisabled();
    expect(spy).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: `  ${REASON}  ` } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    const [calledUrl, init] = spy.mock.calls[0]!;
    expect(String(calledUrl)).toBe(url);
    expect((init as RequestInit).method).toBe(method);
    expect(JSON.parse(String((init as RequestInit).body)).reason).toBe(REASON);
  });
});
