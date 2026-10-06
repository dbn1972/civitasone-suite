import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import hiMessages from "@/messages/hi.json";
import { renderWithIntl } from "@/lib/testUtils/intl";
import { UserFacingError } from "@/lib/userFacingError";
import * as cp from "@/lib/crm/campaignPeriods";
import { PostPeriodForm } from "./PostPeriodForm";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/crm/campaignPeriods", async (orig) => {
  const actual = await orig<typeof import("@/lib/crm/campaignPeriods")>();
  return { ...actual, postCampaignPeriod: vi.fn() };
});

beforeEach(() => vi.mocked(cp.postCampaignPeriod).mockReset());

function fill() {
  fireEvent.change(screen.getByLabelText(/^Period start/), { target: { value: "2026-08-01" } });
  fireEvent.click(screen.getByRole("button", { name: "Post period" }));
}

describe("PostPeriodForm", () => {
  it("caps the responses input at the server maximum (100,000,000)", () => {
    renderWithIntl(<PostPeriodForm campaignId="c1" currency="INR" />);
    expect(screen.getByLabelText("Responses")).toHaveAttribute("max", "100000000");
  });

  it("renders in Hindi when the locale is hi", () => {
    render(
      <NextIntlClientProvider locale="hi" messages={hiMessages}>
        <PostPeriodForm campaignId="c1" currency="INR" />
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole("button", { name: "अवधि दर्ज करें" })).toBeInTheDocument();
    expect(screen.getByLabelText("व्यय (INR)")).toBeInTheDocument();
    expect(screen.queryByText("Period start")).not.toBeInTheDocument();
  });

  it("shows the translated success message", async () => {
    vi.mocked(cp.postCampaignPeriod).mockResolvedValue(undefined as never);
    renderWithIntl(<PostPeriodForm campaignId="c1" currency="INR" />);
    fill();
    expect(await screen.findByText(/Period submitted\./)).toBeInTheDocument();
  });

  it("does not show a raw network exception (Failed to fetch)", async () => {
    vi.mocked(cp.postCampaignPeriod).mockRejectedValueOnce(new TypeError("Failed to fetch"));
    renderWithIntl(<PostPeriodForm campaignId="c1" currency="INR" />);
    fill();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent ?? "").not.toMatch(/failed to fetch/i);
    expect((alert.textContent ?? "").trim().length).toBeGreaterThan(0);
  });

  it("keeps a humanised server failure and a field-validation message verbatim", async () => {
    vi.mocked(cp.postCampaignPeriod).mockRejectedValueOnce(new UserFacingError("You do not have permission to post a period."));
    renderWithIntl(<PostPeriodForm campaignId="c1" currency="INR" />);
    fill();
    expect(await screen.findByText("You do not have permission to post a period.")).toBeInTheDocument();

    vi.mocked(cp.postCampaignPeriod).mockRejectedValueOnce(new cp.CampaignPeriodValidationError("Enter a valid period end date."));
    fireEvent.click(screen.getByRole("button", { name: "Post period" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Enter a valid period end date."));
  });
});
