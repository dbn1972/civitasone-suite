import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The route reads CONTACT_LEAD_FORM_KEY at module-eval time, so each case sets env then
// imports a fresh copy of the module.
const FORM_KEY = "a".repeat(64);
const ORIGINAL = { ...process.env };

function request(body: unknown): Request {
  return new Request("https://civitasone.example/api/contact", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const validBody = {
  name: "Priya Das",
  department: "Revenue",
  email: "priya@example.gov.in",
  phone: "+91 98765 43210",
  topic: "sales",
  message: "We would like a demo.",
  consent: true,
};

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  process.env = { ...ORIGINAL };
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("POST /api/contact", () => {
  it("returns 503 NOT_CONFIGURED when no form key is set (honest fallback)", async () => {
    delete process.env.CONTACT_LEAD_FORM_KEY;
    const { POST } = await import("./route");
    const res = await POST(request(validBody) as never);
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("NOT_CONFIGURED");
  });

  it("returns 400 for a client-invalid payload without calling upstream", async () => {
    process.env.CONTACT_LEAD_FORM_KEY = FORM_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { POST } = await import("./route");

    const res = await POST(request({ ...validBody, email: "nope", consent: false }) as never);
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards a valid lead to crm public capture and returns the correlationId as the reference", async () => {
    process.env.CONTACT_LEAD_FORM_KEY = FORM_KEY;
    process.env.CIVITASONE_API_BASE_URL = "http://gateway:8080";
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ status: "accepted", correlationId: "corr-123" }), { status: 202 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { POST } = await import("./route");

    const res = await POST(request(validBody) as never);
    expect(res.status).toBe(202);
    expect((await res.json()).reference).toBe("corr-123");

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`http://gateway:8080/api/v1/crm/public/leads/${FORM_KEY}`);
    const sent = JSON.parse(String(init.body)) as Record<string, unknown>;
    // Only crm-modelled fields; no message key (crm body is .strict()).
    expect(sent).not.toHaveProperty("message");
    expect(sent.company).toBe("Revenue");
    expect(sent.source).toBe("contact_sales");
  });

  it("maps a 429 from upstream to a 429 for the client", async () => {
    process.env.CONTACT_LEAD_FORM_KEY = FORM_KEY;
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 429 })));
    const { POST } = await import("./route");
    const res = await POST(request(validBody) as never);
    expect(res.status).toBe(429);
    expect((await res.json()).code).toBe("RATE_LIMITED");
  });

  it("returns 502 when the upstream call throws", async () => {
    process.env.CONTACT_LEAD_FORM_KEY = FORM_KEY;
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));
    const { POST } = await import("./route");
    const res = await POST(request(validBody) as never);
    expect(res.status).toBe(502);
  });
});
