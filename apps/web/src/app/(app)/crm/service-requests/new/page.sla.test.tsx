import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@/test-utils/intl-render";

/**
 * F6-03 — the SR new form shows a derived target date when a service type with
 * an SLA is picked, and the user can still override it.
 */
const pushMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock, refresh: vi.fn() }) }));

vi.mock("@/lib/crm/serviceTypes", async (orig) => {
  const actual = await orig<typeof import("@/lib/crm/serviceTypes")>();
  return {
    ...actual,
    getServiceTypes: vi.fn().mockResolvedValue({
      source: "api",
      data: [
        { id: "s1", code: "water", label: "Water Connection", active: true, sortOrder: 0, slaHours: 48 },
        { id: "s2", code: "misc", label: "Misc", active: true, sortOrder: 1, slaHours: null },
      ],
    }),
  };
});

import NewServiceRequestPage from "./page";
import * as st from "@/lib/crm/serviceTypes";

const WATER = { id: "s1", code: "water", label: "Water Connection", active: true, sortOrder: 0, slaHours: 48 };
const MISC = { id: "s2", code: "misc", label: "Misc", active: true, sortOrder: 1, slaHours: null };

beforeEach(() => {
  pushMock.mockReset();
  // Keep the lib mock implementation (do NOT restoreAllMocks — that would clear it).
  vi.mocked(st.getServiceTypes).mockResolvedValue({ source: "api", data: [WATER, MISC] });
});

describe("F6-03 SR new form SLA target", () => {
  it("derives a target date and shows the SLA note when an SLA-bearing type is picked", async () => {
    render(<NewServiceRequestPage />);
    // Wait for the configured types to load into the select.
    await waitFor(() => expect(screen.getByRole("option", { name: "Water Connection" })).toBeInTheDocument());

    const dueInput = screen.getByLabelText(/target resolution date/i) as HTMLInputElement;
    expect(dueInput.value).toBe("");

    fireEvent.change(screen.getByLabelText(/service type/i), { target: { value: "Water Connection" } });

    await waitFor(() => expect(dueInput.value).not.toBe(""));
    expect(screen.getByText(/derived from the 48h SLA/i)).toBeInTheDocument();

    // Overriding sticks and drops the derived flag/notice.
    fireEvent.change(dueInput, { target: { value: "2027-06-01" } });
    expect(dueInput.value).toBe("2027-06-01");
    expect(screen.queryByText(/derived from the 48h SLA/i)).not.toBeInTheDocument();
  });

  it("does not derive a date for a type without an SLA", async () => {
    render(<NewServiceRequestPage />);
    await waitFor(() => expect(screen.getByRole("option", { name: "Misc" })).toBeInTheDocument());
    const dueInput = screen.getByLabelText(/target resolution date/i) as HTMLInputElement;
    fireEvent.change(screen.getByLabelText(/service type/i), { target: { value: "Misc" } });
    // No SLA -> no derived date, no note.
    expect(dueInput.value).toBe("");
    expect(screen.queryByText(/SLA/)).not.toBeInTheDocument();
  });

  // CLOS-S1-15: the derived target date is the IST calendar day of created-now + SLA,
  // not the UTC day (14:30Z + 6h = 20:30Z = 02:00 IST the NEXT day).
  it("CLOS-S1-15: derives the target date as an IST calendar day", async () => {
    const QUICK = { id: "s3", code: "quick", label: "Quick Fix", active: true, sortOrder: 2, slaHours: 6 };
    vi.mocked(st.getServiceTypes).mockResolvedValue({ source: "api", data: [QUICK] });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-03-10T14:30:00Z"));
    try {
      render(<NewServiceRequestPage />);
      await waitFor(() => expect(screen.getByRole("option", { name: "Quick Fix" })).toBeInTheDocument());
      fireEvent.change(screen.getByLabelText(/service type/i), { target: { value: "Quick Fix" } });
      const dueInput = screen.getByLabelText(/target resolution date/i) as HTMLInputElement;
      await waitFor(() => expect(dueInput.value).not.toBe(""));
      expect(dueInput.value).toBe("2026-03-11");
    } finally {
      vi.useRealTimers();
    }
  });
});
