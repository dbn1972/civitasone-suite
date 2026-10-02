import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

import { LoginForm, RESEND_COOLDOWN_SECONDS } from "./LoginForm";

const sent = () => new Response(JSON.stringify({ expiresIn: 90 }), { status: 202 });

async function reachOtpPhase(fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal("fetch", fetchMock);
  render(<LoginForm />);
  fireEvent.change(screen.getByLabelText(/Email address/), { target: { value: "a@example.com" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: /send one-time code/i })); });
}

describe("LoginForm OTP resend / expiry", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("disables resend for the cooldown, then enables it and re-requests a code", async () => {
    const f = vi.fn(async () => sent());
    await reachOtpPhase(f);
    const resend = screen.getByRole("button", { name: /resend code in/i }) as HTMLButtonElement;
    expect(resend.disabled).toBe(true);
    await act(async () => { vi.advanceTimersByTime((RESEND_COOLDOWN_SECONDS + 1) * 1000); });
    const ready = screen.getByRole("button", { name: /^resend code$/i }) as HTMLButtonElement;
    expect(ready.disabled).toBe(false);
    await act(async () => { fireEvent.click(ready); });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("shows the expiry message and disables verify once the code expires", async () => {
    await reachOtpPhase(vi.fn(async () => sent()));
    expect(screen.getByTestId("otp-expiry").textContent).toMatch(/expires in/i);
    fireEvent.change(screen.getByLabelText(/6-digit code/), { target: { value: "123456" } });
    await act(async () => { vi.advanceTimersByTime(91 * 1000); });
    expect(screen.getByTestId("otp-expiry").textContent).toMatch(/expired/i);
    expect((screen.getByRole("button", { name: /verify/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows a lockout message on 429 MAX_ATTEMPTS and disables verify", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(sent())
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: "MAX_ATTEMPTS", message: "x" }), { status: 429 }));
    await reachOtpPhase(f);
    fireEvent.change(screen.getByLabelText(/6-digit code/), { target: { value: "123456" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /verify/i })); });
    expect(screen.getByText(/too many attempts/i)).toBeTruthy();
    expect((screen.getByRole("button", { name: /verify/i }) as HTMLButtonElement).disabled).toBe(true);
  });
});
