import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import NewDepartmentLoading from "./loading";

/**
 * GAP-HR-DEPARTMENTS-NEW-05: this was a bare `.skeleton` div with a
 * hard-coded English aria-label and no header -- same shape test as
 * hr/designations/new/loading.test.tsx (GAP-HR-DESIGNATIONS-NEW-05).
 */
describe("NewDepartmentLoading", () => {
  it("shows a real translated header, not a bare unlabelled skeleton", async () => {
    const ui = await NewDepartmentLoading();
    render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);

    expect(screen.getByText("Add Department")).toBeInTheDocument();
    expect(screen.getByText("Create a new department for your office.")).toBeInTheDocument();
  });
});
