import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { GrievanceCategoriesEditor } from "./GrievanceCategoriesEditor";
import * as gc from "@/lib/crm/grievanceCategories";

function render(ui: React.ReactElement) {
  return rtlRender(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

vi.mock("@/lib/crm/grievanceCategories", async (orig) => {
  const actual = await orig<typeof import("@/lib/crm/grievanceCategories")>();
  return {
    ...actual,
    getGrievanceCategories: vi.fn(),
    createGrievanceCategory: vi.fn(),
    updateGrievanceCategory: vi.fn(),
    deleteGrievanceCategory: vi.fn(),
  };
});

const row = (over: Partial<gc.GrievanceCategory> = {}): gc.GrievanceCategory => ({
  id: "g1", code: "water_supply", label: "Water Supply", active: true, sortOrder: 1, ...over,
});

beforeEach(() => {
  vi.mocked(gc.getGrievanceCategories).mockReset();
  vi.mocked(gc.createGrievanceCategory).mockReset();
  vi.mocked(gc.updateGrievanceCategory).mockReset();
  vi.mocked(gc.deleteGrievanceCategory).mockReset();
});

describe("GrievanceCategoriesEditor (GAP-CRM-GRIEVANCES-NEW-03)", () => {
  it("shows the unavailable notice on a failed load and never an empty editor", async () => {
    vi.mocked(gc.getGrievanceCategories).mockResolvedValue({ data: [], source: "error" });
    render(<GrievanceCategoriesEditor />);
    await waitFor(() => expect(screen.getByText(/categories unavailable/i)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /add category/i })).not.toBeInTheDocument();
  });

  it("renders a configured category with its label and active state", async () => {
    vi.mocked(gc.getGrievanceCategories).mockResolvedValue({ data: [row()], source: "api" });
    render(<GrievanceCategoriesEditor />);
    expect(await screen.findByDisplayValue("Water Supply")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Active$/i)).toBeChecked();
  });

  it("empty state when none configured, and Add enables Save only with a valid row", async () => {
    vi.mocked(gc.getGrievanceCategories).mockResolvedValue({ data: [], source: "api" });
    render(<GrievanceCategoriesEditor />);
    await waitFor(() => expect(screen.getByText(/no categories yet/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /add category/i }));
    const saveBtn = screen.getByRole("button", { name: /^Save$/i });
    expect(saveBtn).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/category code/i), { target: { value: "sanitation" } });
    expect(saveBtn).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/category label/i), { target: { value: "Sanitation" } });
    expect(saveBtn).not.toBeDisabled();
  });

  it("creates a new category via the API and reloads", async () => {
    vi.mocked(gc.getGrievanceCategories)
      .mockResolvedValueOnce({ data: [], source: "api" })
      .mockResolvedValueOnce({ data: [row({ id: "g2", code: "sanitation", label: "Sanitation" })], source: "api" });
    vi.mocked(gc.createGrievanceCategory).mockResolvedValue();
    render(<GrievanceCategoriesEditor />);
    await waitFor(() => expect(screen.getByText(/no categories yet/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /add category/i }));
    fireEvent.change(screen.getByLabelText(/category code/i), { target: { value: "sanitation" } });
    fireEvent.change(screen.getByLabelText(/category label/i), { target: { value: "Sanitation" } });
    fireEvent.click(screen.getByRole("button", { name: /^Save$/i }));
    await waitFor(() =>
      expect(vi.mocked(gc.createGrievanceCategory)).toHaveBeenCalledWith(
        expect.objectContaining({ code: "sanitation", label: "Sanitation" }),
      ),
    );
  });
});

describe("GrievanceCategoriesEditor stale read after 202 (rows must not vanish, revert or reappear)", () => {
  it("keeps a just-created row visible while the server read is still stale, and confirms once it lands", async () => {
    const created = { id: "n1", code: "stale_probe", label: "Stale Probe", active: true, sortOrder: 0 };
    const get = vi.mocked(gc.getGrievanceCategories);
    get.mockResolvedValueOnce({ data: [], source: "api" }); // initial load
    get.mockResolvedValueOnce({ data: [], source: "api" }); // stale read right after the 202
    get.mockResolvedValue({ data: [created], source: "api" }); // consumer has committed
    vi.mocked(gc.createGrievanceCategory).mockResolvedValue(undefined);
    render(<GrievanceCategoriesEditor retryDelaysMs={[0, 0, 0]} />);
    await screen.findByRole("button", { name: /add category/i });
    fireEvent.click(screen.getByRole("button", { name: /add category/i }));
    fireEvent.change(screen.getByLabelText(/category code/i), { target: { value: "stale_probe" } });
    fireEvent.change(screen.getByLabelText(/category label/i), { target: { value: "Stale Probe" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    // While stale: the row is still on screen and the banner says submitted, not saved.
    await waitFor(() => expect(screen.getByDisplayValue("Stale Probe")).toBeInTheDocument());
    // Once the server reflects it, the banner confirms.
    await waitFor(() => expect(screen.getByText(/Stale Probe.*saved/i)).toBeInTheDocument());
    expect(screen.getByDisplayValue("Stale Probe")).toBeInTheDocument();
  });

  it("says Submitted — applying (never saved) while the server has not caught up", async () => {
    const get = vi.mocked(gc.getGrievanceCategories);
    get.mockResolvedValue({ data: [], source: "api" });
    vi.mocked(gc.createGrievanceCategory).mockResolvedValue(undefined);
    render(<GrievanceCategoriesEditor retryDelaysMs={[0]} />);
    await screen.findByRole("button", { name: /add category/i });
    fireEvent.click(screen.getByRole("button", { name: /add category/i }));
    fireEvent.change(screen.getByLabelText(/category code/i), { target: { value: "never_lands" } });
    fireEvent.change(screen.getByLabelText(/category label/i), { target: { value: "Never Lands" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(await screen.findByText(/Submitted — applying/i)).toBeInTheDocument();
    await waitFor(() => expect(get.mock.calls.length).toBeGreaterThan(2));
    // Never reported as saved, even after it gives up (an unconfirmed message is shown instead).
    expect(screen.queryByText(/Never Lands.*saved/i)).not.toBeInTheDocument();
  });

  it("does not resurrect a deleted row from a stale read", async () => {
    const r = { id: "g9", code: "gone", label: "Gone Cat", active: true, sortOrder: 0 };
    const get = vi.mocked(gc.getGrievanceCategories);
    get.mockResolvedValueOnce({ data: [r], source: "api" });
    get.mockResolvedValueOnce({ data: [r], source: "api" }); // stale after delete
    get.mockResolvedValue({ data: [], source: "api" });
    vi.mocked(gc.deleteGrievanceCategory).mockResolvedValue(undefined);
    render(<GrievanceCategoriesEditor retryDelaysMs={[0, 0, 0]} />);
    const del = await screen.findByRole("button", { name: /^delete$/i });
    fireEvent.click(del);
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /^delete$/i }));
    await waitFor(() => expect(screen.getByText(/deleted/i)).toBeInTheDocument());
    expect(screen.queryByDisplayValue("Gone Cat")).not.toBeInTheDocument();
  });
});

describe("GrievanceCategoriesEditor gives up politely", () => {
  it("expires the phantom row and says it could not confirm when the server never catches up", async () => {
    const get = vi.mocked(gc.getGrievanceCategories);
    get.mockResolvedValue({ data: [], source: "api" });
    vi.mocked(gc.createGrievanceCategory).mockResolvedValue(undefined);
    render(<GrievanceCategoriesEditor retryDelaysMs={[0, 0]} />);
    await screen.findByRole("button", { name: /add category/i });
    fireEvent.click(screen.getByRole("button", { name: /add category/i }));
    fireEvent.change(screen.getByLabelText(/category code/i), { target: { value: "phantom" } });
    fireEvent.change(screen.getByLabelText(/category label/i), { target: { value: "Phantom Row" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(await screen.findByText(/couldn.t confirm .Phantom Row. was applied/i)).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Phantom Row")).not.toBeInTheDocument();
    expect(screen.queryByText(/Phantom Row.*saved/i)).not.toBeInTheDocument();
  });

  it("stops polling after unmount", async () => {
    const get = vi.mocked(gc.getGrievanceCategories);
    get.mockResolvedValue({ data: [], source: "api" });
    vi.mocked(gc.createGrievanceCategory).mockResolvedValue(undefined);
    const { unmount } = render(<GrievanceCategoriesEditor retryDelaysMs={[30, 30, 30, 30]} />);
    await screen.findByRole("button", { name: /add category/i });
    fireEvent.click(screen.getByRole("button", { name: /add category/i }));
    fireEvent.change(screen.getByLabelText(/category code/i), { target: { value: "bye" } });
    fireEvent.change(screen.getByLabelText(/category label/i), { target: { value: "Bye Row" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(vi.mocked(gc.createGrievanceCategory)).toHaveBeenCalled());
    unmount();
    const callsAtUnmount = get.mock.calls.length;
    await new Promise((r) => setTimeout(r, 200));
    expect(get.mock.calls.length).toBeLessThanOrEqual(callsAtUnmount + 1);
  });
});
