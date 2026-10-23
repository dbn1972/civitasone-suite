import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { ExportConsole } from "./ExportConsole";

const STATUS = {
  data: {
    id: "exp-1", status: "completed", format: "json", ready: true, download: "tok", rowCount: 42, includesPii: false,
    retentionUntil: null, expiresAt: null, error: null, contentSha256: "abc", signature: null, signatureAlg: null,
    signingKeyId: null, signedAt: null,
  },
};

describe("ExportConsole closure defects", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.sessionStorage.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // CLOS-S1-13: default From/To must be the IST calendar day, not the UTC day.
  it("CLOS-S1-13: default range uses the IST date (20:30Z is already the next IST day)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-21T20:30:00Z"));
    render(<ExportConsole />);
    expect((screen.getByLabelText("To date") as HTMLInputElement).value).toBe("2026-10-22");
    expect((screen.getByLabelText("From date") as HTMLInputElement).value).toBe("2026-09-22");
  });

  // CLOS-S1-14: a later toast must not be dismissed by an earlier toast's timer.
  it("CLOS-S1-14: a second toast is not cleared early by the first toast timer", async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/proxy/v1/audit/exports") return new Response(JSON.stringify({ id: "exp-1", data: { id: "exp-1" } }), { status: 202 });
      if (url === "/api/proxy/v1/audit/exports/exp-1/verify") {
        return new Response(JSON.stringify({ data: { id: "exp-1", verified: true, contentMatch: true, signatureMatch: true } }), { status: 200 });
      }
      if (url.startsWith("/api/proxy/v1/audit/exports/exp-1")) return new Response(JSON.stringify(STATUS), { status: 200 });
      throw new Error(`unexpected fetch: ${url}`);
    });
    render(<ExportConsole />);
    fireEvent.click(screen.getByRole("button", { name: "Generate export" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    // Poll completes -> toast A ("Export generated and signed.") arms its timer.
    await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    expect(screen.getByText("Export generated and signed.")).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    fireEvent.click(screen.getByRole("button", { name: "Verify integrity" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByText("Integrity verified.")).toBeInTheDocument();
    // Toast A's timer would fire here; toast B must survive it.
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(screen.queryByText("Integrity verified.")).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    expect(screen.queryByText("Integrity verified.")).not.toBeInTheDocument();
  });
});
