import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { DuplicateCheckPanel } from "./DuplicateCheckPanel";
import { normaliseCandidates, type DuplicateCandidate } from "@/lib/crm/dataQuality";
import { REAL_DUPLICATE_CHECK_RESPONSE, DUP_CONTACT_ASHA, DUP_CONTACT_MEERA } from "@/lib/crm/testFixtures/duplicateCheckResponse";

// `score` is a whole percent 0-100, the scale normaliseCandidates produces from crm-service's answer.
const cands: DuplicateCandidate[] = [
  { id: "1", matchedFields: ["email", "phone"], score: 92, name: "Asha Rao", email: "asha@x.in", company: "Acme" },
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

  it("shows a source=error affordance when the check itself failed (finding 5)", () => {
    render(<DuplicateCheckPanel candidates={[]} error />);
    expect(screen.getByText(/duplicate check unavailable/i)).toBeInTheDocument();
    expect(screen.getByText(/couldn.t load/i)).toBeInTheDocument();
  });

  it("prefers the checking message over the error affordance while a check is in flight", () => {
    render(<DuplicateCheckPanel candidates={[]} error checking />);
    expect(screen.getByText(/checking for possible duplicates/i)).toBeInTheDocument();
    expect(screen.queryByText(/duplicate check unavailable/i)).not.toBeInTheDocument();
  });

  // The EXACT shape crm-service answers with (see testFixtures/duplicateCheckResponse.ts): { id, name, matchedFields,
  // score 0-100 } and nothing else. It used to render "Match 7000% on email, phone" and, without a name, the UUID.
  describe("fed with the real server shape", () => {
    const real = normaliseCandidates(REAL_DUPLICATE_CHECK_RESPONSE);

    it("shows the name, a correctly scaled score, and no empty detail line", () => {
      const { container } = render(<DuplicateCheckPanel candidates={real} mergeHrefBase="/crm/contacts/" />);
      expect(screen.getByRole("link", { name: "Asha Rao" })).toHaveAttribute("href", `/crm/contacts/${DUP_CONTACT_ASHA}`);
      expect(screen.getByText("Match 70% on email, phone")).toBeInTheDocument();
      expect(screen.getByText("Match 30% on phone")).toBeInTheDocument();
      expect(container.textContent).not.toMatch(/\d{3,}%/);
      // No "—" placeholder row for values the server never sends.
      expect(container.textContent).not.toContain("—");
    });

    it("never shows a record id: a match without a name reads 'Existing contact'", () => {
      const nameless = normaliseCandidates({ data: [{ id: DUP_CONTACT_MEERA, matchedFields: ["phone"], score: 30 }] });
      const { container } = render(<DuplicateCheckPanel candidates={nameless} mergeHrefBase="/crm/contacts/" />);
      expect(screen.getByRole("link", { name: "Existing contact" })).toHaveAttribute("href", `/crm/contacts/${DUP_CONTACT_MEERA}`);
      expect(container.textContent).not.toContain(DUP_CONTACT_MEERA);
      cleanup();
      const { container: plain } = render(<DuplicateCheckPanel candidates={nameless} />);
      expect(plain.textContent).toContain("Existing contact");
      expect(plain.textContent).not.toContain(DUP_CONTACT_MEERA);
    });
  });
});
