import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { PolicyActions } from "./PolicyActions";

describe("PolicyActions (maker-checker UI)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("GAP-DETAIL-02: author viewing own under_review doc sees Approve disabled", () => {
    render(
      <PolicyActions
        policyId="p1"
        status="under_review"
        authorId="me"
        currentUserId="me"
        alreadyAcknowledged={false}
        isAdmin={false}
      />,
    );
    const approve = screen.getByRole("button", { name: "Approve" });
    expect(approve).toBeDisabled();
  });

  it("GAP-DETAIL-02: a different approver sees Approve enabled", () => {
    render(
      <PolicyActions
        policyId="p1"
        status="under_review"
        authorId="author"
        currentUserId="approver"
        alreadyAcknowledged={false}
        isAdmin={false}
      />,
    );
    const approve = screen.getByRole("button", { name: "Approve" });
    expect(approve).not.toBeDisabled();
  });

  it("GAP-DETAIL-04: admin reviewer sees a 'Return for changes' action", () => {
    render(
      <PolicyActions
        policyId="p1"
        status="under_review"
        authorId="author"
        currentUserId="approver"
        alreadyAcknowledged={false}
        isAdmin={true}
      />,
    );
    expect(screen.getByRole("button", { name: "Return for changes" })).toBeInTheDocument();
  });

  it("GAP-DETAIL-03: publish stage offers a review-cycle select", () => {
    render(
      <PolicyActions
        policyId="p1"
        status="approved"
        authorId="author"
        currentUserId="approver"
        alreadyAcknowledged={false}
        isAdmin={true}
      />,
    );
    const select = screen.getByLabelText(/Review cycle/i);
    expect(select).toBeInTheDocument();
    // default 12 months
    expect((select as HTMLSelectElement).value).toBe("12");
  });

  it("GAP-DETAIL-02: author cannot publish own approved doc (disabled)", () => {
    render(
      <PolicyActions
        policyId="p1"
        status="approved"
        authorId="me"
        currentUserId="me"
        alreadyAcknowledged={false}
        isAdmin={true}
      />,
    );
    expect(screen.getByRole("button", { name: "Publish" })).toBeDisabled();
  });

  it("GAP-DETAIL-05: already-acknowledged published doc shows note not button", () => {
    render(
      <PolicyActions
        policyId="p1"
        status="published"
        authorId="author"
        currentUserId="emp"
        alreadyAcknowledged={true}
        isAdmin={false}
      />,
    );
    expect(screen.getByText(/You have acknowledged this document/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /I have read/ })).not.toBeInTheDocument();
  });
});
