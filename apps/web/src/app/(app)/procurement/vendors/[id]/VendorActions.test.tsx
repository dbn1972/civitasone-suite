/**
 * CLOS2-S3-05: a bare-fetch network failure in empanel() must show the
 * catalogued "failed" copy, not the browser's raw "Failed to fetch".
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("next-intl", async (orig) => {
  const actual = await orig<typeof import("next-intl")>();
  const messages = (await import("@/messages/en.json")).default;
  return { ...actual, useTranslations: (ns?: string) => actual.createTranslator({ locale: "en", messages, namespace: ns as never }) };
});

import { VendorActions } from "./VendorActions";
import en from "@/messages/en.json";

const FAILED = (en as { procurement: { w2: { vendorActions: { failed: string } } } }).procurement.w2.vendorActions.failed;

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("VendorActions empanel (CLOS2-S3-05)", () => {
  it("shows the catalogued failure copy, not 'Failed to fetch', when the network is down", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    render(<VendorActions vendorId="v-1" empanelmentStatus="not_empanelled" canManage />);

    fireEvent.click(screen.getByRole("button", { name: "Empanel" }));
    const dialog = screen.getByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Empanel" }));

    await waitFor(() => {
      expect(within(screen.getByRole("alertdialog")).getByText(FAILED)).toBeInTheDocument();
    });
    expect(screen.queryByText(/Failed to fetch/)).not.toBeInTheDocument();
  });
});
