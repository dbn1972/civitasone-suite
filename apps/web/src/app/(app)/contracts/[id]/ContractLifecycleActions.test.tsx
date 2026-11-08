import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "@/messages/en.json";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

const browserFetch = vi.fn();
vi.mock("@/lib/api/browserClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/browserClient")>("@/lib/api/browserClient");
  return { ...actual, browserFetch: (...a: unknown[]) => browserFetch(...a) };
});

import { ContractLifecycleActions, contractActionsFor, availableContractActions } from "./ContractLifecycleActions";

beforeEach(() => { browserFetch.mockReset(); refresh.mockClear(); });

function renderIt(p: Partial<React.ComponentProps<typeof ContractLifecycleActions>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <ContractLifecycleActions contractId="ct-1" status="pending_approval" roles={["procurement_admin"]} isMaker={false} {...p} />
    </NextIntlClientProvider>,
  );
}

const accepted = () => new Response(JSON.stringify({ id: "ct-1", status: "accepted", correlationId: "c" }), { status: 202 });

describe("ContractLifecycleActions (UAT J10 / D6)", () => {
  it("a checker approves a contract pending approval via POST /v1/contract/contracts/:id/approve", async () => {
    browserFetch.mockResolvedValue(accepted());
    renderIt();
    fireEvent.click(screen.getByRole("button", { name: /^approve contract$/i }));
    fireEvent.click(screen.getByRole("button", { name: /yes, approve/i }));
    await waitFor(() => expect(browserFetch).toHaveBeenCalledTimes(1));
    const [path, init] = browserFetch.mock.calls[0] as [string, RequestInit];
    expect(path).toBe("v1/contract/contracts/ct-1/approve");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({});
    expect(await screen.findByText(/submitted/i)).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
  });

  it("an approved contract offers Activate, which posts to /activate", async () => {
    browserFetch.mockResolvedValue(accepted());
    renderIt({ status: "approved" });
    expect(screen.queryByRole("button", { name: /^approve contract$/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^activate contract$/i }));
    fireEvent.click(screen.getByRole("button", { name: /yes, activate/i }));
    await waitFor(() => expect(browserFetch).toHaveBeenCalledTimes(1));
    expect((browserFetch.mock.calls[0] as [string])[0]).toBe("v1/contract/contracts/ct-1/activate");
  });

  it("the maker is not offered Approve and is told a different officer must approve", () => {
    renderIt({ isMaker: true });
    expect(screen.queryByRole("button", { name: /^approve contract$/i })).toBeNull();
    expect(screen.getByText(/a different officer/i)).toBeInTheDocument();
  });

  it("shows a readable message when the backend refuses the maker (403 SOD_VIOLATION)", async () => {
    browserFetch.mockResolvedValue(new Response(JSON.stringify({ code: "SOD_VIOLATION", message: "x" }), { status: 403, headers: { "content-type": "application/json" } }));
    renderIt();
    fireEvent.click(screen.getByRole("button", { name: /^approve contract$/i }));
    fireEvent.click(screen.getByRole("button", { name: /yes, approve/i }));
    expect(await screen.findByText(/cannot approve or terminate a contract you created/i)).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("renders nothing for a role outside contract-service CONTRACT_ROLES", () => {
    const { container } = renderIt({ roles: ["hr_officer"] });
    expect(container).toBeEmptyDOMElement();
  });
});

describe("contract action rules", () => {
  it("mirror contract-service transitions", () => {
    expect(availableContractActions("draft")).toEqual(["approve", "terminate"]);
    expect(availableContractActions("approved")).toEqual(["activate", "terminate"]);
    expect(availableContractActions("active")).toEqual(["close", "terminate"]);
    expect(availableContractActions("closed")).toEqual([]);
    expect(contractActionsFor("active", ["finance_admin"], true)).toEqual(["close"]);
  });
});

describe("ContractLifecycleActions inline (record header slot, UX-R5)", () => {
  it("renders one primary action plus terminate, without the card", () => {
    renderIt({ inline: true, status: "active" });
    expect(screen.getByRole("button", { name: /close/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /terminate/i })).toBeInTheDocument();
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  });

  it("renders nothing inline on a terminated contract", () => {
    const { container } = renderIt({ inline: true, status: "terminated" });
    expect(container.textContent).toBe("");
  });
});
