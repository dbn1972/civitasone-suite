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
    fireEvent.change(screen.getByLabelText(/name for entry 1/i), { target: { value: "North Zone" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() =>
      expect(as.updateResource).toHaveBeenCalledWith(
        "assignment-queues",
        "t1",
        expect.objectContaining({ name: "North Zone", code: "N1", region: "North" }),
      ),
    );
  });
});
