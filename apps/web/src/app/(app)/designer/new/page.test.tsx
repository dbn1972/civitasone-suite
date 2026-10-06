import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import PatternPickerPage from "./page";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
}));

const createMock = vi.fn();
const waitMock = vi.fn();
vi.mock("../_data/designerApi", async () => {
  const actual = await vi.importActual<typeof import("../_data/designerApi")>("../_data/designerApi");
  return {
    ...actual,
    createServiceDefinition: (...args: unknown[]) => createMock(...args),
    waitForServiceDefinition: (...args: unknown[]) => waitMock(...args),
  };
});

describe("designer/new PatternPickerPage", () => {
  beforeEach(() => {
    createMock.mockReset();
    waitMock.mockReset();
    pushMock.mockReset();
  });
  afterEach(() => vi.clearAllMocks());

  function selectPattern() {
    // GAP-DESIGNER-NEW-02: pattern cards expose radio semantics.
    const radios = screen.getAllByRole("radio");
    expect(radios.length).toBeGreaterThan(0);
    fireEvent.click(radios[0]);
  }

  // GAP-DESIGNER-NEW-01: placeholder no longer claims pre-fill.
  it("owning office placeholder does not claim pre-fill", () => {
    render(<PatternPickerPage />);
    selectPattern();
    const office = screen.getByPlaceholderText("Owning office (optional)");
    expect(office).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Pre-filled from your office/)).not.toBeInTheDocument();
  });

  // GAP-DESIGNER-NEW-02: pattern cards are radios inside a radiogroup, with a non-colour cue.
  it("pattern cards are a radiogroup; selected card gets aria-checked and a Selected cue", () => {
    render(<PatternPickerPage />);
    expect(screen.getByRole("radiogroup", { name: "Service pattern" })).toBeInTheDocument();
    const radios = screen.getAllByRole("radio");
    fireEvent.click(radios[0]);
    expect(radios[0]).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText(/Selected/)).toBeInTheDocument();
  });

  // GAP-DESIGNER-NEW-05: channels default shown before Create.
  it("shows the default Portal channel in the details card", () => {
    render(<PatternPickerPage />);
    selectPattern();
    expect(screen.getByText(/Channels:/)).toBeInTheDocument();
    expect(screen.getByText(/Portal \(change later in B1\)/)).toBeInTheDocument();
  });

  // GAP-DESIGNER-NEW-03: service key preview visible before Create.
  it("shows a service key preview once the name is long enough", () => {
    render(<PatternPickerPage />);
    selectPattern();
    const name = screen.getByPlaceholderText("e.g. Trade License Renewal");
    fireEvent.change(name, { target: { value: "Trade License Renewal" } });
    expect(screen.getByText(/Service key:/)).toBeInTheDocument();
    expect(screen.getByText(/trade-license-renewal/)).toBeInTheDocument();
  });

  // GAP-DESIGNER-NEW-04: empty/whitespace name yields an error, no API call.
  it("blocks submit with a validation message when the name is too short", async () => {
    render(<PatternPickerPage />);
    selectPattern();
    const name = screen.getByPlaceholderText("e.g. Trade License Renewal");
    fireEvent.change(name, { target: { value: "ab" } });
    fireEvent.click(screen.getByRole("button", { name: /Create draft/ }));

    await waitFor(() =>
      expect(screen.getByText(/at least 3 characters/i)).toBeInTheDocument(),
    );
    expect(createMock).not.toHaveBeenCalled();
  });

  // GAP-DESIGNER-NEW-04: valid name calls createServiceDefinition once.
  it("submits once with a valid name", async () => {
    createMock.mockResolvedValue("def-1");
    waitMock.mockResolvedValue({ id: "def-1" });
    render(<PatternPickerPage />);
    selectPattern();
    const name = screen.getByPlaceholderText("e.g. Trade License Renewal");
    fireEvent.change(name, { target: { value: "Trade License Renewal" } });
    fireEvent.click(screen.getByRole("button", { name: /Create draft/ }));

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Trade License Renewal", channels: ["portal"] }),
    );
  });
});
