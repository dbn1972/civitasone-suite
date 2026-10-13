import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@/test-utils/intl-render";
import { TaskActions } from "./TaskActions";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

const ME = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";

describe("TaskActions — GAP-WORKFLOW-MY-TASKS-01/08", () => {
  beforeEach(() => {
    refreshMock.mockReset();
    vi.restoreAllMocks();
  });
  afterEach(() => vi.restoreAllMocks());

  it("hides Approve/Return/Reject when the task is claimed by another reviewer", () => {
    render(<TaskActions taskId="t1" status="pending" assigneeId={OTHER} currentUserId={ME} compact />);
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Claim" })).not.toBeInTheDocument();
    expect(screen.getByText(/claimed by another reviewer/i)).toBeInTheDocument();
  });

  it("shows decision buttons when the task is claimed by me", () => {
    render(<TaskActions taskId="t1" status="pending" assigneeId={ME} currentUserId={ME} compact />);
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reject" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Claim" })).not.toBeInTheDocument();
  });

  it("offers Claim (and no decisions) when the task is unassigned", () => {
    render(<TaskActions taskId="t1" status="pending" assigneeId={null} currentUserId={ME} compact />);
    expect(screen.getByRole("button", { name: /Claim/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
  });

  it("Claim is a single click (no confirm dialog) and refreshes on success", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(null, { status: 202 }) as unknown as Response,
    );
    render(<TaskActions taskId="t1" status="pending" assigneeId={null} currentUserId={ME} compact />);
    fireEvent.click(screen.getByRole("button", { name: /Claim/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/proxy/v1/workflow/tasks/t1/claim",
      expect.objectContaining({ method: "POST" }),
    ));
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    // No ConfirmDialog was shown.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("maps a 403 NOT_ASSIGNEE from the server to a specific message", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ code: "NOT_ASSIGNEE" }), { status: 403 }) as unknown as Response,
    );
    render(<TaskActions taskId="t1" status="pending" assigneeId={null} currentUserId={ME} compact />);
    fireEvent.click(screen.getByRole("button", { name: /Claim/ }));
    await waitFor(() =>
      expect(screen.getAllByText(/claimed by another reviewer/i).length).toBeGreaterThan(0),
    );
  });
});

describe("TaskActions approveBlockedReason — GAP-WORKFLOW-INSTANCES-DETAIL-02", () => {
  beforeEach(() => { refreshMock.mockReset(); vi.restoreAllMocks(); });

  it("renders Approve disabled with the visible reason; Return/Reject stay enabled", () => {
    render(<TaskActions taskId="t1" status="pending" assigneeId={ME} currentUserId={ME} compact approveBlockedReason="2 documents missing" />);
    const approve = screen.getByRole("button", { name: "Approve" });
    expect(approve).toBeDisabled();
    expect(screen.getByText("2 documents missing")).toBeInTheDocument();
    expect(approve).toHaveAccessibleDescription("2 documents missing");
    expect(screen.getByRole("button", { name: "Return" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Reject" })).toBeEnabled();
  });

  it("maps a 409 MANDATORY_DOCUMENTS_MISSING from the server to a plain message", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ code: "MANDATORY_DOCUMENTS_MISSING" }), { status: 409 }) as unknown as Response,
    );
    render(<TaskActions taskId="t1" status="pending" assigneeId={ME} currentUserId={ME} compact />);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    // The confirm dialog's own Approve button is the last one in the document.
    const confirm = screen.getAllByRole("button", { name: "Approve", hidden: true }).at(-1)!;
    fireEvent.click(confirm);
    expect(await screen.findByText(/mandatory documents missing, so it cannot be approved/)).toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
