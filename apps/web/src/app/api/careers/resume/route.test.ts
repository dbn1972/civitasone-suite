// @vitest-environment node
import { describe, it, expect, vi, afterEach } from "vitest";
import { POST } from "./route";

afterEach(() => vi.unstubAllGlobals());

const JOB = "22222222-0001-4000-8000-000000000002";
const TENANT = "aaaaaaaa-0001-4000-8000-00000000a001";

function req(file: File | null, extra: Record<string, string> = {}, headers: Record<string, string> = {}, ip?: string) {
  const fd = new FormData();
  if (file) fd.set("file", file);
  fd.set("jobOpeningId", JOB);
  for (const [k, v] of Object.entries(extra)) fd.set(k, v);
  return { formData: async () => fd, headers: new Headers(headers), ip } as never;
}
const pdf = (size = 2048, name = "cv.pdf", type = "application/pdf") => new File([new Uint8Array(size).fill(0x25)], name, { type });

describe("POST /api/careers/resume", () => {
  it("forwards a valid PDF to the service as base64 JSON with the tenant header", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ resumeKey: "careers-resumes/t/x.pdf", sizeBytes: 2048 }), { status: 201 }));
    vi.stubGlobal("fetch", f);
    const res = await POST(req(pdf(), { tenantId: TENANT }));
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ resumeKey: "careers-resumes/t/x.pdf" });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/api/v1/careers/resume");
    expect((init.headers as Record<string, string>)["x-tenant-id"]).toBe(TENANT);
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ tenantId: TENANT, jobOpeningId: JOB, fileName: "cv.pdf", mimeType: "application/pdf" });
    expect(Buffer.from(body.contentBase64, "base64").length).toBe(2048);
  });

  it("forwards the client's address: the first hop of X-Forwarded-For, else the socket address", async () => {
    const f = vi.fn(async () => new Response("{}", { status: 201 }));
    vi.stubGlobal("fetch", f);
    await POST(req(pdf(), {}, { "x-forwarded-for": "203.0.113.7, 10.0.0.2" }, "10.0.0.2"));
    await POST(req(pdf(), {}, {}, "198.51.100.9"));
    const xff = (i: number) => ((f.mock.calls[i] as unknown as [string, RequestInit])[1].headers as Record<string, string>)["x-forwarded-for"];
    expect(xff(0)).toBe("203.0.113.7");
    expect(xff(1)).toBe("198.51.100.9");
  });

  it("refuses a 6 MB file and an .exe before anything is forwarded", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    expect((await POST(req(pdf(6 * 1024 * 1024)))).status).toBe(413);
    expect((await POST(req(pdf(100, "setup.exe", "application/x-msdownload")))).status).toBe(422);
    expect((await POST(req(pdf(0)))).status).toBe(422);
    expect(f).not.toHaveBeenCalled();
  });

  it("requires a file and a vacancy id", async () => {
    vi.stubGlobal("fetch", vi.fn());
    expect((await POST(req(null))).status).toBe(400);
    const fd = new FormData();
    fd.set("file", pdf());
    expect((await POST({ formData: async () => fd } as never)).status).toBe(400);
  });

  it("passes the service's refusal (e.g. a malware hit) straight through", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ code: "MALWARE_DETECTED", message: "x" }), { status: 422 })));
    const res = await POST(req(pdf()));
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe("MALWARE_DETECTED");
  });

  it("a gateway failure is a 502, never a crash", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("down"); }));
    expect((await POST(req(pdf()))).status).toBe(502);
  });
});
