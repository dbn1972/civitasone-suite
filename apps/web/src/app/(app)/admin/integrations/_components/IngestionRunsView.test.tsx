import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { IngestionRunsView } from "./IngestionRunsView";
import * as lib from "@/lib/admin/sftpIngestion";

vi.mock("@/lib/admin/sftpIngestion", async (orig) => {
  const actual = await orig<typeof import("@/lib/admin/sftpIngestion")>();
  return { ...actual, getIngestionRuns: vi.fn(), triggerIngestion: vi.fn() };
});
const getRuns = vi.mocked(lib.getIngestionRuns);
const trigger = vi.mocked(lib.triggerIngestion);

const run: lib.IngestionRun = {
  id: "r1", status: "partial", filesSeen: 2, rowsTotal: 100, rowsCreated: 90, rowsFailed: 10,
  error: "10 rows rejected", startedAt: "2026-08-05T10:00:00Z", finishedAt: "2026-08-05T10:01:00Z",
};

beforeEach(() => {
  getRuns.mockReset();
  trigger.mockReset();
});

describe("IngestionRunsView", () => {
  it("renders a runs table with created/failed counts", async () => {
    getRuns.mockResolvedValue({ data: [run], source: "api" });
    render(<IngestionRunsView provider="sftp" env="prod" />);
    await waitFor(() => expect(screen.getByText(/Partial/)).toBeInTheDocument());
    expect(screen.getByText("90")).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument();
    expect(screen.getByText(/10 rows rejected/)).toBeInTheDocument();
    expect(screen.queryByText(/showing saved information/i)).not.toBeInTheDocument();
  });

  it("shows the empty state ONLY on a successful (source api) empty load", async () => {
    getRuns.mockResolvedValue({ data: [], source: "api" });
    render(<IngestionRunsView provider="sftp" env="prod" />);
    await waitFor(() => expect(screen.getByText(/no ingestion runs yet/i)).toBeInTheDocument());
    expect(screen.queryByText(/showing saved information/i)).not.toBeInTheDocument();
  });

  it("on a failed load shows DataSourceBadge and NEVER a fabricated '0 rows'/empty-state", async () => {
    getRuns.mockResolvedValue({ data: [], source: "error" });
    render(<IngestionRunsView provider="sftp" env="prod" />);
    await waitFor(() => expect(screen.getByText(/showing saved information/i)).toBeInTheDocument());
    // must NOT claim there are zero runs, and must NOT print a "0" count
    expect(screen.queryByText(/no ingestion runs yet/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByText(/0 rows/i)).not.toBeInTheDocument();
  });

  it("'Run now' goes through ConfirmDialog BEFORE firing the trigger", async () => {
    getRuns.mockResolvedValue({ data: [], source: "api" });
    trigger.mockResolvedValue({ ok: true, error: null });
    render(<IngestionRunsView provider="sftp" env="prod" />);
    await waitFor(() => expect(screen.getByText(/no ingestion runs yet/i)).toBeInTheDocument());

    // Clicking "Run now" must NOT fire the trigger yet — only open the dialog.
    fireEvent.click(screen.getByRole("button", { name: /run now/i }));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(trigger).not.toHaveBeenCalled();

    // Confirm inside the dialog -> now it fires + reloads.
    const confirmBtn = screen.getAllByRole("button", { name: /run now/i }).find((b) => b.closest(".cd-panel"));
    fireEvent.click(confirmBtn!);
    await waitFor(() => expect(trigger).toHaveBeenCalledWith("sftp", "prod"));
    // reload happens after a successful trigger (initial load + reload = 2)
    await waitFor(() => expect(getRuns).toHaveBeenCalledTimes(2));
  });

  it("cancelling the dialog does not fire the trigger", async () => {
    getRuns.mockResolvedValue({ data: [], source: "api" });
    render(<IngestionRunsView provider="sftp" env="prod" />);
    await waitFor(() => expect(screen.getByText(/no ingestion runs yet/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /run now/i }));
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(trigger).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});
