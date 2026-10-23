import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }));

import { DakActions } from "./DakActions";

const DAK_ID = globalThis.crypto.randomUUID();

function renderActions(locale: "en" | "hi" = "en", status = "pending") {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === "en" ? enMessages : hiMessages}>
      <DakActions dakId={DAK_ID} status={status} />
    </NextIntlClientProvider>,
  );
}

describe("DakActions", () => {
  const f = vi.fn();
  beforeEach(() => { f.mockReset(); refresh.mockReset(); vi.stubGlobal("fetch", f); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("acknowledge posts to the /api/proxy path (not the handler-less /api/v1)", async () => {
    f.mockResolvedValue(new Response("{}", { status: 202 }));
    renderActions();
    fireEvent.click(screen.getByRole("button", { name: "Acknowledge" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Acknowledge" }));
    await waitFor(() => expect(f).toHaveBeenCalled());
    expect(f.mock.calls[0]![0]).toBe(`/api/proxy/v1/documents/daks/${DAK_ID}/acknowledge`);
    expect((f.mock.calls[0]![1] as RequestInit).method).toBe("POST");
  });

  it("forward uses a dedicated assignee field (validated as a UUID) and sends it as assignedTo", async () => {
    f.mockResolvedValue(new Response("{}", { status: 202 }));
    renderActions();
    const forward = screen.getByRole("button", { name: "Forward" });
    expect(forward).toBeDisabled();

    const input = screen.getByLabelText("Assign to (user ID)");
    fireEvent.change(input, { target: { value: "not-a-uuid" } });
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a valid user ID (UUID).");
    expect(forward).toBeDisabled();

    const assignee = globalThis.crypto.randomUUID();
    fireEvent.change(input, { target: { value: assignee } });
    expect(forward).toBeEnabled();
    fireEvent.click(forward);
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Forward" }));
    await waitFor(() => expect(f).toHaveBeenCalled());
    expect(f.mock.calls[0]![0]).toBe(`/api/proxy/v1/documents/daks/${DAK_ID}/forward`);
    expect(JSON.parse((f.mock.calls[0]![1] as RequestInit).body as string)).toEqual({ assignedTo: assignee });
  });

  it("renders Hindi copy", () => {
    renderActions("hi");
    expect(screen.getByText("किसे सौंपें (उपयोगकर्ता आईडी)")).toBeInTheDocument();
  });
});
