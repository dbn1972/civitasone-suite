import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { LogRequestButton } from "./LogRequestButton";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

describe("LogRequestButton error rendering (CLOS-S1-11)", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("offline submit shows the generic fallback, not raw 'Failed to fetch'", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))) as unknown as typeof fetch);
    render(<NextIntlClientProvider locale="en" messages={enMessages}><LogRequestButton /></NextIntlClientProvider>);
    fireEvent.click(screen.getByRole("button", { name: enMessages.citizenRequests.logRequest }));
    fireEvent.change(screen.getByLabelText(enMessages.citizenRequests.subject), { target: { value: "No water" } });
    fireEvent.change(screen.getByLabelText(enMessages.citizenRequests.description), { target: { value: "No supply" } });
    fireEvent.click(screen.getByText(enMessages.citizenRequests.consentLabel));
    fireEvent.click(screen.getByRole("button", { name: enMessages.citizenRequests.submitRequest }));
    expect(await screen.findByText("Could not log the request.")).toBeInTheDocument();
    expect(screen.queryByText("Failed to fetch")).toBeNull();
  });
});
