import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { ContractActions } from "./ContractActions";

const fetchMock = vi.fn();
function renderIt(over: Partial<React.ComponentProps<typeof ContractActions>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <ContractActions contractId="c1" status="active" version={3} currentEndDate="2026-12-31" roles={["hr_admin"]} {...over} />
    </NextIntlClientProvider>,
  );
}

describe("ContractActions (GAP-HR-CONTRACTUAL-05)", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    refresh.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("renders nothing for a manager on an expired contract", () => {
    const { container } = renderIt({ status: "expired", roles: ["manager"] });
    expect(container).toBeEmptyDOMElement();
  });

  it("manager sees Renew but not Terminate", () => {
    renderIt({ roles: ["manager"] });
    expect(screen.getByRole("button", { name: "Renew" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Terminate" })).not.toBeInTheDocument();
  });

  it("rejects a new end date that is not after the current end without POSTing", async () => {
    renderIt();
    fireEvent.click(screen.getByRole("button", { name: "Renew" }));
    fireEvent.change(document.querySelector("input[type=date]") as HTMLInputElement, { target: { value: "2026-01-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit renewal" }));
    expect(await screen.findByText(/must be after the current end date/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("POSTs the renewal body and shows submitted", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 202 }));
    renderIt();
    fireEvent.click(screen.getByRole("button", { name: "Renew" }));
    fireEvent.change(document.querySelector("input[type=date]") as HTMLInputElement, { target: { value: "2027-06-30" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit renewal" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/proxy/v1/hrms/contracts/c1/renew");
    expect(JSON.parse(init.body)).toEqual({ newEndDate: "2027-06-30" });
    expect(await screen.findByText("Renewal submitted for approval.")).toBeInTheDocument();
  });

  it("maps 409 RENEWAL_IN_PROGRESS to a plain message", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ code: "RENEWAL_IN_PROGRESS", message: "raw" }), { status: 409 }));
    renderIt();
    fireEvent.click(screen.getByRole("button", { name: "Renew" }));
    fireEvent.change(document.querySelector("input[type=date]") as HTMLInputElement, { target: { value: "2027-06-30" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit renewal" }));
    expect(await screen.findByText("A renewal is already in progress for this contract.")).toBeInTheDocument();
  });

  it("terminate requires a reason and sends version + reason", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 202 }));
    renderIt();
    fireEvent.click(screen.getByRole("button", { name: "Terminate" }));
    const confirm = screen.getByRole("button", { name: "Terminate contract" });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Misconduct" } });
    fireEvent.click(confirm);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ version: 3, reason: "Misconduct" });
  });
});
