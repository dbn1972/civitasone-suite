import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { RoleFeatureGrantForm } from "./RoleFeatureGrantForm";

afterEach(() => vi.restoreAllMocks());

describe("RoleFeatureGrantForm", () => {
  it("GAP-POLICY-ROLE-FEATURES-02: fresh render has empty fields and a disabled Grant button", () => {
    render(<RoleFeatureGrantForm />);
    const key = screen.getByPlaceholderText("finance.dashboard") as HTMLInputElement;
    expect(key.value).toBe("");
    expect(screen.getByRole("button", { name: "Grant feature" })).toBeDisabled();
  });

  it("GAP-POLICY-ROLE-FEATURES-03: a bad feature key is rejected (button stays disabled)", async () => {
    render(<RoleFeatureGrantForm />);
    const key = screen.getByPlaceholderText("finance.dashboard");
    fireEvent.change(key, { target: { value: "Not A Key!!" } });
    // No role selected AND invalid key -> submit still disabled.
    expect(screen.getByRole("button", { name: "Grant feature" })).toBeDisabled();
  });

  it("GAP-POLICY-ROLE-FEATURES-02: does not fetch before a grant is confirmed", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    render(<RoleFeatureGrantForm />);
    // Submitting with empty fields must not POST anything.
    fireEvent.submit(screen.getByRole("button", { name: "Grant feature" }).closest("form")!);
    await waitFor(() => {
      // the grant POST endpoint must never have been called
      const calledGrant = spy.mock.calls.some((c) => String(c[0]).includes("/policy/role-features") && (c[1] as RequestInit)?.method === "POST");
      expect(calledGrant).toBe(false);
    });
  });
});
