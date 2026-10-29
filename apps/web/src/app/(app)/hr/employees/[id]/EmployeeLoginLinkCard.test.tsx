import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }));

import { EmployeeLoginLinkCard } from "./EmployeeLoginLinkCard";

const EMP_ID = "8cf7f7eb-1de6-4a31-b48c-1f598ecf33c0";
const LOGIN = "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";
const m = enMessages.employeeLoginLink;

function renderCard() {
  render(<NextIntlClientProvider locale="en" messages={enMessages}><EmployeeLoginLinkCard employeeId={EMP_ID} /></NextIntlClientProvider>);
}

describe("EmployeeLoginLinkCard (FQ14)", () => {
  beforeEach(() => refresh.mockReset());
  afterEach(() => vi.restoreAllMocks());

  it("links a login with the reason via PATCH /login-link", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    renderCard();
    fireEvent.change(screen.getByLabelText(m.userIdLabel), { target: { value: LOGIN } });
    fireEvent.change(screen.getByLabelText(m.reasonLabel), { target: { value: "first login" } });
    fireEvent.click(screen.getByRole("button", { name: m.linkButton }));
    expect(await screen.findByText(m.linked)).toBeInTheDocument();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/proxy/v1/hrms/employees/${EMP_ID}/login-link`);
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({ userId: LOGIN, reason: "first login" });
    expect(refresh).toHaveBeenCalled();
  });

  it("unlinks with userId null", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    renderCard();
    fireEvent.change(screen.getByLabelText(m.reasonLabel), { target: { value: "wrong person" } });
    fireEvent.click(screen.getByRole("button", { name: m.unlinkButton }));
    expect(await screen.findByText(m.unlinked)).toBeInTheDocument();
    expect(JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string)).toEqual({ userId: null, reason: "wrong person" });
  });

  it("validates the login id and reason before calling the server", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    renderCard();
    fireEvent.change(screen.getByLabelText(m.userIdLabel), { target: { value: "not-a-uuid" } });
    fireEvent.change(screen.getByLabelText(m.reasonLabel), { target: { value: "ok reason" } });
    fireEvent.click(screen.getByRole("button", { name: m.linkButton }));
    expect(await screen.findByText(m.invalidUserId)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(m.reasonLabel), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: m.unlinkButton }));
    expect(await screen.findByText(m.reasonRequired)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows the server's refusal (LOGIN_ALREADY_LINKED) in plain words", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ code: "LOGIN_ALREADY_LINKED" }), { status: 409 }));
    renderCard();
    fireEvent.change(screen.getByLabelText(m.userIdLabel), { target: { value: LOGIN } });
    fireEvent.change(screen.getByLabelText(m.reasonLabel), { target: { value: "first login" } });
    fireEvent.click(screen.getByRole("button", { name: m.linkButton }));
    expect(await screen.findByText(m.error.LOGIN_ALREADY_LINKED)).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });
});
