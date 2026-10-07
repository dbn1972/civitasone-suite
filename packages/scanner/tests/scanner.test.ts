import { afterEach, describe, expect, it, vi } from "vitest";
import { scanBuffer, scanFile } from "../src/index.js";

const buf = Buffer.from("hello");

function stubFetch(impl: () => Promise<unknown>) {
  const fn = vi.fn(impl);
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("scanner client", () => {
  it("reports clean for an ok reply with no infection flag", async () => {
    stubFetch(async () => ({ ok: true, json: async () => ({ infected: false }) }));
    expect(await scanFile(buf, "a.txt", { url: "http://scan.test/scan" })).toEqual({ status: "clean" });
  });

  it("reports infected for infected:true", async () => {
    stubFetch(async () => ({ ok: true, json: async () => ({ infected: true }) }));
    expect(await scanFile(buf, "a.txt", { url: "http://scan.test/scan" })).toEqual({ status: "infected" });
  });

  it("reports infected for status:\"infected\"", async () => {
    stubFetch(async () => ({ ok: true, json: async () => ({ status: "infected" }) }));
    expect(await scanFile(buf, "a.txt", { url: "http://scan.test/scan" })).toEqual({ status: "infected" });
  });

  it("reports error on a non-2xx reply", async () => {
    stubFetch(async () => ({ ok: false, json: async () => ({}) }));
    expect(await scanFile(buf, "a.txt", { url: "http://scan.test/scan" })).toEqual({ status: "error" });
  });

  it("reports error when the endpoint is unreachable", async () => {
    stubFetch(async () => {
      throw new Error("ECONNREFUSED");
    });
    expect(await scanFile(buf, "a.txt", { url: "http://scan.test/scan" })).toEqual({ status: "error" });
  });

  it("uses CLAMAV_URL from the environment when no url is passed, and scanBuffer posts as \"upload\"", async () => {
    vi.stubEnv("CLAMAV_URL", "http://env-scan.test/scan");
    const fn = stubFetch(async () => ({ ok: true, json: async () => ({}) }));
    expect(await scanBuffer(buf)).toEqual({ status: "clean" });
    expect(fn.mock.calls[0]![0]).toBe("http://env-scan.test/scan");
    const body = (fn.mock.calls[0]![1] as { body: FormData }).body;
    expect((body.get("file") as File).name).toBe("upload");
  });
});
