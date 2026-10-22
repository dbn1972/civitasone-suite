import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { AgentWorkloadEditor } from "./AgentWorkloadEditor";

/**
 * GAP-CRM-AGENT-WORKLOAD-05 (component level): when the roster API sends an agent
 * with no name, the table cell, the control labels and the save confirmation all
 * show a neutral "Unnamed agent" label -- never the raw agentId (a UUID). This
 * drives the REAL getAgents/normaliseAgents path (only the network is mocked), so
 * it fails if the normaliser ever falls back to the id again.
 */
const browserFetch = vi.fn();
vi.mock("@/lib/api/browserClient", async (orig) => {
  const actual = await orig<typeof import("@/lib/api/browserClient")>();
  return { ...actual, browserFetch: (...args: unknown[]) => browserFetch(...args) };
});

const AGENT_ID = "3f2a1b4c-0000-4000-8000-000000000001";

function render(ui: React.ReactElement) {
  return rtlRender(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  browserFetch.mockReset();
  browserFetch.mockImplementation(async (path: string, init?: { method?: string }) => {
    if (init?.method === "PATCH") return new Response(null, { status: 202 });
    expect(path).toBe("v1/crm/teams/agents");
    return new Response(
      JSON.stringify({ data: [{ agentId: AGENT_ID, maxLeads: 10, currentLoad: 2, available: true }] }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  });
});

describe("AgentWorkloadEditor unnamed agent (GAP-CRM-AGENT-WORKLOAD-05)", () => {
  it("shows 'Unnamed agent' in the table cell and control labels, never the UUID", async () => {
    render(<AgentWorkloadEditor />);
    expect(await screen.findByRole("rowheader", { name: "Unnamed agent" })).toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: "Max leads for Unnamed agent" })).toBeInTheDocument();
    expect(document.body.textContent ?? "").not.toContain(AGENT_ID);
  });

  it("uses the fallback label (not the UUID) in the save confirmation", async () => {
    render(<AgentWorkloadEditor />);
    await screen.findByRole("rowheader", { name: "Unnamed agent" });
    // Raising capacity is not risky, so it saves directly (no reason dialog).
    fireEvent.change(screen.getByLabelText("Max leads for Unnamed agent"), { target: { value: "15" } });
    fireEvent.click(screen.getByRole("button", { name: "Save capacity for Unnamed agent" }));
    await waitFor(() => expect(screen.getByText(/capacity saved/i)).toBeInTheDocument());
    expect(screen.getByText("Unnamed agent's capacity saved.")).toBeInTheDocument();
    expect(document.body.textContent ?? "").not.toContain(AGENT_ID);
  });
});
