import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const browserJsonMock = vi.fn();
vi.mock("@/lib/api/browserClient", () => ({
  browserJson: (...args: unknown[]) => browserJsonMock(...args),
}));
const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { QuarterCreateForm } from "./QuarterCreateForm";

describe("QuarterCreateForm", () => {
  beforeEach(() => {
    browserJsonMock.mockReset();
    refreshMock.mockReset();
  });

  it("submits a new quarter on confirm (happy path)", async () => {
    browserJsonMock.mockResolvedValue({ status: "accepted" });
    render(<QuarterCreateForm />);

    fireEvent.change(screen.getByLabelText(/Quarter No\./), { target: { value: "B-14" } });
    fireEvent.click(screen.getByRole("button", { name: "Add Quarter" }));
    fireEvent.click(await screen.findByRole("button", { name: "Add quarter" }));

    await waitFor(() => expect(browserJsonMock).toHaveBeenCalledWith(
      "v1/estab/quarters",
      expect.objectContaining({ method: "POST" }),
    ));
    expect(await screen.findByText(/submitted to the inventory/)).toBeInTheDocument();
  });

  it("blocks submission and shows a field error when quarter number is missing", () => {
    render(<QuarterCreateForm />);
    fireEvent.click(screen.getByRole("button", { name: "Add Quarter" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Enter the quarter number.");
    expect(browserJsonMock).not.toHaveBeenCalled();
  });

  it("surfaces the server error code in the confirm dialog on failure", async () => {
    browserJsonMock.mockRejectedValue(new Error("VALIDATION: quarterNo already exists"));
    render(<QuarterCreateForm />);

    fireEvent.change(screen.getByLabelText(/Quarter No\./), { target: { value: "B-14" } });
    fireEvent.click(screen.getByRole("button", { name: "Add Quarter" }));
    fireEvent.click(await screen.findByRole("button", { name: "Add quarter" }));

    expect(await screen.findByText("VALIDATION: quarterNo already exists")).toBeInTheDocument();
  });
});
