import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import NewDesignationLoading from "./loading";

/**
 * GAP-HR-DESIGNATIONS-NEW-05: this was a bare `.skeleton` div with a
 * hard-coded English aria-label and no header -- distinct from
 * GAP-HR-EMPLOYEES-NEW-05 (the Step2 Grade/Group item), despite the
 * similar id suffix.
 */
describe("NewDesignationLoading", () => {
  it("shows a real translated header, not a bare unlabelled skeleton", async () => {
    const ui = await NewDesignationLoading();
    render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);

    expect(screen.getByText("Add Designation")).toBeInTheDocument();
    expect(screen.getByText("Add a new job title or pay level to use across your office.")).toBeInTheDocument();
  });
});
