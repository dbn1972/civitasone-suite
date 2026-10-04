import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
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

  /**
   * UX-016: `save`/`decide`/`load` used to throw `Error(body.message ??
   * \`Save failed (${res.status})\`)` (and the equivalent for approve/
   * reject) and re-display `err.message` verbatim — echoing either the raw
   * HTTP status or the backend's own error text. The same class of leak
   * useFormError closes fleet-wide (UX-003).
   */
  describe("IntegrationDrawer — UX-016 clerk-safe errors", () => {
    it("shows a clerk-safe message, never the raw HTTP status or backend text, when Propose change fails", async () => {
      const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === "PUT") {
          return {
            ok: false,
            status: 409,
            json: async () => ({ message: "version conflict: config changed since load" }),
          } as Response;
        }
        return mockDetail() as unknown as Response;
      });
      vi.stubGlobal("fetch", fetchMock);

      render(<IntegrationDrawer provider={anthropic} initialEnv="prod" onClose={() => {}} onChanged={() => {}} />);
      await waitFor(() => expect(screen.getByLabelText(/Model/)).toBeInTheDocument());
      fireEvent.click(screen.getByText(/Propose change/));

      const alert = await screen.findByRole("alert");
      await waitFor(() => expect(alert).toHaveTextContent(/This Anthropic \(Claude\) was changed by someone else\. Refresh to see the latest version, then try again\./));
      expect(alert.textContent).not.toMatch(/version conflict/i);
      expect(alert.textContent).not.toMatch(/\b409\b/);
    });
  });
});

const PENDING = {
  id: "c1", status: "pending", note: "rotate key", proposedBy: "3f2a9c1e-1111-4000-8000-000000000001",
  proposedByName: "A. Rao", approvedBy: null, secretChanged: true, createdAt: "2026-10-01T10:00:00.000Z", rejectedReason: null,
};

function pendingDetail(over: Record<string, unknown> = {}, pending: Record<string, unknown> | null = PENDING) {
  const base = mockDetail(over).json;
  return { ok: true, status: 200, json: async () => ({ ...(await base()), pendingChange: pending }) };
}

// GAP-ADMIN-INTEGRATIONS-03
describe("IntegrationDrawer approve / reject confirmation", () => {
  const anthropic = metaFor("ai_anthropic")!;
  const fetchMock = vi.fn();
  const posts = () => fetchMock.mock.calls.filter(([, i]) => (i as RequestInit | undefined)?.method === "POST");

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (_u: string, init?: RequestInit) =>
      init?.method === "POST" ? ({ ok: true, status: 200, json: async () => ({}) } as Response) : (pendingDetail() as unknown as Response),
    );
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  async function open() {
    render(<IntegrationDrawer provider={anthropic} initialEnv="prod" onClose={() => {}} onChanged={() => {}} />);
    await screen.findByText(/Pending change awaiting approval/);
  }

  it("Approve opens a confirmation (warning about a live prod secret) and fires nothing until confirmed", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent("replaces a live production secret");
    expect(posts()).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole("button", { name: "Approve and apply" }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(String(posts()[0]![0])).toMatch(/\/prod\/approve$/);
  });

  it("Reject requires a reason of at least 10 characters and sends the operator's own text", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    const dialog = screen.getByRole("alertdialog");
    const confirm = within(dialog).getByRole("button", { name: "Reject change" });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(/Reason for rejecting/), { target: { value: "short" } });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(/Reason for rejecting/), { target: { value: "Key belongs to a retired vendor account" } });
    expect(confirm).not.toBeDisabled();
    fireEvent.click(confirm);
    await waitFor(() => expect(posts()).toHaveLength(1));
    const body = JSON.parse(String((posts()[0]![1] as RequestInit).body));
    expect(body).toEqual({ reason: "Key belongs to a retired vendor account" });
    expect(JSON.stringify(body)).not.toContain("Rejected from Admin UI");
  });

  it("Escape in the confirmation closes only the confirmation, not the drawer", async () => {
    const onClose = vi.fn();
    render(<IntegrationDrawer provider={anthropic} initialEnv="prod" onClose={onClose} onChanged={() => {}} />);
    await screen.findByText(/Pending change awaiting approval/);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("a failed decision shows its error inside the dialog", async () => {
    fetchMock.mockImplementation(async (_u: string, init?: RequestInit) =>
      init?.method === "POST" ? ({ ok: false, status: 409, json: async () => ({ code: "MAKER_CHECKER_VIOLATION", message: "approver must differ" }) } as Response) : (pendingDetail() as unknown as Response),
    );
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Approve and apply" }));
    await waitFor(() => expect(within(screen.getByRole("alertdialog")).getByRole("alert")).toBeInTheDocument());
  });
});

// GAP-ADMIN-INTEGRATIONS-04
describe("IntegrationDrawer actors and failures", () => {
  const anthropic = metaFor("ai_anthropic")!;
  afterEach(() => vi.unstubAllGlobals());

  it("shows the proposer's name and never an id fragment", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => pendingDetail()));
    render(<IntegrationDrawer provider={anthropic} initialEnv="prod" onClose={() => {}} onChanged={() => {}} />);
    await screen.findByText(/Proposed by A\. Rao/);
    expect(document.body.textContent).not.toContain("3f2a9c1e");
  });

  it("falls back to 'another admin' when no name is resolved", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => pendingDetail({}, { ...PENDING, proposedByName: undefined })));
    render(<IntegrationDrawer provider={anthropic} initialEnv="prod" onClose={() => {}} onChanged={() => {}} />);
    await screen.findByText(/Proposed by another admin/);
    expect(document.body.textContent).not.toContain("3f2a9c1e");
  });

  it("a failed connection test is summarised in plain language; the raw text sits behind 'Technical detail'", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (typeof url === "string" && url.endsWith("/test") && init?.method === "POST") {
        return { ok: true, status: 200, json: async () => ({ ok: false, status: "failed", error: "ECONNREFUSED 10.0.0.5:443" }) } as Response;
      }
      return mockDetail() as unknown as Response;
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<IntegrationDrawer provider={anthropic} initialEnv="prod" onClose={() => {}} onChanged={() => {}} />);
    fireEvent.click(await screen.findByText(/Test connection/));
    const summary = await screen.findByText(/could not be reached/);
    expect(summary).not.toHaveTextContent("10.0.0.5");
    const details = screen.getByText("Technical detail").closest("details")!;
    expect(details).not.toHaveAttribute("open");
    expect(details).toHaveTextContent("ECONNREFUSED 10.0.0.5:443");
  });
});

// GAP-ADMIN-INTEGRATIONS-05 / 06
describe("IntegrationDrawer a11y", () => {
  const anthropic = metaFor("ai_anthropic")!;
  beforeEach(() => { vi.stubGlobal("fetch", vi.fn(async () => mockDetail())); });
  afterEach(() => vi.unstubAllGlobals());

  it("the environment switcher is a real tablist with ArrowRight navigation and a labelled tabpanel", async () => {
    render(<IntegrationDrawer provider={anthropic} initialEnv="prod" onClose={() => {}} onChanged={() => {}} />);
    const prod = await screen.findByRole("tab", { name: "prod" });
    expect(screen.getByRole("tablist", { name: "Environment scope" })).toBeInTheDocument();
    expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", prod.id);
    prod.focus();
    fireEvent.keyDown(prod, { key: "ArrowRight" });
    await waitFor(() => expect(screen.getAllByRole("tab").find((t) => t.getAttribute("aria-selected") === "true")).not.toBe(prod));
  });

  it("focus moves into the drawer, Escape closes it", async () => {
    const onClose = vi.fn();
    render(<IntegrationDrawer provider={anthropic} initialEnv="prod" onClose={onClose} onChanged={() => {}} />);
    const dialog = await screen.findByRole("dialog", { name: /Anthropic/ });
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("secret inputs are password fields with autocomplete=new-password and an empty value", async () => {
    render(<IntegrationDrawer provider={anthropic} initialEnv="prod" onClose={() => {}} onChanged={() => {}} />);
    const apiKey = (await screen.findByLabelText(/API Key/)) as HTMLInputElement;
    expect(apiKey.type).toBe("password");
    expect(apiKey).toHaveAttribute("autocomplete", "new-password");
    expect(apiKey.value).toBe("");
  });

  it("the loading state is a skeleton, not bare text", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    render(<IntegrationDrawer provider={anthropic} initialEnv="prod" onClose={() => {}} onChanged={() => {}} />);
    expect(screen.getByLabelText("Loading integration settings")).toBeInTheDocument();
    expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
  });
});
