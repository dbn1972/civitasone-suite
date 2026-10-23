import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { ShiftChangeRequestForm } from "./ShiftChangeRequestForm";

// CLOS2-S2-06: the effective-date min is today in IST, not the UTC date.
describe("ShiftChangeRequestForm effective-date min (IST)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));
    vi.useFakeTimers({ toFake: ["Date"] });
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("at 02:00 IST min is the IST date, not yesterday (UTC)", () => {
    vi.setSystemTime(new Date("2026-10-22T20:30:00Z"));
    render(<NextIntlClientProvider locale="en" messages={enMessages}><ShiftChangeRequestForm /></NextIntlClientProvider>);
    expect(screen.getByLabelText(/effective date/i)).toHaveAttribute("min", "2026-10-23");
  });
});
