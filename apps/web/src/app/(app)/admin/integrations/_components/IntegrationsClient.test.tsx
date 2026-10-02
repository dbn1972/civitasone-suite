import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { IntegrationsClient } from "./IntegrationsClient";
import { IntegrationDrawer } from "./IntegrationDrawer";
import { PROVIDER_META } from "./providers";

// GAP-ADMIN-INTEGRATIONS-02
describe("IntegrationsClient load failure", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("a failed first load shows a retry, not 'Not configured' pills, and dashes in the stat cards", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 500 }));
    render(<IntegrationsClient />);
    expect(await screen.findByRole("button", { name: /try again/i })).toBeInTheDocument();
    expect(screen.queryByText("Not configured")).not.toBeInTheDocument();
    expect(screen.getByText("Connected").parentElement).toHaveTextContent("—");
    expect(screen.getByText("Failing").parentElement).toHaveTextContent("—");

    spy.mockResolvedValue(new Response(JSON.stringify({ data: [{ provider: PROVIDER_META[0]!.id, envScope: "prod", status: "connected", enabled: true, hasSecret: true }] }), { status: 200 }));
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    await waitFor(() => expect(screen.queryByRole("button", { name: /try again/i })).not.toBeInTheDocument());
    expect(screen.getAllByText("Connected")[0]!.parentElement).toHaveTextContent("1");
  });
});

describe("IntegrationDrawer detail load failure", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("disables 'Propose change' and offers a retry when the detail GET fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 500 }));
    render(<IntegrationDrawer provider={PROVIDER_META[0]!} initialEnv="prod" onClose={() => {}} onChanged={() => {}} />);
    expect(await screen.findByRole("button", { name: /try again/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /propose change/i })).toBeDisabled();
  });

  it("a legitimately unconfigured provider (200) still allows first-time setup", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: { provider: PROVIDER_META[0]!.id, envScope: "prod", status: "unconfigured", enabled: true, hasSecret: false, config: {} }, pendingChange: null, history: [] }), { status: 200 }));
    render(<IntegrationDrawer provider={PROVIDER_META[0]!} initialEnv="prod" onClose={() => {}} onChanged={() => {}} />);
    await waitFor(() => expect(screen.getByRole("button", { name: /propose change/i })).not.toBeDisabled());
  });
});
