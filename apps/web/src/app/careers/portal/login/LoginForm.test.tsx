import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render as rtlRender, screen, fireEvent, act } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const H = vi.hoisted(() => ({ search: "", push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: H.push }),
  useSearchParams: () => new URLSearchParams(H.search),
}));

import { LoginForm, RESEND_COOLDOWN_SECONDS, APPLICATION_REF_PATTERN, errorKeyFor } from "./LoginForm";

const render = () => rtlRender(<NextIntlClientProvider locale="en" messages={enMessages}><LoginForm /></NextIntlClientProvider>);
const sent = () => new Response(JSON.stringify({ expiresIn: 90 }), { status: 202 });
const json = (body: unknown, status: number) => new Response(JSON.stringify(body), { status });

async function reachOtpPhase(fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal("fetch", fetchMock);
  render();
  fireEvent.change(screen.getByLabelText(/Email address/), { target: { value: "a@example.com" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: /send one-time code/i })); });
}

beforeEach(() => { H.search = ""; H.push.mockClear(); });

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
      .mockResolvedValueOnce(json({ code: "MAX_ATTEMPTS", message: "x" }, 429));
    await reachOtpPhase(f);
    fireEvent.change(screen.getByLabelText(/6-digit code/), { target: { value: "123456" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /verify/i })); });
    expect(screen.getByText(/too many attempts/i)).toBeTruthy();
    expect((screen.getByRole("button", { name: /verify/i }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("LoginForm accessibility and copy (GAP-RECRUITMENT-CAREERS-PORTAL-LOGIN-02/-04/-08)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows no 'Government of India' claim", () => {
    vi.stubGlobal("fetch", vi.fn());
    const { container } = render();
    expect(container.textContent).not.toMatch(/Government of India/i);
    expect(screen.getByRole("heading", { name: "Candidate Portal" })).toBeInTheDocument();
  });

  it("links a failed verification to the OTP input via aria-invalid + aria-describedby on a role=alert", async () => {
    const f = vi.fn().mockResolvedValueOnce(sent()).mockResolvedValueOnce(json({ code: "OTP_INVALID", message: "raw server text" }, 422));
    await reachOtpPhase(f);
    const input = screen.getByLabelText(/6-digit code/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "123456" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /verify/i })); });
    expect(input).toHaveAttribute("aria-invalid", "true");
    const alert = screen.getByRole("alert", { name: "" });
    expect(input.getAttribute("aria-describedby")).toBe(alert.id);
    // Localised copy, not the raw API message.
    expect(alert.textContent).toBe(enMessages.careersPortalLogin.error_invalidCode);
    expect(alert.textContent).not.toMatch(/raw server text/);
    expect(document.activeElement).toBe(input);
  });

  it("links a failed send to the email input", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ code: "GATEWAY_ERROR", message: "could not reach service" }, 502)));
    render();
    const email = screen.getByLabelText(/Email address/) as HTMLInputElement;
    fireEvent.change(email, { target: { value: "a@example.com" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /send one-time code/i })); });
    expect(email).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert").textContent).toBe(enMessages.careersPortalLogin.error_network);
  });

  it("does not use a real-looking OTP example as the placeholder", async () => {
    await (async () => { await reachOtpPhase(vi.fn(async () => sent())); })();
    const input = screen.getByLabelText(/6-digit code/) as HTMLInputElement;
    expect(input.placeholder).not.toMatch(/\d{6}/);
    expect(input.placeholder).toBe("6 digits");
  });
});

describe("errorKeyFor", () => {
  it("maps API codes to localisable keys", () => {
    expect(errorKeyFor(429, "MAX_ATTEMPTS", "verify")).toBe("locked");
    expect(errorKeyFor(429, "OTP_COOLDOWN", "send")).toBe("cooldown");
    expect(errorKeyFor(422, "OTP_INVALID", "verify")).toBe("invalidCode");
    expect(errorKeyFor(404, "NOT_FOUND", "verify")).toBe("noAccount");
    expect(errorKeyFor(404, "NO_CHALLENGE", "verify")).toBe("noChallenge");
    expect(errorKeyFor(502, "GATEWAY_ERROR", "send")).toBe("network");
    expect(errorKeyFor(400, "VALIDATION_FAILED", "send")).toBe("validation");
  });
});

describe("LoginForm ?ref handling (GAP-RECRUITMENT-CAREERS-PORTAL-LOGIN-05)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("accepts both application number formats", () => {
    expect(APPLICATION_REF_PATTERN.test("APP-2026-AB12CD")).toBe(true);
    expect(APPLICATION_REF_PATTERN.test("APP-1A2B3C4D")).toBe(true);
    expect(APPLICATION_REF_PATTERN.test("Call 1800 to claim your refund")).toBe(false);
    expect(APPLICATION_REF_PATTERN.test("APP-<b>x</b>")).toBe(false);
  });

  it("renders no banner for an arbitrary sentence in ?ref", () => {
    H.search = "ref=" + encodeURIComponent("Your account is locked, call 1800-000-000");
    vi.stubGlobal("fetch", vi.fn());
    const { container } = render();
    expect(container.textContent).not.toMatch(/locked/);
    expect(container.textContent).not.toMatch(/tracking application/i);
  });

  it("renders the banner for a valid ref and keeps it in the post-login redirect", async () => {
    H.search = "ref=APP-2026-AB12CD";
    const f = vi.fn().mockResolvedValueOnce(sent()).mockResolvedValueOnce(json({ candidateId: "c" }, 200));
    vi.stubGlobal("fetch", f);
    render();
    expect(screen.getByText("APP-2026-AB12CD")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Email address/), { target: { value: "a@example.com" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /send one-time code/i })); });
    fireEvent.change(screen.getByLabelText(/6-digit code/), { target: { value: "123456" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /verify/i })); });
    expect(H.push).toHaveBeenCalledWith("/careers/portal?ref=APP-2026-AB12CD");
  });
});
