import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
}));

const getDak = vi.fn();
vi.mock("../../_data/loaders", () => ({ getDak: (id: string) => getDak(id) }));

import DakDetailPage from "./page";

const UUID = "11111111-2222-4333-8444-555555555555";

describe("DakDetailPage", () => {
  beforeEach(() => getDak.mockReset());

  it("renders the dak with Acknowledge/Forward actions on success", async () => {
    getDak.mockResolvedValue({ data: { id: UUID, subject: "Tax file", priority: "urgent", status: "pending", assignedTo: null, dueDate: "2026-10-01", createdAt: "2026-09-01T00:00:00Z", body: "Please review." }, source: "api", status: 200 });
    render(await DakDetailPage({ params: { id: UUID } }));
    expect(screen.getByRole("heading", { name: "Tax file" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Acknowledge" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Forward" })).toBeInTheDocument();
    expect(screen.getByText("Please review.")).toBeInTheDocument();
  });

  it("INBOX-01: a real 404 renders the not-found page", async () => {
    getDak.mockResolvedValue({ data: null, source: "error", status: 404 });
    await expect(DakDetailPage({ params: { id: UUID } })).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("a non-404 failure shows a retry state, not a 404", async () => {
    getDak.mockResolvedValue({ data: null, source: "error", status: 500 });
    render(await DakDetailPage({ params: { id: UUID } }));
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });
});
