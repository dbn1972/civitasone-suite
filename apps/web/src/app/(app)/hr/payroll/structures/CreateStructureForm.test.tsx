import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { CreateStructureForm, CREATE_REFRESH_DELAY_MS } from "./CreateStructureForm";

// UX-017: CreateStructureForm now reads its copy through next-intl
// (useTranslations("createStructureForm")), so every render needs a real
// provider in the tree -- same pattern as off-cycle/CreateOffCycleForm.test.tsx.
function renderForm() {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <CreateStructureForm />
    </NextIntlClientProvider>,
  );
}

describe("CreateStructureForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("requires a name before opening the confirm dialog", () => {
    renderForm();
    fireEvent.click(screen.getByText("Create Structure"));
    expect(screen.getByText("Structure name is required.")).toBeInTheDocument();
  });

  it("creates a structure on confirm (happy path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "new-struct-1", status: "accepted", correlationId: "c1" }), { status: 202 }),
    );

    renderForm();
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "Grade Pay A" } });
    fireEvent.click(screen.getByText("Create Structure"));

    await waitFor(() => expect(screen.getByText("Create this pay structure?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Create structure"));

    await waitFor(() => {
      expect(screen.getByText(/Structure submitted/)).toBeInTheDocument();
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it("surfaces a clerk-safe error on the confirm dialog, never the server's raw code/status (error path) (UX-020)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 500 }));

    renderForm();
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "Grade Pay B" } });
    fireEvent.click(screen.getByText("Create Structure"));

    await waitFor(() => expect(screen.getByText("Create this pay structure?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Create structure"));

    await waitFor(() => {
      expect(screen.getByText(/couldn't save/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/API_ERROR: 500/)).not.toBeInTheDocument();
  });
});

// GAP-PAYROLL-STRUCTURES-05: creation is async (202 + consumer): refresh once more after it settles.
describe("CreateStructureForm delayed refresh", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it("refreshes immediately and once more after CREATE_REFRESH_DELAY_MS", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: "s1", status: "accepted" }), { status: 202 }));
    renderForm();
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "Level 10" } });
    fireEvent.click(screen.getByText("Create Structure"));
    await waitFor(() => expect(screen.getByText("Create this pay structure?")).toBeInTheDocument());
    // Fake timers only from here, so the dialog/promise plumbing above runs on real time.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fireEvent.click(screen.getByText("Create structure"));
    await vi.waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(CREATE_REFRESH_DELAY_MS + 50);
    expect(refreshMock).toHaveBeenCalledTimes(2);
  });

  it("does not refresh again after unmount (no timer leak)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: "s1", status: "accepted" }), { status: 202 }));
    const { unmount } = render(
      <NextIntlClientProvider locale="en" messages={enMessages}><CreateStructureForm /></NextIntlClientProvider>,
    );
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "Level 11" } });
    fireEvent.click(screen.getByText("Create Structure"));
    await waitFor(() => expect(screen.getByText("Create this pay structure?")).toBeInTheDocument());
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fireEvent.click(screen.getByText("Create structure"));
    await vi.waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
    unmount();
    await vi.advanceTimersByTimeAsync(CREATE_REFRESH_DELAY_MS + 50);
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });
});
