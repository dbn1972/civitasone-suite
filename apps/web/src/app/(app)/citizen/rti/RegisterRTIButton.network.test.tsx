import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { RegisterRTIButton } from "./RegisterRTIButton";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), prefetch: vi.fn(), replace: vi.fn() }) }));

const CPIO = { id: "11111111-1111-4111-8111-111111111111", name: "A. Sharma", designation: "Deputy Secretary", publicAuthority: "Municipal Corporation", department: "Water Supply" };

describe("RegisterRTIButton error rendering (CLOS-S1-12)", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("offline registration shows registerErrorFallback, not raw 'Failed to fetch'", async () => {
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
      init?.method === "POST"
        ? Promise.reject(new TypeError("Failed to fetch"))
        : Promise.resolve(new Response(JSON.stringify({ data: [CPIO] }), { status: 200, headers: { "content-type": "application/json" } })),
    ) as unknown as typeof fetch);
    render(<NextIntlClientProvider locale="en" messages={enMessages}><RegisterRTIButton /></NextIntlClientProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Register RTI" }));
    fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "Water bills" } });
    fireEvent.change(screen.getByLabelText("Information sought"), { target: { value: "Copies" } });
    const combo = screen.getByRole("combobox");
    fireEvent.focus(combo);
    fireEvent.change(combo, { target: { value: "Sharma" } });
    fireEvent.click(await screen.findByRole("option", { name: /A\. Sharma/ }));
    await screen.findByText(/Selected: A\. Sharma/);
    fireEvent.click(screen.getByRole("button", { name: "Submit application" }));
    expect(await screen.findByText(enMessages.citizenRti.registerErrorFallback)).toBeInTheDocument();
    expect(screen.queryByText("Failed to fetch")).toBeNull();
  });
});
