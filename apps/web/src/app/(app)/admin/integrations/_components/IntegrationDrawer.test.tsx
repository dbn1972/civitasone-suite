import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { IntegrationDrawer, StatusBadge } from "./IntegrationDrawer";
import { PROVIDER_META, metaFor, CATEGORIES } from "./providers";

function mockDetail(over: Record<string, unknown> = {}) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      data: {
        provider: "ai_anthropic", envScope: "prod", category: "ai", label: "Anthropic (Claude)",
        secretFields: ["apiKey"], enabled: true, endpointUrl: "", config: { model: "claude-3-5-sonnet-latest" },
        hasSecret: true, secretMasked: "••••1234", status: "connected",
        lastTestedAt: null, lastError: null, version: 2, updatedAt: null, ...over,
      },
      pendingChange: null,
      history: [],
    }),
  };
}

describe("providers metadata", () => {
  it("declares 9 providers across all categories", () => {
    expect(PROVIDER_META).toHaveLength(9);
    for (const p of PROVIDER_META) {
      expect(CATEGORIES.some((c) => c.id === p.category)).toBe(true);
      expect(p.fields.some((f) => f.secret)).toBe(true);
    }
  });
  it("metaFor resolves a known provider", () => {
    expect(metaFor("sms_twilio")?.label).toBe("Twilio SMS");
    expect(metaFor("nope")).toBeUndefined();
  });
});

describe("StatusBadge", () => {
  it("maps connected → good, failed → bad, unconfigured → mut", () => {
    const { container: a } = render(<StatusBadge status="connected" />);
    expect(a.querySelector(".pill.good")).toBeInTheDocument();
    expect(screen.getByText("Connected")).toBeInTheDocument();
    const { container: b } = render(<StatusBadge status="failed" />);
    expect(b.querySelector(".pill.bad")).toBeInTheDocument();
    const { container: c } = render(<StatusBadge status="unconfigured" />);
    expect(c.querySelector(".pill.mut")).toBeInTheDocument();
  });
});

describe("IntegrationDrawer", () => {
  beforeEach(() => { vi.stubGlobal("fetch", vi.fn(async () => mockDetail())); });
  afterEach(() => { vi.unstubAllGlobals(); });

  const anthropic = metaFor("ai_anthropic")!;

  it("renders secret fields as write-only password inputs, never prefilling the secret", async () => {
    render(<IntegrationDrawer provider={anthropic} initialEnv="prod" onClose={() => {}} onChanged={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText(/Model/)).toBeInTheDocument());

    const apiKey = screen.getByLabelText(/API Key/) as HTMLInputElement;
    expect(apiKey.type).toBe("password");
    expect(apiKey.value).toBe(""); // secret never prefilled
    expect(apiKey.placeholder).toContain("••••1234"); // masked hint shown

    const model = screen.getByLabelText(/Model/) as HTMLInputElement;
    expect(model.value).toBe("claude-3-5-sonnet-latest"); // non-secret prefilled
  });

  it("shows the environment switcher and the connected status", async () => {
    render(<IntegrationDrawer provider={anthropic} initialEnv="prod" onClose={() => {}} onChanged={() => {}} />);
    await waitFor(() => expect(screen.getByText("Connected")).toBeInTheDocument());
    expect(screen.getByRole("tab", { name: "prod" })).toHaveAttribute("aria-selected", "true");
  });

  it("runs a test-connection and shows the inline result", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (typeof url === "string" && url.endsWith("/test") && init?.method === "POST") {
        return { ok: true, status: 200, json: async () => ({ ok: true, status: "connected", detail: "HTTP 200" }) } as Response;
      }
      return mockDetail() as unknown as Response;
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<IntegrationDrawer provider={anthropic} initialEnv="prod" onClose={() => {}} onChanged={() => {}} />);
    await waitFor(() => expect(screen.getByText(/Test connection/)).toBeInTheDocument());
    fireEvent.click(screen.getByText(/Test connection/));
    await waitFor(() => expect(screen.getByText(/Connected — HTTP 200/)).toBeInTheDocument());
  });

  it("calls onClose when the Close button is clicked", async () => {
    const onClose = vi.fn();
    render(<IntegrationDrawer provider={anthropic} initialEnv="prod" onClose={onClose} onChanged={() => {}} />);
    await waitFor(() => expect(screen.getByText("Close")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Close"));
    expect(onClose).toHaveBeenCalled();
  });
});
