import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render as rtlRender, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactElement } from "react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: refreshMock }) }));

import { ToastProvider } from "@/app/_components/ds";
import { FeatureFlagsManager } from "./FeatureFlagsManager";
import type { AdminFeatureFlagRow } from "@/app/_data/loaders";

const render = (ui: ReactElement) => rtlRender(<ToastProvider>{ui}</ToastProvider>);

const FLAG = {
  id: "11111111-1111-4000-8000-000000000001",
  key: "new_checkout",
  name: "New Checkout",
  description: "",
  enabled: true,
  rolloutPercent: 100,
  targetSegments: [],
  killSwitch: false,
  owner: "payments-team",
} as unknown as AdminFeatureFlagRow;

const PARTIAL = { ...FLAG, id: "22222222-1111-4000-8000-000000000002", key: "beta_ui", name: "Beta UI", rolloutPercent: 10, targetSegments: ["beta"], owner: "" } as AdminFeatureFlagRow;

// GAP-ADMIN-FEATURE-FLAGS-01
describe("FeatureFlagsManager kill switch", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: [{ ...FLAG, killSwitch: true }] }), { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("clicking Kill opens a confirmation and sends nothing", () => {
    render(<FeatureFlagsManager initialFlags={[FLAG]} source="api" />);
    fireEvent.click(screen.getByRole("button", { name: "Kill switch for New Checkout" }));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByText("Kill switch: New Checkout")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Confirm stays disabled until a reason is typed, then POSTs once with the reason", async () => {
    render(<FeatureFlagsManager initialFlags={[FLAG]} source="api" />);
    fireEvent.click(screen.getByRole("button", { name: "Kill switch for New Checkout" }));
    const confirm = screen.getByRole("button", { name: "Kill flag" });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Reason for killing this flag/), { target: { value: "INC-9 checkout failures" } });
    expect(confirm).not.toBeDisabled();
    fireEvent.click(confirm);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const kills = fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/kill"));
    expect(kills).toHaveLength(1);
    expect(kills[0][1].method).toBe("POST");
    expect(JSON.parse(kills[0][1].body)).toEqual({ reason: "INC-9 checkout failures" });
  });

  it("Cancel closes the dialog and leaves the flag untouched", () => {
    render(<FeatureFlagsManager initialFlags={[FLAG]} source="api" />);
    fireEvent.click(screen.getByRole("button", { name: "Kill switch for New Checkout" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Kill switch for New Checkout" })).not.toBeDisabled();
  });
});

// GAP-ADMIN-FEATURE-FLAGS-03
describe("FeatureFlagsManager load failure", () => {
  beforeEach(() => { refreshMock.mockReset(); });

  it("source 'error': alert with Retry, no empty-registry text, no Create button, no zero cards", () => {
    render(<FeatureFlagsManager initialFlags={[]} source="error" />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText(/No feature flags/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Create Flag/ })).not.toBeInTheDocument();
    expect(screen.queryByText("Total Flags")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("source 'api' with no flags shows the empty message and an enabled Create button", () => {
    render(<FeatureFlagsManager initialFlags={[]} source="api" />);
    expect(screen.getByText("No feature flags configured yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Create Flag/ })).not.toBeDisabled();
  });

  it("a failed client refresh after a toggle surfaces an error instead of silently keeping stale rows", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === "PUT" ? new Response("{}", { status: 202 }) : new Response("{}", { status: 500 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<FeatureFlagsManager initialFlags={[FLAG]} source="api" />);
    fireEvent.click(screen.getByRole("switch", { name: "Toggle New Checkout" }));
    fireEvent.click(screen.getByRole("button", { name: "Disable flag" }));
    expect((await screen.findAllByRole("alert"))[0]).toHaveTextContent(/couldn't load/i);
    vi.unstubAllGlobals();
  });
});

// GAP-ADMIN-FEATURE-FLAGS-04
describe("FeatureFlagsManager edit", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (_u: string, init?: RequestInit) =>
      init?.method === "PUT" ? new Response("{}", { status: 202 }) : new Response(JSON.stringify({ data: [PARTIAL] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("shows an Owner column with the value or an em dash", () => {
    render(<FeatureFlagsManager initialFlags={[FLAG, PARTIAL]} source="api" />);
    expect(screen.getByRole("columnheader", { name: /Owner/ })).toBeInTheDocument();
    expect(screen.getByText("payments-team")).toBeInTheDocument();
  });

  it("a rollout DECREASE sends PUT directly with rolloutPercent", async () => {
    render(<FeatureFlagsManager initialFlags={[PARTIAL]} source="api" />);
    fireEvent.click(screen.getByRole("button", { name: "Edit Beta UI" }));
    fireEvent.change(screen.getByLabelText(/Rollout Percent/), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([, i]) => i?.method === "PUT")).toBe(true));
    const put = fetchMock.mock.calls.find(([, i]) => i?.method === "PUT")!;
    expect(String(put[0])).toContain(`/manage/${PARTIAL.id}`);
    expect(JSON.parse(put[1].body)).toMatchObject({ rolloutPercent: 5, name: "Beta UI", targetSegments: ["beta"] });
  });

  it("a rollout INCREASE (10 -> 50) needs an explicit confirmation before the PUT", async () => {
    render(<FeatureFlagsManager initialFlags={[PARTIAL]} source="api" />);
    fireEvent.click(screen.getByRole("button", { name: "Edit Beta UI" }));
    fireEvent.change(screen.getByLabelText(/Rollout Percent/), { target: { value: "50" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("from 10% to 50%");
    expect(fetchMock.mock.calls.some(([, i]) => i?.method === "PUT")).toBe(false);
    fireEvent.click(within(dialog).getByRole("button", { name: "Apply rollout change" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([, i]) => i?.method === "PUT")).toBe(true));
    expect(JSON.parse(fetchMock.mock.calls.find(([, i]) => i?.method === "PUT")![1].body).rolloutPercent).toBe(50);
  });

  it("rejects an out-of-range rollout client-side without a request", () => {
    render(<FeatureFlagsManager initialFlags={[PARTIAL]} source="api" />);
    fireEvent.click(screen.getByRole("button", { name: "Edit Beta UI" }));
    fireEvent.change(screen.getByLabelText(/Rollout Percent/), { target: { value: "150" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText(/whole number from 0 to 100/)).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([, i]) => i?.method === "PUT")).toBe(false);
  });

  it("killed flags cannot be edited", () => {
    render(<FeatureFlagsManager initialFlags={[{ ...PARTIAL, killSwitch: true }]} source="api" />);
    expect(screen.getByRole("button", { name: "Edit Beta UI" })).toBeDisabled();
  });
});

describe("FeatureFlagsManager enable toggle", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("toggling asks first; nothing is sent until confirmed, and Cancel sends nothing", async () => {
    const fetchMock = vi.fn(async (_u: string, init?: RequestInit) =>
      init?.method === "PUT" ? new Response("{}", { status: 202 }) : new Response(JSON.stringify({ data: [FLAG] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<FeatureFlagsManager initialFlags={[FLAG]} source="api" />);
    fireEvent.click(screen.getByRole("switch", { name: "Toggle New Checkout" }));
    expect(screen.getByRole("alertdialog")).toHaveTextContent("Disable New Checkout?");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("switch", { name: "Toggle New Checkout" }));
    fireEvent.click(screen.getByRole("button", { name: "Disable flag" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([, i]) => i?.method === "PUT")).toBe(true));
    expect(JSON.parse(String(fetchMock.mock.calls.find(([, i]) => i?.method === "PUT")![1]!.body))).toEqual({ enabled: false });
  });
});

// GAP-ADMIN-FEATURE-FLAGS-05
describe("FeatureFlagsManager table", () => {
  it("is a DataTable: the filter box narrows flags by name/key", () => {
    render(<FeatureFlagsManager initialFlags={[FLAG, PARTIAL]} source="api" />);
    fireEvent.change(screen.getByPlaceholderText(/Search flags/), { target: { value: "beta" } });
    expect(screen.queryByText("New Checkout")).not.toBeInTheDocument();
    expect(screen.getByText("Beta UI")).toBeInTheDocument();
  });

  it("toggle is a labelled switch with a visible On/Off text", () => {
    render(<FeatureFlagsManager initialFlags={[FLAG]} source="api" />);
    expect(screen.getByRole("switch", { name: "Toggle New Checkout" })).toBeChecked();
    expect(screen.getByText("On")).toBeInTheDocument();
  });

  it("no inline hex colour is left in the component", () => {
    const src = readFileSync(join(__dirname, "FeatureFlagsManager.tsx"), "utf8");
    // the kill button used to override the DS danger style with inline colours
    expect(src).not.toMatch(/#(dc2626|ccc|fff|b42318|666|fef2f2|fecaca)\b/i);
  });
});

// GAP-ADMIN-FEATURE-FLAGS-06
describe("FeatureFlagsManager create dialog", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (_u: string, init?: RequestInit) =>
      init?.method === "POST" ? new Response("{}", { status: 202 }) : new Response(JSON.stringify({ data: [FLAG] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("focus starts inside the dialog, Escape closes it and focus returns to the trigger", () => {
    render(<FeatureFlagsManager initialFlags={[FLAG]} source="api" />);
    const trigger = screen.getByRole("button", { name: /Create Flag/ });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Create Feature Flag" });
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("a successful create shows a toast naming the flag", async () => {
    render(<FeatureFlagsManager initialFlags={[FLAG]} source="api" />);
    fireEvent.click(screen.getByRole("button", { name: /Create Flag/ }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Dark Mode" } });
    fireEvent.change(screen.getByLabelText("Key"), { target: { value: "dark-mode" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Flag created: Dark Mode")).toBeInTheDocument();
    const post = fetchMock.mock.calls.find(([, i]) => i?.method === "POST")!;
    expect(JSON.parse(post[1].body)).toMatchObject({ key: "dark-mode", name: "Dark Mode", enabled: false, rolloutPercent: 0 });
  });
});
