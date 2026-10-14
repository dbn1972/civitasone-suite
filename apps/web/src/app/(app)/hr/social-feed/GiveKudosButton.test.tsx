import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

// The real EntityPicker does a debounced directory search; this stand-in just
// lets a test choose a receiver so the submit path (not the picker) is under test.
vi.mock("../../../_components/ds", async () => {
  const actual = await vi.importActual<typeof import("../../../_components/ds")>("../../../_components/ds");
  return {
    ...actual,
    EntityPicker: ({ onChange, id }: { onChange: (v: string | null) => void; id?: string }) => (
      <button type="button" id={id} onClick={() => onChange("emp-1")}>
        Choose colleague
      </button>
    ),
  };
});

import { GiveKudosButton } from "./GiveKudosButton";

async function openAndFill() {
  render(<GiveKudosButton label="Give kudos" />);
  fireEvent.click(screen.getByRole("button", { name: "Give kudos" }));
  fireEvent.click(await screen.findByText("Choose colleague"));
  fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Great work on the audit" } });
}

function submit() {
  fireEvent.click(screen.getAllByRole("button", { name: "Give kudos" }).at(-1)!);
}

describe("GiveKudosButton save failures (no raw server text)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("never shows a raw non-JSON failure body (proxy/stack trace text)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Internal Server Error at /srv/app/kudos.js:42 ECONNREFUSED", { status: 500 }),
    );
    await openAndFill();
    submit();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent ?? "").not.toMatch(/ECONNREFUSED|kudos\.js|Internal Server Error|500/);
    expect((alert.textContent ?? "").trim().length).toBeGreaterThan(0);
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("shows an inline fieldErrors message on the field, not the raw envelope message", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          code: "VALIDATION_ERROR",
          message: "raw: body.message failed zod check",
          fieldErrors: [{ field: "message", message: "Say a little more about why." }],
        }),
        { status: 422 },
      ),
    );
    await openAndFill();
    submit();
    expect(await screen.findByText("Say a little more about why.")).toBeInTheDocument();
    expect(screen.getByLabelText("Message")).toHaveAttribute("aria-invalid", "true");
    expect(screen.queryByText(/raw: body\.message/)).not.toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("never shows a raw network exception when fetch throws", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
    await openAndFill();
    submit();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent ?? "").not.toMatch(/failed to fetch/i);
    expect((alert.textContent ?? "").trim().length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Give kudos" }).at(-1)).not.toBeDisabled());
  });
});
