import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { render } from "@/test-utils/intl-render";
import en from "@/messages/en.json";
import hi from "@/messages/hi.json";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { ModulesConfirmCard } from "./ModulesConfirmCard";

describe("ModulesConfirmCard (W0: setup wizard modules step)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refresh.mockReset();
  });

  it("confirming PATCHes the tenant settings with the flag the wizard reads, merged into existing settings", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 202 }));
    render(<ModulesConfirmCard tenantId="t1" settings={{ orgType: "ngo", theme: "dark" }} />);
    fireEvent.click(screen.getByRole("button", { name: "Confirm modules" }));

    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith("/api/proxy/v1/tenants/t1", expect.objectContaining({ method: "PATCH" })),
    );
    const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
    // Same predicate as setup/progress.ts evalModules: modulesConfirmedAt non-empty string OR modulesConfirmed === true.
    expect(body.settings.orgType).toBe("ngo");
    expect(body.settings.theme).toBe("dark");
    expect(body.settings.modulesConfirmed).toBe(true);
    expect(typeof body.settings.modulesConfirmedAt).toBe("string");
    expect(Number.isNaN(Date.parse(body.settings.modulesConfirmedAt))).toBe(false);
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(await screen.findByText("Module selection confirmed.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirmed" })).toBeDisabled();
  });

  it("shows an already-confirmed tenant as done and does not offer to PATCH again", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<ModulesConfirmCard tenantId="t1" settings={{ modulesConfirmedAt: "2026-10-01T00:00:00.000Z" }} />);
    const btn = screen.getByRole("button", { name: "Confirmed" });
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("surfaces a save failure and does not mark the step confirmed", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 500 }));
    render(<ModulesConfirmCard tenantId="t1" settings={{}} />);
    fireEvent.click(screen.getByRole("button", { name: "Confirm modules" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).not.toBe(""));
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Confirm modules" })).toBeEnabled();
  });

  it("has en and hi copy for every key", () => {
    const e = (en as unknown as Record<string, Record<string, string>>).tenantModulesConfirm;
    const h = (hi as unknown as Record<string, Record<string, string>>).tenantModulesConfirm;
    expect(Object.keys(h).sort()).toEqual(Object.keys(e).sort());
    for (const k of Object.keys(e)) expect(h[k]!.length).toBeGreaterThan(0);
  });
});
