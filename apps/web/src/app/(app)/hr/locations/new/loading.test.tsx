import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import NewLocationLoading from "./loading";

/**
 * GAP-HR-LOCATIONS-NEW-04: this was a bare `.skeleton` div with a
 * hard-coded English aria-label and no header -- same shape test as
 * hr/designations/new/loading.test.tsx (GAP-HR-DESIGNATIONS-NEW-05).
 */
describe("NewLocationLoading", () => {
  it("shows a real translated header, not a bare unlabelled skeleton", async () => {
    const ui = await NewLocationLoading();
    render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);

    expect(screen.getByText("Add Location")).toBeInTheDocument();
    expect(screen.getByText("Register an office, branch, or facility location.")).toBeInTheDocument();
  });
});
