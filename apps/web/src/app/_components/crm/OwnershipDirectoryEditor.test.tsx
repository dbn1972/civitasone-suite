import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { OwnershipDirectoryEditor } from "./OwnershipDirectoryEditor";
import * as as from "@/lib/crm/assignment";

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
  it("loads the first tab (queues) and shows the saved-info badge on error", async () => {
    vi.mocked(as.getResources).mockResolvedValue({ data: [], source: "error" });
    render(<OwnershipDirectoryEditor />);
    await waitFor(() => expect(screen.getByText(/showing saved information/i)).toBeInTheDocument());
    expect(as.getResources).toHaveBeenCalledWith("assignment-queues");
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
    fireEvent.change(screen.getByLabelText(/name for entry 1/i), { target: { value: "Inbound" } });
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
    fireEvent.click(screen.getByRole("button", { name: /delete entry 1/i }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /^delete$/i }));
    await waitFor(() => expect(as.deleteResource).toHaveBeenCalledWith("assignment-queues", "q1"));
  });

  it("surfaces a failed update and does not claim success", async () => {
    vi.mocked(as.getResources).mockResolvedValue({ data: [{ id: "q1", name: "Inbound", description: "", enabled: true }], source: "api" });
    vi.mocked(as.updateResource).mockRejectedValue(new Error("CONFLICT: renamed"));
    render(<OwnershipDirectoryEditor />);
    await waitFor(() => expect(screen.getByDisplayValue("Inbound")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/name for entry 1/i), { target: { value: "Inbound web" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(await screen.findByText(/conflict/i)).toBeInTheDocument();
    expect(screen.queryByText(/saved/i)).not.toBeInTheDocument();
  });
});
