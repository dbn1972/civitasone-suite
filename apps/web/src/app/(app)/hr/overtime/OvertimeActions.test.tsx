import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render as rtlRender, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";
import { ToastProvider } from "@/app/_components/ds";
import { OvertimeActions } from "./OvertimeActions";

const { refreshMock } = vi.hoisted(() => ({ refreshMock: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn(), refresh: refreshMock }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
}));

function render(ui: React.ReactElement, opts: { locale?: "en" | "hi"; toast?: boolean } = {}) {
  const messages = opts.locale === "hi" ? hiMessages : enMessages;
  const body = opts.toast ? <ToastProvider>{ui}</ToastProvider> : ui;
  return rtlRender(<NextIntlClientProvider locale={opts.locale ?? "en"} messages={messages}>{body}</NextIntlClientProvider>);
}

const dialog = () => screen.getByRole("alertdialog");
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

describe("OvertimeActions (GAP-HR-OVERTIME-01)", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    refreshMock.mockClear();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("Approve asks for confirmation, PATCHes /approve, says the decision is being applied, and refreshes", async () => {
    fetchMock.mockResolvedValue(json(202, { id: "o1", status: "approved" }));
    render(<OvertimeActions id="o1" />);

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(fetchMock).not.toHaveBeenCalled(); // nothing is sent until the dialog is confirmed
    fireEvent.click(within(dialog()).getByRole("button", { name: "Approve" }));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Decision recorded. It is being applied"));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/proxy/v1/hrms/overtime-requests/o1/approve",
      expect.objectContaining({ method: "PATCH", body: "{}" }),
    );
    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("Reject requires a reason and sends it in the body", async () => {
    fetchMock.mockResolvedValue(json(202, { id: "o1", status: "rejected" }));
    render(<OvertimeActions id="o1" />);

    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    const confirm = within(dialog()).getByRole("button", { name: "Reject" });
    expect(confirm).toBeDisabled(); // no reason yet
    fireEvent.click(confirm);
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.change(within(dialog()).getByLabelText("Reason for rejection"), { target: { value: "  Not pre-approved  " } });
    expect(within(dialog()).getByRole("button", { name: "Reject" })).toBeEnabled();
    fireEvent.click(within(dialog()).getByRole("button", { name: "Reject" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/proxy/v1/hrms/overtime-requests/o1/reject",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ reason: "Not pre-approved" }) }),
    );
    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
  });

  it("caps the rejection reason at the backend's 500 characters", () => {
    render(<OvertimeActions id="o1" />);
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    expect(within(dialog()).getByLabelText("Reason for rejection")).toHaveAttribute("maxlength", "500");
  });

  it("approving a request someone else already decided (404) says so in plain words and refreshes the list", async () => {
    fetchMock.mockResolvedValue(json(404, { error: "Overtime request not found or already decided" }));
    render(<OvertimeActions id="o1" />);

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    fireEvent.click(within(dialog()).getByRole("button", { name: "Approve" }));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("already decided by someone else"));
    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    // not the generic "we could not find this object" copy, and no raw server text
    expect(screen.queryByText(/could not find/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/not found or already decided/i)).not.toBeInTheDocument();
  });

  it("rejecting an already-decided request (404) behaves the same", async () => {
    fetchMock.mockResolvedValue(json(404, { error: "Overtime request not found or already decided" }));
    render(<OvertimeActions id="o1" />);
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    fireEvent.change(within(dialog()).getByLabelText("Reason for rejection"), { target: { value: "late" } });
    fireEvent.click(within(dialog()).getByRole("button", { name: "Reject" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("already decided by someone else"));
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("uses the global toast when one is mounted (the decided row unmounts on refresh)", async () => {
    fetchMock.mockResolvedValue(json(404, { error: "x" }));
    render(<OvertimeActions id="o1" />, { toast: true });
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    fireEvent.click(within(dialog()).getByRole("button", { name: "Approve" }));
    // the toast carries the message, so the row does not also render a duplicate status line
    expect(await screen.findByText(/already decided by someone else/)).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("a self-approval refusal (403) stays in the dialog as a clerk-safe error and does not refresh", async () => {
    fetchMock.mockResolvedValue(json(403, { code: "FORBIDDEN", message: "you may not approve an overtime request you created yourself" }));
    render(<OvertimeActions id="o1" />);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    fireEvent.click(within(dialog()).getByRole("button", { name: "Approve" }));

    await waitFor(() => expect(within(dialog()).getByRole("alert")).not.toBeEmptyDOMElement());
    expect(refreshMock).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(within(dialog()).getByRole("alert")).not.toHaveTextContent("you created yourself");
  });

  it("a network failure stays in the dialog and does not refresh", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<OvertimeActions id="o1" />);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    fireEvent.click(within(dialog()).getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(within(dialog()).getByRole("alert")).not.toBeEmptyDOMElement());
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("renders its labels in Hindi", () => {
    render(<OvertimeActions id="o1" />, { locale: "hi" });
    expect(screen.getByRole("button", { name: "स्वीकृत करें" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "अस्वीकृत करें" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "अस्वीकृत करें" }));
    expect(within(dialog()).getByLabelText("अस्वीकृति का कारण")).toBeInTheDocument();
  });

  it("makes no payroll-disbursement claim in the confirmation text", () => {
    render(<OvertimeActions id="o1" />);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(dialog()).not.toHaveTextContent(/payroll/i);
  });
});
