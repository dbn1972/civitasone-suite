import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import Loading from "./loading";

// GAP-RECRUITMENT-NEW-07
describe("New vacancy loading state", () => {
  it("uses the same heading, subtitle and back link as the loaded page, with no stale loading* keys", async () => {
    const ui = await Loading();
    render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
    expect(screen.getByRole("heading", { name: enMessages.recruitmentNewJob.pageTitle })).toBeInTheDocument();
    expect(screen.getByText(enMessages.recruitmentNewJob.pageSubtitle)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /back to recruitment/i })).toHaveAttribute("href", "/hr/recruitment");
    expect(enMessages.recruitmentNewJob).not.toHaveProperty("loadingHeading");
    expect(enMessages.recruitmentNewJob).not.toHaveProperty("loadingSubtitle");
  });
});
