import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import EditContactForm from "./EditContactForm";
import * as lq from "@/lib/crm/leadQualification";

vi.mock("@/lib/crm/leadQualification", async (orig) => {
  const actual = await orig<typeof import("@/lib/crm/leadQualification")>();
  return { ...actual, saveClassification: vi.fn() };
});

const fetchMock = vi.fn();

beforeEach(() => {
  vi.mocked(lq.saveClassification).mockReset().mockResolvedValue(undefined);
  fetchMock.mockReset().mockResolvedValue({ ok: true, text: async () => "" });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const params = { id: "c1" };

describe("EditContactForm classification (LQ-003)", () => {
  it("sends explicit null when a previously-set field is cleared via the '—' option", async () => {
    render(
      <EditContactForm
        params={params}
        initial={{ name: "Asha", temperature: "hot", priority: "high", segment: "Enterprise" }}
      />,
    );
    // Clear temperature via the empty option; leave priority as-is.
    fireEvent.change(screen.getByLabelText("Temperature"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(lq.saveClassification).toHaveBeenCalled());
    const patch = vi.mocked(lq.saveClassification).mock.calls[0][1];
    expect(patch.temperature).toBeNull();          // cleared → null (not omitted)
    expect(patch.priority).toBe("high");           // untouched selection preserved
    expect(patch.segment).toBe("Enterprise");
    expect(patch.expectedValueMinor).toBeNull();    // empty money field → null
  });

  it("converts an entered rupee expected value to paise", async () => {
    render(<EditContactForm params={params} initial={{ name: "Asha" }} />);
    fireEvent.change(screen.getByLabelText(/expected value/i), { target: { value: "1500.50" } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() => expect(lq.saveClassification).toHaveBeenCalled());
    expect(vi.mocked(lq.saveClassification).mock.calls[0][1].expectedValueMinor).toBe("150050");
  });

  it("blocks save with an inline error on an invalid expected value", async () => {
    render(<EditContactForm params={params} initial={{ name: "Asha" }} />);
    fireEvent.change(screen.getByLabelText(/expected value/i), { target: { value: "1.005" } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
    expect(await screen.findByText(/positive amount in rupees/i)).toBeInTheDocument();
    expect(lq.saveClassification).not.toHaveBeenCalled();
  });
});
