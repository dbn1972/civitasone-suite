import { describe, it, expect, vi, beforeEach, type MockInstance } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ConfigForm } from "./ConfigForm";
import type { PlatformControllable } from "./configDiff";

const server: PlatformControllable = {
  cacheTtl: { finance: 60 },
  rateLimits: { perMinute: 100, burstMax: 20 },
  logLevel: "info",
  debugModeUntil: null,
  notifications: { emailProvider: "smtp", smsProvider: "none", emailFrom: "noreply@civitasone.in", smsFrom: "CIVONE" },
};

describe("ConfigForm", () => {
  let spy: MockInstance<typeof fetch>;
  beforeEach(() => {
    vi.restoreAllMocks();
    spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
  });

  it("renders the values returned by the server, not literals, and Save is disabled until a field changes", () => {
    render(<ConfigForm initial={{ ...server, rateLimits: { perMinute: 777, burstMax: 20 } }} />);
    expect((screen.getByLabelText(/Requests per minute/) as HTMLInputElement).value).toBe("777");
    expect(screen.queryByLabelText(/Platform Name/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save Configuration" })).toBeDisabled();
  });

  it("confirms first, then PATCHes only the changed field", async () => {
    render(<ConfigForm initial={server} />);
    fireEvent.change(screen.getByLabelText("Log level"), { target: { value: "warn" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Configuration" }));
    expect(await screen.findByText(/apply platform-wide/i)).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Apply changes" }));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(String(spy.mock.calls[0]![0])).toBe("/api/proxy/v1/admin/platform-config");
    expect(JSON.parse((spy.mock.calls[0]![1] as RequestInit).body as string)).toEqual({ logLevel: "warn" });
  });

  it("an out-of-range value shows a field error and sends nothing", async () => {
    render(<ConfigForm initial={server} />);
    fireEvent.change(screen.getByLabelText(/finance/), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Configuration" }));
    expect(await screen.findByText("Enter 5-3600")).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });
});
