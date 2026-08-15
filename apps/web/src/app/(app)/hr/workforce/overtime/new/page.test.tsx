import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

import OvertimeNewPage from "./page";

describe("OvertimeNewPage", () => {
  it("renders page heading", () => {
    render(<OvertimeNewPage />);
    expect(screen.getByRole("heading", { name: /new overtime claim/i })).toBeInTheDocument();
  });

  it("renders CCS Rules reference in subtitle", () => {
    render(<OvertimeNewPage />);
    expect(screen.getByText(/CCS Rules/i)).toBeInTheDocument();
  });

  it("embeds the OvertimeClaimForm", () => {
    render(<OvertimeNewPage />);
    expect(screen.getByRole("form", { name: /overtime claim form/i })).toBeInTheDocument();
  });

  it("shows policy note inside form", () => {
    render(<OvertimeNewPage />);
    expect(screen.getByRole("note")).toBeInTheDocument();
  });

  it("shows submit and cancel buttons", () => {
    render(<OvertimeNewPage />);
    expect(screen.getByRole("button", { name: /submit claim/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
  });
});
