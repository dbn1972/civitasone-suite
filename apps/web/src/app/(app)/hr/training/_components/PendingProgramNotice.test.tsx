import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { PendingProgramNotice } from "./PendingProgramNotice";

describe("PendingProgramNotice (GAP-HR-TRAINING-NEW-01)", () => {
  beforeEach(() => refreshMock.mockReset());

  it("says the submission is still being processed, never that it was created", () => {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <PendingProgramNotice />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText(/still being processed/i)).toBeInTheDocument();
    expect(screen.queryByText(/created successfully/i)).not.toBeInTheDocument();
  });

  it("Refresh now re-reads the page data through the router", () => {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <PendingProgramNotice />
      </NextIntlClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /refresh now/i }));
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("is translated for the Hindi locale", () => {
    render(
      <NextIntlClientProvider locale="hi" messages={hiMessages}>
        <PendingProgramNotice />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText(hiMessages.training.pendingProgramMessage)).toBeInTheDocument();
  });
});
