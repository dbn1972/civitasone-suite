import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { ServiceTypesEditor } from "./ServiceTypesEditor";
import * as st from "@/lib/crm/serviceTypes";

function render(ui: React.ReactElement) {
  return rtlRender(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

vi.mock("@/lib/crm/serviceTypes", async (orig) => {
  const actual = await orig<typeof import("@/lib/crm/serviceTypes")>();
  return {
    ...actual,
    getServiceTypes: vi.fn(),
    createServiceType: vi.fn(),
    updateServiceType: vi.fn(),
    deleteServiceType: vi.fn(),
  };
});

const row = (over: Partial<st.ServiceType> = {}): st.ServiceType => ({
  id: "s1", code: "ration_card", label: "Ration Card", active: true, sortOrder: 2, ...over,
});

beforeEach(() => {
  vi.mocked(st.getServiceTypes).mockReset();
  vi.mocked(st.createServiceType).mockReset();
  vi.mocked(st.updateServiceType).mockReset();
  vi.mocked(st.deleteServiceType).mockReset();
});

describe("ServiceTypesEditor (GAP-CRM-SERVICE-REQUESTS-NEW-02)", () => {
  it("shows the unavailable notice on a failed load and never an empty editor", async () => {
    vi.mocked(st.getServiceTypes).mockResolvedValue({ data: [], source: "error" });
    render(<ServiceTypesEditor />);
    await waitFor(() => expect(screen.getByText(/service types unavailable/i)).toBeInTheDocument());
    // No Add control is offered on an errored load.
    expect(screen.queryByRole("button", { name: /add service type/i })).not.toBeInTheDocument();
  });

  it("renders a configured type with its label and active state", async () => {
    vi.mocked(st.getServiceTypes).mockResolvedValue({ data: [row()], source: "api" });
    render(<ServiceTypesEditor />);
    expect(await screen.findByDisplayValue("Ration Card")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Active$/i)).toBeChecked();
  });

  it("empty state when a tenant has configured none, and Add enables Save only with a valid row", async () => {
    vi.mocked(st.getServiceTypes).mockResolvedValue({ data: [], source: "api" });
    render(<ServiceTypesEditor />);
    await waitFor(() => expect(screen.getByText(/no service types yet/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /add service type/i }));
    const saveBtn = screen.getByRole("button", { name: /^Save$/i });
    expect(saveBtn).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/service type code/i), { target: { value: "trade_licence" } });
    expect(saveBtn).toBeDisabled(); // still no label
    fireEvent.change(screen.getByLabelText(/service type label/i), { target: { value: "Trade Licence" } });
    expect(saveBtn).not.toBeDisabled();
  });

  it("creates a new type via the API and reloads", async () => {
    vi.mocked(st.getServiceTypes)
      .mockResolvedValueOnce({ data: [], source: "api" })
      .mockResolvedValueOnce({ data: [row({ id: "s2", code: "trade_licence", label: "Trade Licence" })], source: "api" });
    vi.mocked(st.createServiceType).mockResolvedValue();
    render(<ServiceTypesEditor />);
    await waitFor(() => expect(screen.getByText(/no service types yet/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /add service type/i }));
    fireEvent.change(screen.getByLabelText(/service type code/i), { target: { value: "trade_licence" } });
    fireEvent.change(screen.getByLabelText(/service type label/i), { target: { value: "Trade Licence" } });
    fireEvent.click(screen.getByRole("button", { name: /^Save$/i }));
    await waitFor(() =>
      expect(vi.mocked(st.createServiceType)).toHaveBeenCalledWith(
        expect.objectContaining({ code: "trade_licence", label: "Trade Licence" }),
      ),
    );
  });
});

describe("ServiceTypesEditor stale read after 202 (rows must not vanish, revert or reappear)", () => {
  it("keeps a just-created row visible while the server read is still stale, and confirms once it lands", async () => {
    const created = { id: "n1", code: "stale_probe", label: "Stale Probe", active: true, sortOrder: 0 };
    const get = vi.mocked(st.getServiceTypes);
    get.mockResolvedValueOnce({ data: [], source: "api" }); // initial load
    get.mockResolvedValueOnce({ data: [], source: "api" }); // stale read right after the 202
    get.mockResolvedValue({ data: [created], source: "api" }); // consumer has committed
    vi.mocked(st.createServiceType).mockResolvedValue(undefined);
    render(<ServiceTypesEditor retryDelaysMs={[0, 0, 0]} />);
    await screen.findByRole("button", { name: /add service type/i });
    fireEvent.click(screen.getByRole("button", { name: /add service type/i }));
    fireEvent.change(screen.getByLabelText(/service type code/i), { target: { value: "stale_probe" } });
    fireEvent.change(screen.getByLabelText(/service type label/i), { target: { value: "Stale Probe" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    // While stale: the row is still on screen and the banner says submitted, not saved.
    await waitFor(() => expect(screen.getByDisplayValue("Stale Probe")).toBeInTheDocument());
    // Once the server reflects it, the banner confirms.
    await waitFor(() => expect(screen.getByText(/Stale Probe.*saved/i)).toBeInTheDocument());
    expect(screen.getByDisplayValue("Stale Probe")).toBeInTheDocument();
  });

  it("says Submitted — applying (never saved) while the server has not caught up", async () => {
    const get = vi.mocked(st.getServiceTypes);
    get.mockResolvedValue({ data: [], source: "api" });
    vi.mocked(st.createServiceType).mockResolvedValue(undefined);
    render(<ServiceTypesEditor retryDelaysMs={[0]} />);
    await screen.findByRole("button", { name: /add service type/i });
    fireEvent.click(screen.getByRole("button", { name: /add service type/i }));
    fireEvent.change(screen.getByLabelText(/service type code/i), { target: { value: "never_lands" } });
    fireEvent.change(screen.getByLabelText(/service type label/i), { target: { value: "Never Lands" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(await screen.findByText(/Submitted — applying/i)).toBeInTheDocument();
    await waitFor(() => expect(get.mock.calls.length).toBeGreaterThan(2));
    // Never reported as saved, even after it gives up (an unconfirmed message is shown instead).
    expect(screen.queryByText(/Never Lands.*saved/i)).not.toBeInTheDocument();
  });

  it("does not resurrect a deleted row from a stale read", async () => {
    const r = { id: "s9", code: "gone", label: "Gone Type", active: true, sortOrder: 0 };
    const get = vi.mocked(st.getServiceTypes);
    get.mockResolvedValueOnce({ data: [r], source: "api" });
    get.mockResolvedValueOnce({ data: [r], source: "api" }); // stale after delete
    get.mockResolvedValue({ data: [], source: "api" });
    vi.mocked(st.deleteServiceType).mockResolvedValue(undefined);
    render(<ServiceTypesEditor retryDelaysMs={[0, 0, 0]} />);
    const del = await screen.findByRole("button", { name: /^delete$/i });
    fireEvent.click(del);
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /^delete$/i }));
    await waitFor(() => expect(screen.getByText(/deleted/i)).toBeInTheDocument());
    expect(screen.queryByDisplayValue("Gone Type")).not.toBeInTheDocument();
  });
});

describe("ServiceTypesEditor gives up politely", () => {
  it("expires the phantom row and says it could not confirm when the server never catches up", async () => {
    const get = vi.mocked(st.getServiceTypes);
    get.mockResolvedValue({ data: [], source: "api" });
    vi.mocked(st.createServiceType).mockResolvedValue(undefined);
    render(<ServiceTypesEditor retryDelaysMs={[0, 0]} />);
    await screen.findByRole("button", { name: /add service type/i });
    fireEvent.click(screen.getByRole("button", { name: /add service type/i }));
    fireEvent.change(screen.getByLabelText(/service type code/i), { target: { value: "phantom" } });
    fireEvent.change(screen.getByLabelText(/service type label/i), { target: { value: "Phantom Row" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(await screen.findByText(/couldn.t confirm .Phantom Row. was applied/i)).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Phantom Row")).not.toBeInTheDocument();
    expect(screen.queryByText(/Phantom Row.*saved/i)).not.toBeInTheDocument();
  });

  it("stops polling after unmount", async () => {
    const get = vi.mocked(st.getServiceTypes);
    get.mockResolvedValue({ data: [], source: "api" });
    vi.mocked(st.createServiceType).mockResolvedValue(undefined);
    const { unmount } = render(<ServiceTypesEditor retryDelaysMs={[30, 30, 30, 30]} />);
    await screen.findByRole("button", { name: /add service type/i });
    fireEvent.click(screen.getByRole("button", { name: /add service type/i }));
    fireEvent.change(screen.getByLabelText(/service type code/i), { target: { value: "bye" } });
    fireEvent.change(screen.getByLabelText(/service type label/i), { target: { value: "Bye Row" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(vi.mocked(st.createServiceType)).toHaveBeenCalled());
    unmount();
    const callsAtUnmount = get.mock.calls.length;
    await new Promise((r) => setTimeout(r, 200));
    expect(get.mock.calls.length).toBeLessThanOrEqual(callsAtUnmount + 1);
  });
});
