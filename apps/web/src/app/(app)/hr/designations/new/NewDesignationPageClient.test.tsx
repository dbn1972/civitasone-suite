import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { NewDesignationPageClient } from "./NewDesignationPageClient";

const pushMock = vi.fn();
const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

function renderClient() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <NewDesignationPageClient />
    </NextIntlClientProvider>,
  );
}

/**
 * GAP-HR-DESIGNATIONS-NEW-04: a successful add used to force
 * router.push("/hr/designations") 1.5s later regardless of what the user
 * wanted next, blocking "add several in a row" and never clearing its
 * timeout on unmount. The redirect is now an explicit choice.
 */
describe("NewDesignationPageClient — GAP-HR-DESIGNATIONS-NEW-04 no forced redirect", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    pushMock.mockReset();
    refreshMock.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("does not navigate away after a successful add, and offers Add another / Back to designations", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "d1" }), { status: 202 }));
    renderClient();

    fireEvent.change(screen.getByLabelText(/code/i), { target: { value: "CLERK" } });
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "Upper Division Clerk" } });
    fireEvent.click(screen.getByRole("button", { name: /add designation/i }));

    await screen.findByRole("button", { name: /add another/i });
    expect(pushMock).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /back to designations/i })).toBeInTheDocument();
  });

  it("'Add another' lets a second designation be added without navigating", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "d1" }), { status: 202 }));
    renderClient();

    fireEvent.change(screen.getByLabelText(/code/i), { target: { value: "CLERK" } });
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "Upper Division Clerk" } });
    fireEvent.click(screen.getByRole("button", { name: /add designation/i }));
    await screen.findByRole("button", { name: /add another/i });

    fireEvent.click(screen.getByRole("button", { name: /add another/i }));
    await waitFor(() => expect(screen.queryByRole("button", { name: /add another/i })).not.toBeInTheDocument());
    expect(pushMock).not.toHaveBeenCalled();
    // Form is still here, ready for a second entry.
    expect(screen.getByLabelText(/code/i)).toBeInTheDocument();
  });

  it("'Back to designations' navigates explicitly", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "d1" }), { status: 202 }));
    renderClient();

    fireEvent.change(screen.getByLabelText(/code/i), { target: { value: "CLERK" } });
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "Upper Division Clerk" } });
    fireEvent.click(screen.getByRole("button", { name: /add designation/i }));
    await screen.findByRole("button", { name: /back to designations/i });

    fireEvent.click(screen.getByRole("button", { name: /back to designations/i }));
    expect(pushMock).toHaveBeenCalledWith("/hr/designations");
  });
});
