import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }));

import { ApplyTemplateCard } from "./ApplyTemplateCard";

const TEMPLATES = [
  { id: "default", name: "Standard joining checklist", stepCount: 9, isDefault: true },
  { id: "t-it", name: "IT joiners", stepCount: 3, isDefault: false },
];

function ui(hasTasks = false) {
  return render(<NextIntlClientProvider locale="en" messages={enMessages}><ApplyTemplateCard employeeId="emp-1" hasTasks={hasTasks} /></NextIntlClientProvider>);
}
function mockFetch(post: () => Response, list: () => Response = () => new Response(JSON.stringify({ data: TEMPLATES }), { status: 200 })) {
  return vi.fn((url: string, init?: RequestInit) => {
    if (init?.method === "POST") return Promise.resolve(post());
    if (typeof url === "string" && url.includes("/onboarding/templates")) return Promise.resolve(list());
    return Promise.resolve(new Response("nf", { status: 404 }));
  });
}

describe("ApplyTemplateCard (GAP-HR-ONBOARDING-02)", () => {
  beforeEach(() => { refresh.mockReset(); vi.useRealTimers(); });
  afterEach(() => vi.unstubAllGlobals());

  it("lists the default plus the tenant's templates and applies the chosen one with an idempotency key", async () => {
    const f = mockFetch(() => new Response(JSON.stringify({ employeeId: "emp-1", status: "accepted", stepCount: 3 }), { status: 202 }));
    vi.stubGlobal("fetch", f);
    ui();
    await screen.findByRole("option", { name: /IT joiners/ });
    fireEvent.change(screen.getByLabelText("Template"), { target: { value: "t-it" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply template" }));
    expect(await screen.findByText(/3 tasks/i)).toBeInTheDocument();
    const call = f.mock.calls.find(([, i]) => (i as RequestInit | undefined)?.method === "POST")!;
    expect(String(call[0])).toContain("/hrms/employees/emp-1/onboarding/apply-template");
    expect(JSON.parse((call[1] as RequestInit).body as string)).toEqual({ templateId: "t-it" });
    expect(((call[1] as RequestInit).headers as Record<string, string>)["x-idempotency-key"]).toMatch(/:t-it$/);
  });

  it("uses a different heading when the joinee already has tasks (top-up, safe to repeat)", async () => {
    vi.stubGlobal("fetch", mockFetch(() => new Response("{}", { status: 202 })));
    ui(true);
    expect(await screen.findByRole("heading", { name: /add missing steps/i })).toBeInTheDocument();
  });

  it("shows a plain error (no raw status) and no success notice when the server refuses", async () => {
    vi.stubGlobal("fetch", mockFetch(() => new Response(JSON.stringify({ code: "EMPLOYEE_EXITED", message: "x" }), { status: 409 })));
    ui();
    await screen.findByRole("option", { name: /IT joiners/ });
    fireEvent.click(screen.getByRole("button", { name: "Apply template" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("when the template list cannot load it says so instead of offering a blind Apply", async () => {
    vi.stubGlobal("fetch", mockFetch(() => new Response("{}", { status: 202 }), () => new Response("", { status: 500 })));
    ui();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/couldn't load/i));
    expect(screen.queryByRole("button", { name: "Apply template" })).not.toBeInTheDocument();
  });
});
