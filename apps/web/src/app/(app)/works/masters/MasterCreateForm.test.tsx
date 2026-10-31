import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithIntl as render } from "@/lib/testUtils/intl";

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

describe("MasterCreateForm — CLOS2-S3-07 network failure", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows catalogued copy, never the raw 'Failed to fetch', when offline", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));

    render(<MasterCreateForm masterType="work-types" />);
    fireEvent.click(screen.getByRole("button", { name: "+ Add Work Types" }));
    fireEvent.change(screen.getByLabelText(/^Name/i), { target: { value: "Road" } });
    fireEvent.change(screen.getByLabelText(/^Code/i), { target: { value: "RD" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(alert).toHaveTextContent(/couldn.t connect/i));
    expect(alert.textContent).not.toContain("Failed to fetch");
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

describe("MasterCreateForm — GAP-WORKS-MASTERS-05 / SF-15 post-create accepted state", () => {
  it("after a 202 shows the accepted notice and refreshes only when the user asks (no timer-driven refreshes)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
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

      await waitFor(() => expect(document.querySelector('[data-accepted-phase="accepted"]')).not.toBeNull());
      await vi.advanceTimersByTimeAsync(600 + 1500 + 3000 + 10);
      const before = refresh.mock.calls.length;
      fireEvent.click(screen.getByRole("button", { name: "Refresh now" }));
      expect(refresh.mock.calls.length).toBe(before + 1);
    } finally {
      vi.useRealTimers();
      vi.restoreAllMocks();
    }
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

describe("MasterCreateForm — UAT B9-works fields match the backend schemas", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("user-departments offers Demand Number (no Code) and POSTs demandNumber", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 202 }));
    render(<MasterCreateForm masterType="user-departments" onCreated={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "+ Add User Departments" }));
    expect(screen.queryByLabelText(/^Code/i)).toBeNull();
    fireEvent.change(screen.getByLabelText(/^Name/i), { target: { value: "PWD North" } });
    fireEvent.change(screen.getByLabelText(/^Demand Number/i), { target: { value: "H-07" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const body = JSON.parse(String((fetchSpy.mock.calls[0][1] as RequestInit).body));
    expect(body).toEqual({ name: "PWD North", demandNumber: "H-07", active: true });
  });

  it("contractor-classes offers Description (no Code) and POSTs description", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 202 }));
    render(<MasterCreateForm masterType="contractor-classes" onCreated={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "+ Add Contractor Classes" }));
    expect(screen.queryByLabelText(/^Code/i)).toBeNull();
    fireEvent.change(screen.getByLabelText(/^Name/i), { target: { value: "Class A" } });
    fireEvent.change(screen.getByLabelText(/^Description/i), { target: { value: "Above 1.5 crore" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const body = JSON.parse(String((fetchSpy.mock.calls[0][1] as RequestInit).body));
    expect(body).toEqual({ name: "Class A", description: "Above 1.5 crore", active: true });
  });

  it.each(["proposer-types", "programs", "publication-levels", "issue-types"])("%s has no Code field", (masterType) => {
    render(<MasterCreateForm masterType={masterType} />);
    fireEvent.click(screen.getByRole("button", { name: /^\+ Add/ }));
    expect(screen.queryByLabelText(/^Code/i)).toBeNull();
  });

  it("editing an sr-item PATCHes only active + version (sr_items has no name/code)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 202 }));
    render(
      <MasterCreateForm
        masterType="sr-items"
        editItem={{ id: "sr-1", version: 2, itemCode: "IT-1", description: "Concrete", active: true }}
      />,
    );
    expect(screen.queryByLabelText(/^Description/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const body = JSON.parse(String((fetchSpy.mock.calls[0][1] as RequestInit).body));
    expect(body).toEqual({ active: true, version: 2 });
  });
});
