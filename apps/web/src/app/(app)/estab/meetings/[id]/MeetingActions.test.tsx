import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MeetingActions } from "./MeetingActions";

describe("MeetingActions (fix 3)", () => {
  it("disables Generate MOM instead of linking to the nonexistent /generate-mom route", () => {
    render(<MeetingActions meetingId="m1" />);
    const btn = screen.getByRole("button", { name: /Generate MOM/ });
    expect(btn).toBeDisabled();
  });

  it("GAP-ESTAB-MEETINGS-DETAIL-05: no header Agenda link (it duplicated the Agenda tab)", () => {
    render(<MeetingActions meetingId="m1" />);
    // The header Agenda link was removed; the Agenda tab below is the single
    // route to the agenda now.
    expect(screen.queryByRole("link", { name: "Agenda" })).not.toBeInTheDocument();
  });
});
