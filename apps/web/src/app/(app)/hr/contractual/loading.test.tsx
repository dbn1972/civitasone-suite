import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import ContractualLoading from "./loading";

/** GAP-HR-DEPARTMENTS-NEW-05 (sibling treatment): header + shape + localized aria-label, not a bare .skeleton. */
describe("ContractualLoading", () => {
  it("shows the real header and a localized loading label", async () => {
    const ui = await ContractualLoading();
    const { container } = render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
    expect(screen.getByText("Contractual Employees")).toBeInTheDocument();
    expect(container.querySelector("[aria-busy=\"true\"]")?.getAttribute("aria-label")).toBe(enMessages.msg.loading);
  });
});
