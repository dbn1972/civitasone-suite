import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render as rtlRender, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { MaskedReveal } from "./MaskedReveal";

function render(ui: React.ReactElement) {
  return rtlRender(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
}

const props = {
  maskedText: "******3210",
  resourceType: "grievance" as const,
  resourceId: "8cf7f7eb-1de6-4a31-b48c-1f598ecf33c0",
  field: "citizenPhone",
  label: "citizen phone",
};

// jsdom lacks sessionStorage device helpers used by browserFetch — provide a stub.
beforeEach(() => {
  vi.restoreAllMocks();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("MaskedReveal (F1-05 audited reveal)", () => {
  it("asks for a reason first, then calls the audited reveal endpoint once and shows the clear value", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ data: { value: "9876543210" } }), { status: 200 }));
    render(<MaskedReveal {...props} />);
    // masked value shown; nothing fetched yet
    expect(screen.getByText("******3210")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reveal" }));
    expect(fetchMock).not.toHaveBeenCalled();

    const reason = await screen.findByLabelText(/Reason for revealing/i);
    fireEvent.change(reason, { target: { value: "citizen chased their case" } }); // >=10
    const confirm = screen.getAllByRole("button", { name: "Reveal" }).pop()!;
    fireEvent.click(confirm);

    expect(await screen.findByText("9876543210")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/proxy/v1/crm/pii/reveal");
    expect(JSON.parse(init.body as string)).toEqual({
      resourceType: "grievance",
      resourceId: props.resourceId,
      field: "citizenPhone",
      reason: "citizen chased their case",
    });
    expect(screen.getByRole("button", { name: "Hide" })).toHaveAttribute("aria-pressed", "true");
  });

  it("does not accept a reason shorter than 10 characters", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    render(<MaskedReveal {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Reveal" }));
    fireEvent.change(await screen.findByLabelText(/Reason for revealing/i), { target: { value: "too short" } }); // 9 chars
    const confirm = screen.getAllByRole("button", { name: "Reveal" }).pop()!;
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a refused reveal (403) shows a plain message and never the clear value", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ code: "FORBIDDEN" }), { status: 403 }),
    );
    const { container } = render(<MaskedReveal {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Reveal" }));
    fireEvent.change(await screen.findByLabelText(/Reason for revealing/i), { target: { value: "reconciliation work" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Reveal" }).pop()!);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).not.toMatch(/FORBIDDEN|403/);
    expect(container.textContent).not.toContain("9876543210");
    expect(screen.getByText("******3210")).toBeInTheDocument();
  });

  it("re-masks itself after the timeout", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { value: "9876543210" } }), { status: 200 }),
    );
    render(<MaskedReveal {...props} autoHideMs={50} />);
    fireEvent.click(screen.getByRole("button", { name: "Reveal" }));
    fireEvent.change(await screen.findByLabelText(/Reason for revealing/i), { target: { value: "reconciliation work" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Reveal" }).pop()!);
    await screen.findByText("9876543210");
    await waitFor(() => expect(screen.queryByText("9876543210")).not.toBeInTheDocument(), { timeout: 1500 });
    expect(screen.getByText("******3210")).toBeInTheDocument();
  });
});
