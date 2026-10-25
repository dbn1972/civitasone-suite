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

  // CLOS3-S1-05: a late poll reply for export A must not overwrite export B's card or stop B's polling.
  it("CLOS3-S1-05: a stale poll reply for the previous export is ignored", async () => {
    vi.useFakeTimers();
    const mk = (id: string, status: string) => ({
      data: { ...STATUS.data, id, status, ready: status === "completed", download: status === "completed" ? "tok" : null },
    });
    let postCount = 0;
    let releaseA: (r: Response) => void = () => {};
    const getB = vi.fn();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/proxy/v1/audit/exports" && init?.method === "POST") {
        const id = postCount++ === 0 ? "A" : "B";
        return new Response(JSON.stringify({ id, data: { id } }), { status: 202 });
      }
      if (url === "/api/proxy/v1/audit/exports/A") return new Promise<Response>((res) => { releaseA = res; });
      if (url === "/api/proxy/v1/audit/exports/B") {
        getB();
        return new Response(JSON.stringify(mk("B", "processing")), { status: 200 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    render(<ExportConsole />);
    for (let i = 0; i < 2; i++) {
      fireEvent.click(screen.getByRole("button", { name: "Generate export" }));
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      fireEvent.click(screen.getByRole("button", { name: "Generate" }));
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    }
    expect(postCount).toBe(2);
    expect(getB).toHaveBeenCalledTimes(1);

    // The slow reply for A (terminal) lands after B was started.
    await act(async () => { releaseA(new Response(JSON.stringify(mk("A", "completed")), { status: 200 })); });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.queryByText("Ready")).not.toBeInTheDocument();

    // B is still being polled and its resume key is intact.
    await act(async () => { await vi.advanceTimersByTimeAsync(2600); });
    expect(getB.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(Object.values(window.sessionStorage).includes("B")).toBe(true);
  });
});
