import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, fireEvent, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

function render(ui: ReactElement) {
  return rtlRender(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock, push: vi.fn() }) }));

const browserFetchMock = vi.fn();
vi.mock("@/lib/api/browserClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/browserClient")>("@/lib/api/browserClient");
  return { ...actual, browserFetch: (...args: unknown[]) => browserFetchMock(...args) };
});

// F5-01: the OwnerPicker searches the CRM agent directory; stub it so the form
// renders without hitting the network.
vi.mock("@/lib/crm/assignment", () => ({
  getAgents: vi.fn(async () => ({
    data: [{ agentId: "agent-7", name: "Asha Rao", activeLeads: 0, maxLeads: 10, available: true, onLeave: false }],
    source: "api",
  })),
}));

import { NewAccountForm } from "./NewAccountForm";
import type { CRMAccountSummary } from "@civitasone/types";

function makeRes(ok: boolean, status: number, body: unknown): Response {
  return { ok, status, json: async () => body, clone: () => makeRes(ok, status, body) } as unknown as Response;
}

const accounts = [
  { id: "p1", name: "Parent Dept", industry: "", website: "", contactCount: 0, parentId: undefined },
] as unknown as CRMAccountSummary[];

function openAndFill(name = "New Dept", parent = "") {
  fireEvent.click(screen.getByRole("button", { name: "New Account" }));
  fireEvent.change(screen.getByLabelText("Account name"), { target: { value: name } });
  if (parent) fireEvent.change(screen.getByLabelText("Reports to"), { target: { value: parent } });
}

describe("NewAccountForm", () => {
  beforeEach(() => {
    refreshMock.mockReset();
    browserFetchMock.mockReset();
  });

  // GAP-CRM-ACCOUNTS-04
  it("sends an x-idempotency-key header on the create POST", async () => {
    browserFetchMock.mockResolvedValue(makeRes(true, 202, { id: "a1" }));
    render(<NewAccountForm accounts={accounts} />);
    openAndFill("New Dept");
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() => expect(browserFetchMock).toHaveBeenCalled());
    const post = browserFetchMock.mock.calls.find((c) => c[0] === "v1/crm/accounts");
    expect(post).toBeDefined();
    const headers = (post![1] as { headers?: Record<string, string> }).headers ?? {};
    expect(typeof headers["x-idempotency-key"]).toBe("string");
    expect(headers["x-idempotency-key"].length).toBeGreaterThan(0);
  });

  // GAP-CRM-ACCOUNTS-04: invalid website blocks submit, POST not called.
  it("blocks submit on an invalid website and does not POST", async () => {
    render(<NewAccountForm accounts={accounts} />);
    openAndFill("New Dept");
    fireEvent.change(screen.getByLabelText("Website"), { target: { value: "javascript:alert(1)" } });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    expect(screen.getByText(/valid web address/i)).toBeInTheDocument();
    expect(browserFetchMock).not.toHaveBeenCalled();
  });

  // GAP-CRM-ACCOUNTS-03: PATCH 500 -> amber warning + Retry; form values cleared.
  it("shows a warning and Retry when the parent PATCH fails", async () => {
    browserFetchMock
      .mockResolvedValueOnce(makeRes(true, 202, { id: "a1" })) // POST
      .mockResolvedValueOnce(makeRes(false, 500, {})); // PATCH parent
    render(<NewAccountForm accounts={accounts} />);
    openAndFill("New Dept", "p1");
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() => expect(screen.getByText(/parent could not be set/i)).toBeInTheDocument());
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(/parent/i);
    expect(screen.getByRole("button", { name: "Retry setting parent" })).toBeInTheDocument();
    // The form was reset + closed, so the name field is gone (no re-create path).
    expect(screen.queryByLabelText("Account name")).not.toBeInTheDocument();
  });

  // GAP-CRM-ACCOUNTS-03: Retry re-sends ONLY the PATCH (no second POST).
  it("Retry re-sends only the parent PATCH with the created id", async () => {
    browserFetchMock
      .mockResolvedValueOnce(makeRes(true, 202, { id: "a1" })) // POST
      .mockResolvedValueOnce(makeRes(false, 500, {})) // PATCH fails
      .mockResolvedValueOnce(makeRes(true, 202, {})); // PATCH retry ok
    render(<NewAccountForm accounts={accounts} />);
    openAndFill("New Dept", "p1");
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Retry setting parent" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Retry setting parent" }));
    await waitFor(() => expect(screen.getByText(/Account created\./i)).toBeInTheDocument());

    const posts = browserFetchMock.mock.calls.filter((c) => c[0] === "v1/crm/accounts");
    const patches = browserFetchMock.mock.calls.filter((c) => c[0] === "v1/crm/accounts/a1/parent");
    expect(posts).toHaveLength(1); // only one POST ever
    expect(patches).toHaveLength(2); // original + retry
  });

  // GAP-CRM-ACCOUNTS-03: a 202 with no id + a parent chosen is a warning, not a plain success.
  it("warns (not plain success) when the 202 body has no id but a parent was chosen", async () => {
    browserFetchMock.mockResolvedValueOnce(makeRes(true, 202, {})); // POST, no id
    render(<NewAccountForm accounts={accounts} />);
    openAndFill("New Dept", "p1");
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByText(/could not be set yet/i)).toBeInTheDocument();
    // No parent PATCH attempted (no id to target).
    expect(browserFetchMock.mock.calls.some((c) => String(c[0]).includes("/parent"))).toBe(false);
  });

  // GAP-CRM-ACCOUNTS-04: duplicate name warning before the request.
  it("warns about a duplicate name before submitting", () => {
    render(<NewAccountForm accounts={accounts} />);
    openAndFill("Parent Dept");
    expect(screen.getByText(/already exists/i)).toBeInTheDocument();
  });

  // F5-01: the form exposes an Owner picker, and a create with no owner chosen
  // sends ownerId undefined (never a fabricated/raw UUID).
  it("renders an Owner field and omits ownerId when none is chosen", async () => {
    browserFetchMock.mockResolvedValue(makeRes(true, 202, { id: "a1" }));
    render(<NewAccountForm accounts={accounts} />);
    openAndFill("New Dept");
    expect(screen.getByLabelText("Account owner")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() => expect(browserFetchMock).toHaveBeenCalled());
    const post = browserFetchMock.mock.calls.find((c) => c[0] === "v1/crm/accounts");
    const body = JSON.parse((post![1] as { body: string }).body) as { ownerId?: string };
    expect(body.ownerId).toBeUndefined();
  });
});
