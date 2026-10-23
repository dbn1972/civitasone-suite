import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { xhrPut } from "./xhrPut";

class FakeXhr {
  static last: FakeXhr | undefined;
  upload: { onprogress: ((e: unknown) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  status = 200;
  sent = false;
  constructor() { FakeXhr.last = this; }
  open = vi.fn();
  setRequestHeader = vi.fn();
  send = vi.fn(() => { this.sent = true; });
  abort = vi.fn(() => { this.onabort?.(); });
}

describe("xhrPut abort handling (CLOS-S3-04)", () => {
  const OrigXhr = globalThis.XMLHttpRequest;
  beforeEach(() => { FakeXhr.last = undefined; globalThis.XMLHttpRequest = FakeXhr as unknown as typeof XMLHttpRequest; });
  afterEach(() => { globalThis.XMLHttpRequest = OrigXhr; });
  const args = (signal?: AbortSignal) => ({ url: "https://x/y", headers: {}, body: new Blob(["a"]), onProgress: () => {}, signal });

  it("does not upload when the signal is already aborted", async () => {
    const res = await xhrPut(args(AbortSignal.abort()));
    expect(res).toEqual({ ok: false, status: 0 });
    // No request is even opened for a pre-aborted signal, so nothing is uploaded.
    expect(FakeXhr.last).toBeUndefined();
  });

  it("aborting mid-flight resolves {ok:false,status:0}", async () => {
    const ac = new AbortController();
    const p = xhrPut(args(ac.signal));
    ac.abort();
    expect(await p).toEqual({ ok: false, status: 0 });
  });

  it("removes the abort listener once the request completes", async () => {
    const ac = new AbortController();
    const rm = vi.spyOn(ac.signal, "removeEventListener");
    const p = xhrPut(args(ac.signal));
    FakeXhr.last!.onload?.();
    expect(await p).toEqual({ ok: true });
    expect(rm).toHaveBeenCalledWith("abort", expect.any(Function));
  });
});
