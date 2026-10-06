import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { PluginConfigControls } from "./PluginConfigControls";

function renderControls(overrides: Partial<React.ComponentProps<typeof PluginConfigControls>> = {}) {
  return render(
    <PluginConfigControls
      pluginId="attrition-prediction"
      pluginName="Employee Attrition Risk"
      enabled={false}
      mode="disabled"
      confidenceThreshold={50}
      autoAction={false}
      requiresTraining={false}
      {...overrides}
    />,
  );
}

describe("PluginConfigControls — GAP-TENANT-ADMIN-AI-PLUGINS-01 (WIRING)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("PATCHes {mode:'shadow'} to the plugin endpoint when the mode select changes", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ status: "updated" }), { status: 200 }));
    renderControls();
    fireEvent.change(screen.getByLabelText(/Mode/i), { target: { value: "shadow" } });
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toBe("/api/proxy/v1/hrms/ai/plugins/attrition-prediction");
    expect(init!.method).toBe("PATCH");
    expect(JSON.parse(String(init!.body))).toMatchObject({ mode: "shadow" });
  });

  it("rejects a threshold of 101 client-side without calling the API", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    renderControls();
    const input = screen.getByLabelText(/Confidence threshold/i);
    fireEvent.change(input, { target: { value: "101" } });
    fireEvent.blur(input);
    expect(await screen.findByText(/Enter a number from 0 to 100/i)).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("requires a reason before enabling auto-action and then PATCHes autoAction:true", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ status: "updated" }), { status: 200 }));
    renderControls();
    fireEvent.click(screen.getByRole("button", { name: /Enable auto-action/i }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.change(within(dialog).getByLabelText(/Reason/i), { target: { value: "approved by HR head" } });
    const confirm = Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === "Enable auto-action");
    fireEvent.click(confirm!);
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    expect(JSON.parse(String(fetchSpy.mock.calls[0]![1]!.body))).toMatchObject({ autoAction: true, reason: "approved by HR head" });
  });

  it("shows a clerk-safe error (never the raw body) when the PATCH fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("internal: db pool exhausted", { status: 500 }));
    renderControls();
    fireEvent.change(screen.getByLabelText(/Mode/i), { target: { value: "active" } });
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("alert").textContent).not.toMatch(/db pool exhausted/i);
  });

  it("blocks enabling a plugin that still requires training data", () => {
    renderControls({ requiresTraining: true, enabled: false });
    const sw = screen.getByRole("switch");
    expect(sw).toBeDisabled();
  });
});
