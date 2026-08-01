import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { EcrGeneratorForm } from "./EcrGeneratorForm";

describe("EcrGeneratorForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("requires a month before opening the confirm dialog", () => {
    render(<EcrGeneratorForm />);
    fireEvent.click(screen.getByRole("button", { name: "Generate ECR" }));
    expect(screen.getByText("Month is required in YYYY-MM format.")).toBeInTheDocument();
  });

  it("generates the ECR file on confirm (happy path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("UAN|NAME|1|1|1|1|1|1|1|0|0", { status: 200, headers: { "content-type": "text/plain" } }),
    );
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:mock");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});

    render(<EcrGeneratorForm />);
    fireEvent.change(screen.getByLabelText(/^Period/), { target: { value: "2026-06" } });
    fireEvent.click(screen.getByRole("button", { name: "Generate ECR" }));

    await waitFor(() => expect(screen.getByText("Generate EPFO ECR file?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Confirm & Download"));

    await waitFor(() => {
      expect(screen.getByText(/ECR file generated for 2026-06\./)).toBeInTheDocument();
    });
  });

  it("surfaces a server error on the confirm dialog (error path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 404 }));

    render(<EcrGeneratorForm />);
    fireEvent.change(screen.getByLabelText(/^Period/), { target: { value: "2026-06" } });
    fireEvent.click(screen.getByRole("button", { name: "Generate ECR" }));

    await waitFor(() => expect(screen.getByText("Generate EPFO ECR file?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Confirm & Download"));

    await waitFor(() => {
      expect(screen.getByText(/API_ERROR: 404/)).toBeInTheDocument();
    });
  });
});
