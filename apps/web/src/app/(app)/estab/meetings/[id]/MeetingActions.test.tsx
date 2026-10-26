import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl as render } from "@/lib/testUtils/intl";
import { MeetingActions } from "./MeetingActions";

describe("MeetingActions (fix 3)", () => {
  // Owner decision #30: the dead, disabled "Generate MOM" is replaced by a real route to the MOM section.
  it("owner decision #30: no dead Generate MOM button; a Minutes (MOM) link jumps to the MOM section", () => {
    render(<MeetingActions meetingId="m1" />);
    expect(screen.queryByRole("button", { name: /Generate MOM/ })).not.toBeInTheDocument();
    const link = screen.getByRole("link", { name: /Minutes \(MOM\)/ });
    expect(link).toHaveAttribute("href", "#mom");
  });

  it("GAP-ESTAB-MEETINGS-DETAIL-05: no header Agenda link (it duplicated the Agenda tab)", () => {
    render(<MeetingActions meetingId="m1" />);
    // The header Agenda link was removed; the Agenda tab below is the single
    // route to the agenda now.
    expect(screen.queryByRole("link", { name: "Agenda" })).not.toBeInTheDocument();
  });
});
