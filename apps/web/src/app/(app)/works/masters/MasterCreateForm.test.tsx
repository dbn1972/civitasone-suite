import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/app/_components/ds", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/_components/ds")>();
  return {
    ...actual,
    useToast: () => ({
      toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
    }),
  };
});

import { MasterCreateForm } from "./MasterCreateForm";

describe("MasterCreateForm — UX-016 clerk-safe errors", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a clerk-safe message, never the raw HTTP status, when the backend does not accept (202) the create", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 500 }));

    render(<MasterCreateForm masterType="work-types" />);
    fireEvent.click(screen.getByRole("button", { name: "+ Add Work Types" }));
    fireEvent.change(screen.getByLabelText(/^Name/i), { target: { value: "Road" } });
    fireEvent.change(screen.getByLabelText(/^Code/i), { target: { value: "RD" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(alert).toHaveTextContent(/couldn't save/i));
    expect(alert.textContent).not.toMatch(/\b500\b/);
    // The legitimate client-side validation messages ("... is required") must
    // still work unchanged — they are not part of this fix.
  });

  it("still shows the legitimate client-side validation message unchanged when a required field is empty", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    render(<MasterCreateForm masterType="work-types" />);
    fireEvent.click(screen.getByRole("button", { name: "+ Add Work Types" }));
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/Name is required/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("MasterCreateForm — GAP-WORKS-HOME-05 write gating", () => {
  it("renders the Add control by default (canWrite defaults true — existing callers unchanged)", () => {
    render(<MasterCreateForm masterType="work-types" />);
    expect(screen.getByRole("button", { name: "+ Add Work Types" })).toBeInTheDocument();
  });

  it("renders nothing (no Add control) for a read-only role when canWrite is false", () => {
    const { container } = render(<MasterCreateForm masterType="work-types" canWrite={false} />);
    expect(screen.queryByRole("button", { name: /\+ Add/i })).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });
});

describe("MasterCreateForm — GAP-WORKS-MASTERS-03 parent picker (no raw UUID)", () => {
  it("work-sub-types renders a Work Type picker, not a 'Paste ... UUID' text box", () => {
    render(
      <MasterCreateForm
        masterType="work-sub-types"
        parentOptions={[{ id: "wt-1", label: "Roads" }]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "+ Add Work Sub-Types" }));
    // No raw UUID paste box anywhere.
    expect(screen.queryByPlaceholderText(/paste .* uuid/i)).not.toBeInTheDocument();
    // A search combobox for the parent is present instead.
    expect(screen.getByRole("combobox", { name: /work type/i })).toBeInTheDocument();
  });

  it("submits the SELECTED workTypeId in the POST body", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("", { status: 202 }));

    render(
      <MasterCreateForm
        masterType="work-sub-types"
        parentOptions={[{ id: "wt-1", label: "Roads" }]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "+ Add Work Sub-Types" }));
    fireEvent.change(screen.getByLabelText(/^Name/i), { target: { value: "Bituminous" } });
    fireEvent.change(screen.getByLabelText(/^Code/i), { target: { value: "BT" } });

    // Open the picker and choose "Roads".
    const combo = screen.getByRole("combobox", { name: /work type/i });
    fireEvent.focus(combo);
    fireEvent.change(combo, { target: { value: "Road" } });
    fireEvent.mouseDown(await screen.findByText("Roads"));

    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body.workTypeId).toBe("wt-1");
    expect(body.name).toBe("Bituminous");
  });
});

describe("MasterCreateForm — GAP-WORKS-MASTERS-05 post-create polling", () => {
  it("refreshes repeatedly after a 202 until the retry schedule is exhausted", async () => {
    vi.useFakeTimers();
    const refresh = vi.fn();
    // Re-mock useRouter for this test to capture refresh calls.
    const nav = await import("next/navigation");
    vi.spyOn(nav, "useRouter").mockReturnValue({ refresh } as never);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 202 }));

    render(<MasterCreateForm masterType="work-types" />);
    fireEvent.click(screen.getByRole("button", { name: "+ Add Work Types" }));
    fireEvent.change(screen.getByLabelText(/^Name/i), { target: { value: "Roads" } });
    fireEvent.change(screen.getByLabelText(/^Code/i), { target: { value: "RD" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    // Let the submit promise settle, then advance the polling timers.
    await vi.waitFor(() => {}, { timeout: 50 });
    await vi.advanceTimersByTimeAsync(600 + 1500 + 3000 + 10);
    expect(refresh.mock.calls.length).toBeGreaterThanOrEqual(3);

    vi.useRealTimers();
    vi.restoreAllMocks();
  });
});

describe("MasterCreateForm — GAP-WORKS-MASTERS-04 edit mode", () => {
  it("prefills from editItem and PATCHes with the row version", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("", { status: 202 }));

    render(
      <MasterCreateForm
        masterType="work-types"
        editItem={{ id: "wt-9", version: 4, name: "Roads", code: "RD", active: true }}
      />,
    );
    // Form is already open in edit mode and prefilled.
    const nameInput = screen.getByLabelText(/^Name/i) as HTMLInputElement;
    expect(nameInput.value).toBe("Roads");
    fireEvent.change(nameInput, { target: { value: "Roads & Bridges" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toContain("/works/masters/work-types/wt-9");
    expect((init as RequestInit).method).toBe("PATCH");
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body.version).toBe(4);
    expect(body.name).toBe("Roads & Bridges");
  });
});
