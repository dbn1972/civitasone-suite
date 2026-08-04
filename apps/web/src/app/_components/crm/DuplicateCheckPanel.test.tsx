import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DuplicateCheckPanel } from "./DuplicateCheckPanel";
import type { DuplicateCandidate } from "@/lib/crm/dataQuality";

const cands: DuplicateCandidate[] = [
  { id: "1", matchedFields: ["email", "phone"], score: 0.92, name: "Asha Rao", email: "asha@x.in", company: "Acme" },
];

describe("DuplicateCheckPanel (DQ-001)", () => {
  it("shows a checking message while a check is in flight", () => {
    render(<DuplicateCheckPanel candidates={[]} checking />);
    expect(screen.getByText(/checking for possible duplicates/i)).toBeInTheDocument();
  });

  it("renders nothing when there are no candidates and not checking", () => {
    const { container } = render(<DuplicateCheckPanel candidates={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("lists candidates with match score and matched fields", () => {
    render(<DuplicateCheckPanel candidates={cands} />);
    expect(screen.getByText(/potential duplicates found/i)).toBeInTheDocument();
    expect(screen.getByText(/Match 92% on email, phone/i)).toBeInTheDocument();
    expect(screen.getByText("Asha Rao")).toBeInTheDocument();
  });

  it("fires onMerge and onContinueAnyway", () => {
    const onMerge = vi.fn();
    const onContinue = vi.fn();
    render(<DuplicateCheckPanel candidates={cands} onMerge={onMerge} onContinueAnyway={onContinue} />);
    fireEvent.click(screen.getByRole("button", { name: /merge instead/i }));
    expect(onMerge).toHaveBeenCalledWith(cands[0]);
    fireEvent.click(screen.getByRole("button", { name: /continue anyway/i }));
    expect(onContinue).toHaveBeenCalled();
  });

  it("links candidate name when mergeHrefBase is set", () => {
    render(<DuplicateCheckPanel candidates={cands} mergeHrefBase="/crm/contacts/" />);
    expect(screen.getByRole("link", { name: "Asha Rao" })).toHaveAttribute("href", "/crm/contacts/1");
  });
});
