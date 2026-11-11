import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SetPasswordForm } from "./SetPasswordForm";

// generated per run: no password literal lives in the repo
const GOOD = `Aa1!${crypto.randomUUID()}`;
const TOKEN = "11111111-2222-4333-8444-555555555555.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

function type(label: RegExp, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe("SetPasswordForm", () => {
  let fetchSpy: MockInstance<typeof fetch>;
  beforeEach(() => {
    window.history.replaceState(null, "", `/auth/set-password#token=${TOKEN}`);
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({ status: "password_set" }), { status: 200 }));
  });
  afterEach(() => vi.restoreAllMocks());

  it("reads the token from the fragment and removes it from the address bar", async () => {
    render(<SetPasswordForm />);
    expect(await screen.findByLabelText(/new password/i)).toBeInTheDocument();
    expect(window.location.hash).toBe("");
    expect(window.location.href).not.toContain(TOKEN);
  });

  it("without a token it asks for the link instead of showing a form", async () => {
    window.history.replaceState(null, "", "/auth/set-password");
    render(<SetPasswordForm />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/link your administrator gave you/i);
    expect(screen.queryByLabelText(/new password/i)).not.toBeInTheDocument();
  });

  it("refuses mismatched or short passwords without calling the server", async () => {
    render(<SetPasswordForm />);
    await screen.findByLabelText(/new password/i);
    type(/^new password/i, GOOD); type(/confirm/i, "different");
    fireEvent.click(screen.getByRole("button", { name: /set password/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/do not match/i);
    type(/^new password/i, "short"); type(/confirm/i, "short");
    fireEvent.click(screen.getByRole("button", { name: /set password/i }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/at least 12/i));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("posts the token and password to the same-origin route only, then shows success and clears the fields", async () => {
    render(<SetPasswordForm />);
    await screen.findByLabelText(/new password/i);
    type(/^new password/i, GOOD); type(/confirm/i, GOOD);
    fireEvent.click(screen.getByRole("button", { name: /set password/i }));
    expect(await screen.findByRole("status")).toHaveTextContent(/password is set/i);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("/api/auth/set-password");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ token: TOKEN, password: GOOD });
    expect(document.body.textContent).not.toContain(GOOD);
  });

  it("explains an expired link and a policy rejection, never echoing the password", async () => {
    fetchSpy.mockImplementationOnce(async () => new Response(JSON.stringify({ code: "INVALID_OR_EXPIRED_TOKEN" }), { status: 400 }));
    render(<SetPasswordForm />);
    await screen.findByLabelText(/new password/i);
    type(/^new password/i, GOOD); type(/confirm/i, GOOD);
    fireEvent.click(screen.getByRole("button", { name: /set password/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/invalid or has expired/i);
    fetchSpy.mockImplementationOnce(async () => new Response(JSON.stringify({ code: "PASSWORD_POLICY" }), { status: 422 }));
    fireEvent.click(screen.getByRole("button", { name: /set password/i }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/does not meet the policy/i));
    expect(document.body.textContent).not.toContain(GOOD);
  });
});
