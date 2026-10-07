import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const pushMock = vi.fn();
const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

const toastSuccess = vi.fn();
vi.mock("@/app/_components/ds/Toast", () => ({
  useToast: () => ({ toast: { success: toastSuccess } }),
}));

import { RaiseRequestForm } from "./RaiseRequestForm";

describe("RaiseRequestForm (GAP-HELPDESK-CATALOGUE-DETAIL-02/03/05)", () => {
  const schema = [{ key: "summary", label: "Summary", type: "text" as const, required: true }];

  beforeEach(() => {
    vi.restoreAllMocks();
    pushMock.mockReset();
    refreshMock.mockReset();
    toastSuccess.mockReset();
  });

  it("requires a critical reason when priority is Critical (DETAIL-02)", async () => {
    render(<RaiseRequestForm offeringId="o1" schema={schema} defaultPriority="Medium" />);
    fireEvent.change(screen.getByLabelText(/summary/i), { target: { value: "Need access" } });
    fireEvent.change(screen.getByLabelText(/priority/i), { target: { value: "Critical" } });
    // The "Why is this critical?" field should appear
    expect(screen.getByLabelText(/why is this critical/i)).toBeInTheDocument();
    // Submit without filling reason -> shows error
    fireEvent.click(screen.getByRole("button", { name: "Submit request" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/critical/i);
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("shows a success toast with reference on successful POST (DETAIL-03)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { id: "aaaabbbb-cccc-1111-2222-333344445555" } }), { status: 201 }),
    );
    render(<RaiseRequestForm offeringId="o1" schema={schema} defaultPriority="Medium" />);
    fireEvent.change(screen.getByLabelText(/summary/i), { target: { value: "Need access" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit request" }));
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/helpdesk/catalogue/my-requests"));
    expect(toastSuccess).toHaveBeenCalledTimes(1);
    expect(toastSuccess.mock.calls[0][0]).toContain("AAAABBBB");
  });

  it("shows inline error and no toast on failed POST (DETAIL-03)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ code: "VALIDATION_FAILED" }), { status: 400 }),
    );
    render(<RaiseRequestForm offeringId="o1" schema={schema} defaultPriority="Medium" />);
    fireEvent.change(screen.getByLabelText(/summary/i), { target: { value: "Need access" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit request" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("renders no hard-coded #fff or #b91c1c colours (DETAIL-05)", () => {
    const { container } = render(<RaiseRequestForm offeringId="o1" schema={schema} defaultPriority="Medium" />);
    const html = container.innerHTML;
    expect(html).not.toContain("#fff");
    expect(html).not.toContain("#b91c1c");
    expect(html).not.toContain("#047857");
  });

  it("shows priority helper text linked with aria-describedby (DETAIL-02)", () => {
    render(<RaiseRequestForm offeringId="o1" schema={schema} defaultPriority="Medium" />);
    const select = screen.getByLabelText(/priority/i);
    const descId = select.getAttribute("aria-describedby");
    expect(descId).toBeTruthy();
    expect(document.getElementById(descId!)).toHaveTextContent(/affects how quickly/i);
  });
});
