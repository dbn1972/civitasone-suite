import { describe, it, expect } from "vitest";
import { renderWithIntl } from "@/lib/testUtils/intl";
import { screen } from "@testing-library/react";
import Loading from "./loading";

// GAP-CRM-VOICE-OF-CUSTOMER-FEEDBACK-06 (COPY): the loading skeleton heading
// must match the module name "Voice of Citizen" — it previously read the
// odd-cased "Voice Of Customer", so the heading flickered on navigation.
describe("Voice of Citizen loading (GAP-CRM-VOICE-OF-CUSTOMER-FEEDBACK-06)", () => {
  it("heads the skeleton 'Voice of Citizen', not 'Voice Of Customer'", () => {
    renderWithIntl(<Loading />);
    expect(screen.getByRole("heading", { name: "Voice of Citizen" })).toBeInTheDocument();
    expect(screen.queryByText(/voice of customer/i)).not.toBeInTheDocument();
  });
});
