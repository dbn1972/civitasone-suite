import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, fireEvent, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { DeputationActions } from "./DeputationActions";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

const render = (ui: ReactElement) =>
  rtlRender(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);

const fetchMock = vi.fn();

// GAP-HR-DEPUTATION-02: Repatriate / Cancel on an active deputation.
describe("DeputationActions (GAP-HR-DEPUTATION-02)", () => {
  beforeEach(() => {
    refresh.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  const open = (name: string) => {
    fireEvent.click(screen.getByRole("button", { name }));
    return screen.findByRole("alertdialog");
  };

  it("Repatriate asks first, then POSTs to the repatriate route and refreshes the page", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    render(<DeputationActions id="dep-1" employeeLabel="Asha Rao" />);

    const dialog = await open("Repatriate");
    // names the employee and says what will happen; nothing has been sent yet
    expect(within(dialog).getByText(/Asha Rao will be restored to their parent posting/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/proxy/v1/hrms/deputations/dep-1/repatriate");
    expect(init.method).toBe("POST");
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("Cancel POSTs to the cancel route and refreshes the page", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    render(<DeputationActions id="dep-2" employeeLabel="Vikram Nair" />);

    const dialog = await open("Cancel");
    expect(within(dialog).getByText("Cancel this deputation?")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/proxy/v1/hrms/deputations/dep-2/cancel");
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });

  it("backing out of the dialog sends nothing", async () => {
    render(<DeputationActions id="dep-1" employeeLabel="Asha Rao" />);
    const dialog = await open("Repatriate");
    fireEvent.click(within(dialog).getByRole("button", { name: "Go back" }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  });

  it("a 409 (no longer active) is shown inline in the dialog and the page is not refreshed", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ code: "NOT_ACTIVE" }), { status: 409 }));
    render(<DeputationActions id="dep-1" employeeLabel="Asha Rao" />);

    const dialog = await open("Repatriate");
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm" }));

    expect(await within(dialog).findByText("This deputation is no longer active.")).toBeInTheDocument();
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("any other failure shows a generic inline message, never the raw response", async () => {
    fetchMock.mockResolvedValue(new Response("hrms-service: boom", { status: 500 }));
    render(<DeputationActions id="dep-1" employeeLabel="Asha Rao" />);

    const dialog = await open("Repatriate");
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm" }));

    expect(await within(dialog).findByText("Couldn't complete this action. Please try again.")).toBeInTheDocument();
    expect(dialog.textContent).not.toMatch(/hrms-service|boom|500/);
    expect(refresh).not.toHaveBeenCalled();
  });
});
