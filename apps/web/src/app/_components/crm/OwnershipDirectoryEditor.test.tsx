import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { OwnershipDirectoryEditor } from "./OwnershipDirectoryEditor";
import * as as from "@/lib/crm/assignment";

function render(ui: React.ReactElement) {
  return rtlRender(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

vi.mock("@/lib/crm/assignment", async (orig) => {
  const actual = await orig<typeof import("@/lib/crm/assignment")>();
  return {
    ...actual,
    getResources: vi.fn(),
    createResource: vi.fn(),
    updateResource: vi.fn(),
    deleteResource: vi.fn(),
  };
});
beforeEach(() => {
  vi.mocked(as.getResources).mockReset();
  vi.mocked(as.createResource).mockReset();
  vi.mocked(as.updateResource).mockReset();
  vi.mocked(as.deleteResource).mockReset();
});

describe("OwnershipDirectoryEditor (AS-002 admin)", () => {
  it("on a failed load shows a retry and no '+ Add' / empty-state (GAP-CRM-ASSIGNMENT-DIRECTORY-02)", async () => {
    vi.mocked(as.getResources).mockResolvedValue({ data: [], source: "error" });
    render(<OwnershipDirectoryEditor />);
    await waitFor(() => expect(screen.getByText(/We couldn't load queues/i)).toBeInTheDocument());
    expect(as.getResources).toHaveBeenCalledWith("assignment-queues");
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.queryByText(/No queues yet/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add queue/i })).not.toBeInTheDocument();
  });

  it("retrying after an error loads the rows (GAP-CRM-ASSIGNMENT-DIRECTORY-02)", async () => {
    vi.mocked(as.getResources)
      .mockResolvedValueOnce({ data: [], source: "error" })
      .mockResolvedValueOnce({ data: [{ id: "q1", name: "Inbound", description: "", enabled: true }], source: "api" });
    render(<OwnershipDirectoryEditor />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByDisplayValue("Inbound")).toBeInTheDocument());
  });

  it("switches tab and loads the matching resource", async () => {
    vi.mocked(as.getResources).mockResolvedValue({ data: [], source: "api" });
    render(<OwnershipDirectoryEditor />);
    await waitFor(() => expect(as.getResources).toHaveBeenCalledWith("assignment-queues"));
    fireEvent.click(screen.getByRole("tab", { name: /territories/i }));
    await waitFor(() => expect(as.getResources).toHaveBeenCalledWith("territories"));
  });

  it("creates an entry in the active resource", async () => {
    vi.mocked(as.getResources).mockResolvedValue({ data: [], source: "api" });
    vi.mocked(as.createResource).mockResolvedValue(undefined);
    render(<OwnershipDirectoryEditor />);
    await waitFor(() => expect(as.getResources).toHaveBeenCalledWith("assignment-queues"));
    fireEvent.click(screen.getByRole("button", { name: /add queue/i }));
    fireEvent.change(screen.getByLabelText(/name for new queue/i), { target: { value: "Inbound" } });
    fireEvent.click(screen.getByRole("button", { name: /create/i }));
    await waitFor(() =>
      expect(as.createResource).toHaveBeenCalledWith("assignment-queues", expect.objectContaining({ name: "Inbound" })),
    );
  });

  it("blocks create when the name is blank", async () => {
    vi.mocked(as.getResources).mockResolvedValue({ data: [], source: "api" });
    render(<OwnershipDirectoryEditor />);
    await waitFor(() => expect(as.getResources).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /add queue/i }));
    fireEvent.click(screen.getByRole("button", { name: /create/i }));
    expect(await screen.findByText(/needs a name/i)).toBeInTheDocument();
    expect(as.createResource).not.toHaveBeenCalled();
  });

  it("deletes an entry via ConfirmDialog", async () => {
    vi.mocked(as.getResources).mockResolvedValue({ data: [{ id: "q1", name: "Inbound", description: "", enabled: true }], source: "api" });
    vi.mocked(as.deleteResource).mockResolvedValue(undefined);
    render(<OwnershipDirectoryEditor />);
    await waitFor(() => expect(screen.getByDisplayValue("Inbound")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /delete Inbound/i }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /^delete$/i }));
    await waitFor(() => expect(as.deleteResource).toHaveBeenCalledWith("assignment-queues", "q1"));
  });

  it("surfaces a failed update and does not claim success", async () => {
    vi.mocked(as.getResources).mockResolvedValue({ data: [{ id: "q1", name: "Inbound", description: "", enabled: true }], source: "api" });
    vi.mocked(as.updateResource).mockRejectedValue(new Error("CONFLICT: renamed"));
    render(<OwnershipDirectoryEditor />);
    await waitFor(() => expect(screen.getByDisplayValue("Inbound")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/name for Inbound/i), { target: { value: "Inbound web" } });
    fireEvent.click(screen.getByRole("button", { name: /save Inbound/i }));
    expect(await screen.findByText(/conflict/i)).toBeInTheDocument();
    expect(screen.queryByText(/” saved\./i)).not.toBeInTheDocument();
  });

  // GAP-CRM-ASSIGNMENT-DIRECTORY-01
  it("uses correct singular copy on the Territories tab (not 'territorie')", async () => {
    vi.mocked(as.getResources).mockResolvedValue({ data: [], source: "api" });
    render(<OwnershipDirectoryEditor />);
    await waitFor(() => expect(as.getResources).toHaveBeenCalledWith("assignment-queues"));
    fireEvent.click(screen.getByRole("tab", { name: /territories/i }));
    await waitFor(() => expect(as.getResources).toHaveBeenCalledWith("territories"));
    expect(screen.getByRole("button", { name: "+ Add territory" })).toBeInTheDocument();
    expect(screen.queryByText(/territorie\b/i)).not.toBeInTheDocument();
    // The placeholder is correct too.
    fireEvent.click(screen.getByRole("button", { name: "+ Add territory" }));
    expect(screen.getByPlaceholderText("Territory name")).toBeInTheDocument();
  });

  it("uses correct singular copy on the Branches tab (not 'branche')", async () => {
    vi.mocked(as.getResources).mockResolvedValue({ data: [], source: "api" });
    render(<OwnershipDirectoryEditor />);
    await waitFor(() => expect(as.getResources).toHaveBeenCalledWith("assignment-queues"));
    fireEvent.click(screen.getByRole("tab", { name: /branches/i }));
    await waitFor(() => expect(as.getResources).toHaveBeenCalledWith("branches"));
    expect(screen.getByRole("button", { name: "+ Add branch" })).toBeInTheDocument();
    expect(screen.queryByText(/branche\b/i)).not.toBeInTheDocument();
  });

  // GAP-CRM-ASSIGNMENT-DIRECTORY-03
  it("re-sends unmodelled extra fields unchanged on save", async () => {
    vi.mocked(as.getResources).mockResolvedValue({
      data: [{ id: "t1", name: "North", description: "", enabled: true, extra: { code: "N1", region: "North" } }] as never,
      source: "api",
    });
    vi.mocked(as.updateResource).mockResolvedValue(undefined);
    render(<OwnershipDirectoryEditor />);
    await waitFor(() => expect(screen.getByDisplayValue("North")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/name for North/i), { target: { value: "North Zone" } });
    fireEvent.click(screen.getByRole("button", { name: /save North/i }));
    await waitFor(() =>
      expect(as.updateResource).toHaveBeenCalledWith(
        "assignment-queues",
        "t1",
        expect.objectContaining({ name: "North Zone", code: "N1", region: "North" }),
      ),
    );
  });
});

// GAP-CRM-ASSIGNMENT-DIRECTORY-06: per-row dirty marker + merge-after-save.
describe("OwnershipDirectoryEditor dirty markers (DIRECTORY-06)", () => {
  it("marks an edited row 'Unsaved', enables its Save, and leaves clean rows' Save disabled", async () => {
    vi.mocked(as.getResources).mockResolvedValue({
      data: [
        { id: "q1", name: "Inbound", description: "", enabled: true },
        { id: "q2", name: "Outbound", description: "", enabled: true },
      ],
      source: "api",
    });
    render(<OwnershipDirectoryEditor />);
    await waitFor(() => expect(screen.getByDisplayValue("Inbound")).toBeInTheDocument());
    // Both start clean → their Save buttons are disabled, no "Unsaved" pill.
    expect(screen.getByRole("button", { name: /save Inbound/i })).toBeDisabled();
    expect(screen.queryByText("Unsaved")).not.toBeInTheDocument();
    // Edit Inbound → it alone becomes dirty.
    fireEvent.change(screen.getByLabelText(/name for Inbound/i), { target: { value: "Inbound Web" } });
    expect(screen.getByText("Unsaved")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save Inbound Web/i })).toBeEnabled();
    // Outbound stays clean (its Save disabled).
    expect(screen.getByRole("button", { name: /save Outbound/i })).toBeDisabled();
  });

  it("saving row A does not reload the whole table or discard row B's unsaved edit", async () => {
    vi.mocked(as.getResources).mockResolvedValue({
      data: [
        { id: "q1", name: "Inbound", description: "", enabled: true },
        { id: "q2", name: "Outbound", description: "", enabled: true },
      ],
      source: "api",
    });
    vi.mocked(as.updateResource).mockResolvedValue(undefined);
    render(<OwnershipDirectoryEditor />);
    await waitFor(() => expect(screen.getByDisplayValue("Inbound")).toBeInTheDocument());
    // Edit B but don't save.
    fireEvent.change(screen.getByLabelText(/name for Outbound/i), { target: { value: "Outbound 2" } });
    // Edit + save A.
    fireEvent.change(screen.getByLabelText(/name for Inbound/i), { target: { value: "Inbound Web" } });
    fireEvent.click(screen.getByRole("button", { name: /save Inbound Web/i }));
    await waitFor(() => expect(as.updateResource).toHaveBeenCalledWith("assignment-queues", "q1", expect.objectContaining({ name: "Inbound Web" })));
    // A is clean now; B's unsaved edit survives (no full reload).
    expect(screen.getByDisplayValue("Outbound 2")).toBeInTheDocument();
    // getResources called once on mount only (not again for a post-save reload).
    expect(as.getResources).toHaveBeenCalledTimes(1);
  });

  it("Discard restores a row to its loaded values", async () => {
    vi.mocked(as.getResources).mockResolvedValue({
      data: [{ id: "q1", name: "Inbound", description: "", enabled: true }],
      source: "api",
    });
    render(<OwnershipDirectoryEditor />);
    await waitFor(() => expect(screen.getByDisplayValue("Inbound")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/name for Inbound/i), { target: { value: "Changed" } });
    fireEvent.click(screen.getByRole("button", { name: /discard changes to Changed/i }));
    expect(screen.getByDisplayValue("Inbound")).toBeInTheDocument();
    expect(screen.queryByText("Unsaved")).not.toBeInTheDocument();
  });
});

// GAP-CRM-ASSIGNMENT-DIRECTORY-05: tab-switch guard when dirty.
describe("OwnershipDirectoryEditor tab-switch guard (DIRECTORY-05)", () => {
  it("prompts before switching tabs with unsaved edits, and Cancel keeps the tab + edit", async () => {
    vi.mocked(as.getResources).mockResolvedValue({
      data: [{ id: "q1", name: "Inbound", description: "", enabled: true }],
      source: "api",
    });
    render(<OwnershipDirectoryEditor />);
    await waitFor(() => expect(screen.getByDisplayValue("Inbound")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/name for Inbound/i), { target: { value: "Inbound Web" } });
    // Try to switch to Territories → a confirm dialog appears; no new load yet.
    fireEvent.click(screen.getByRole("tab", { name: /territories/i }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/Discard unsaved changes/i)).toBeInTheDocument();
    // Cancel keeps Queues and the edit.
    fireEvent.click(within(dialog).getByRole("button", { name: /stay on this tab/i }));
    expect(screen.getByDisplayValue("Inbound Web")).toBeInTheDocument();
    expect(as.getResources).toHaveBeenCalledTimes(1);
    expect(as.getResources).not.toHaveBeenCalledWith("territories");
  });

  it("Discard-and-switch moves to the new tab", async () => {
    vi.mocked(as.getResources).mockResolvedValue({
      data: [{ id: "q1", name: "Inbound", description: "", enabled: true }],
      source: "api",
    });
    render(<OwnershipDirectoryEditor />);
    await waitFor(() => expect(screen.getByDisplayValue("Inbound")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/name for Inbound/i), { target: { value: "Inbound Web" } });
    fireEvent.click(screen.getByRole("tab", { name: /territories/i }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /discard and switch/i }));
    await waitFor(() => expect(as.getResources).toHaveBeenCalledWith("territories"));
  });

  it("does not prompt when nothing is dirty", async () => {
    vi.mocked(as.getResources).mockResolvedValue({ data: [], source: "api" });
    render(<OwnershipDirectoryEditor />);
    await waitFor(() => expect(as.getResources).toHaveBeenCalledWith("assignment-queues"));
    fireEvent.click(screen.getByRole("tab", { name: /territories/i }));
    await waitFor(() => expect(as.getResources).toHaveBeenCalledWith("territories"));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});
