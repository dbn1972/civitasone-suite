import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MergeButton } from "./MergeButton";

vi.mock("@/lib/crm/dataQuality", async (orig) => {
  const actual = await orig<typeof import("@/lib/crm/dataQuality")>();
  return { ...actual, mergeEntities: vi.fn() };
});

const opts = [
  { id: "a", label: "Asha" },
  { id: "b", label: "Asha R" },
];

describe("MergeButton", () => {
  it("toggles the merge dialog open and closed", () => {
    render(<MergeButton entity="contacts" options={opts} />);
    const btn = screen.getByRole("button", { name: /merge duplicates/i });
    expect(btn).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(btn);
    expect(btn).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/merge duplicate contacts/i)).toBeInTheDocument();
  });

  it("respects a custom label", () => {
    render(<MergeButton entity="accounts" options={opts} label="Merge duplicate accounts" />);
    expect(screen.getByRole("button", { name: /merge duplicate accounts/i })).toBeInTheDocument();
  });
});
