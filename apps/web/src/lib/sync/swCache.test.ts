// @vitest-environment node
/**
 * V4-A-01: the service worker must never persist authenticated data in Cache
 * Storage (it is keyed by URL only, outside the per-user encrypted IndexedDB
 * layer, and survives logout), must honour no-store/private, and must purge
 * civitasone-* caches when asked to on logout.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

type Handler = (event: any) => void;

class FakeCache {
  store = new Map<string, Response>();
  async put(req: Request | string, res: Response) {
    this.store.set(typeof req === "string" ? new URL(req, ORIGIN).href : req.url, res);
  }
  async match(req: Request | string) {
    const r = this.store.get(typeof req === "string" ? new URL(req, ORIGIN).href : req.url);
    return r ? r.clone() : undefined;
  }
}

const ORIGIN = "https://app.test";

function boot(network: (req: Request) => Promise<Response>) {
  const listeners: Record<string, Handler> = {};
  const caches = new Map<string, FakeCache>();
  const fakeCaches = {
    open: async (n: string) => {
      if (!caches.has(n)) caches.set(n, new FakeCache());
      return caches.get(n)!;
    },
    keys: async () => [...caches.keys()],
    delete: async (n: string) => caches.delete(n),
    match: async (req: Request | string) => {
      for (const c of caches.values()) {
        const m = await c.match(req);
        if (m) return m;
      }
      return undefined;
    },
  };
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (t: string, h: Handler) => (listeners[t] = h),
    skipWaiting: async () => {},
    clients: { claim: async () => {}, matchAll: async () => [] },
  };
  const fetchFn = (input: any) => network(input instanceof Request ? input : new Request(new URL(input, ORIGIN)));
  const src = readFileSync(join(__dirname, "../../../public/sw.js"), "utf8");
  new Function("self", "caches", "fetch", "URL", "Response", src)(self, fakeCaches, fetchFn, URL, Response);

  async function dispatchFetch(req: Request): Promise<Response | undefined> {
    let p: Promise<Response> | undefined;
    listeners.fetch({ request: req, respondWith: (x: Promise<Response>) => (p = x) });
    return p;
  }
  async function dispatchMessage(data: unknown, sourceUrl: string | null = `${ORIGIN}/`) {
    const waits: Promise<unknown>[] = [];
    listeners.message({ data, source: sourceUrl === null ? undefined : { url: sourceUrl }, waitUntil: (x: Promise<unknown>) => waits.push(x) });
    await Promise.all(waits);
  }
  async function install() {
    const waits: Promise<unknown>[] = [];
    listeners.install({ waitUntil: (x: Promise<unknown>) => waits.push(x) });
    await Promise.all(waits);
  }
  async function allCachedUrls(): Promise<string[]> {
    return [...caches.values()].flatMap((c) => [...c.store.keys()]);
  }
  return { caches, dispatchFetch, dispatchMessage, install, allCachedUrls };
}

const json = (body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json", ...headers } });

describe("service worker cache hygiene (V4-A-01)", () => {
  it("does not persist authenticated /api/proxy GET responses", async () => {
    let online = true;
    const sw = boot(async () => {
      if (!online) throw new TypeError("offline");
      return json({ payroll: "user-A-secret" });
    });
    const res = await sw.dispatchFetch(new Request(`${ORIGIN}/api/proxy/hr/payroll`));
    expect(await res!.json()).toEqual({ payroll: "user-A-secret" });
    expect(await sw.allCachedUrls()).not.toContain(`${ORIGIN}/api/proxy/hr/payroll`);

    online = false;
    const offline = await sw.dispatchFetch(new Request(`${ORIGIN}/api/proxy/hr/payroll`));
    expect(offline!.status).toBe(503);
    expect(JSON.stringify(await offline!.json())).not.toContain("user-A-secret");
  });

  it("does not cache navigation responses marked no-store or private", async () => {
    const sw = boot(async () => new Response("<html>hello Asha</html>", { status: 200, headers: { "cache-control": "private, no-cache, no-store, max-age=0, must-revalidate" } }));
    // Request.mode is "cors" for a hand-built Request; emulate a navigation.
    const nav = new Proxy(new Request(`${ORIGIN}/hr/payroll`), { get: (t, k) => (k === "mode" ? "navigate" : (t as any)[k] instanceof Function ? (t as any)[k].bind(t) : (t as any)[k]) });
    await sw.dispatchFetch(nav as Request);
    expect(await sw.allCachedUrls()).not.toContain(`${ORIGIN}/hr/payroll`);

    const priv = boot(async () => new Response("<html>hi</html>", { status: 200, headers: { "cache-control": "private, max-age=60" } }));
    await priv.dispatchFetch(nav as Request);
    expect(await priv.allCachedUrls()).toEqual([]);
  });

  it("never serves a stale personalised page when offline (falls back to /offline)", async () => {
    let online = true;
    const sw = boot(async (req) => {
      if (!online) throw new TypeError("offline");
      if (new URL(req.url).pathname === "/offline") return new Response("offline page", { status: 200 });
      return new Response("<html>hello Asha</html>", { status: 200, headers: { "cache-control": "no-store" } });
    });
    await sw.install();
    const nav = new Proxy(new Request(`${ORIGIN}/hr/payroll`), { get: (t, k) => (k === "mode" ? "navigate" : (t as any)[k] instanceof Function ? (t as any)[k].bind(t) : (t as any)[k]) });
    await sw.dispatchFetch(nav as Request);
    online = false;
    const res = await sw.dispatchFetch(nav as Request);
    expect(await res!.text()).toBe("offline page");
  });

  // Next.js renders /offline per request (next-intl reads the locale cookie), so the
  // real response carries private/no-store. The fallback must still be cached at install
  // and re-cached after a logout purge, or an offline navigation gets the JSON 503.
  it("caches the /offline fallback despite Next.js private/no-store headers, at install and after CIVITASONE_PURGE", async () => {
    const NEXT_DYNAMIC_CC = "private, no-cache, no-store, max-age=0, must-revalidate";
    let online = true;
    const sw = boot(async (req) => {
      if (!online) throw new TypeError("offline");
      const path = new URL(req.url).pathname;
      if (path === "/offline") return new Response("offline page", { status: 200, headers: { "cache-control": NEXT_DYNAMIC_CC } });
      return new Response("<html>hello Asha</html>", { status: 200, headers: { "cache-control": NEXT_DYNAMIC_CC } });
    });
    const nav = new Proxy(new Request(`${ORIGIN}/hr/payroll`), { get: (t, k) => (k === "mode" ? "navigate" : (t as any)[k] instanceof Function ? (t as any)[k].bind(t) : (t as any)[k]) });

    await sw.install();
    // Only the public fallback is stored; the personalised shells ("/", "/dashboard") are not.
    expect(await sw.allCachedUrls()).toEqual([`${ORIGIN}/offline`]);
    online = false;
    expect(await (await sw.dispatchFetch(nav as Request))!.text()).toBe("offline page");

    online = true;
    await sw.dispatchMessage({ type: "CIVITASONE_PURGE" });
    expect(await sw.allCachedUrls()).toEqual([`${ORIGIN}/offline`]);
    online = false;
    const res = await sw.dispatchFetch(nav as Request);
    expect(res!.status).toBe(200);
    expect(await res!.text()).toBe("offline page");
  });

  it("does not cache a redirected /offline response (e.g. bounced to login)", async () => {
    const sw = boot(async () => {
      const r = new Response("login", { status: 200 });
      Object.defineProperty(r, "redirected", { value: true });
      return r;
    });
    await sw.install();
    await sw.dispatchMessage({ type: "CIVITASONE_PURGE" });
    expect(await sw.allCachedUrls()).toEqual([]);
  });

  it("ignores CIVITASONE_PURGE from a foreign origin or a message with no source", async () => {
    const sw = boot(async () => new Response("x", { status: 200 }));
    sw.caches.set("civitasone-shell-v1", new FakeCache());
    await sw.caches.get("civitasone-shell-v1")!.put(`${ORIGIN}/a`, new Response("secret"));
    await sw.dispatchMessage({ type: "CIVITASONE_PURGE" }, "https://evil.test/page");
    await sw.dispatchMessage({ type: "CIVITASONE_PURGE" }, null);
    await sw.dispatchMessage({ type: "CIVITASONE_PURGE" }, "not a url");
    expect(sw.caches.get("civitasone-shell-v1")!.store.has(`${ORIGIN}/a`)).toBe(true);
    await sw.dispatchMessage({ type: "CIVITASONE_PURGE" });
    expect(sw.caches.has("civitasone-shell-v1")).toBe(false);
  });

  it("purges every civitasone-* cache on CIVITASONE_PURGE and leaves foreign caches alone", async () => {
    const sw = boot(async () => new Response("x", { status: 200 }));
    for (const n of ["civitasone-shell-v1", "civitasone-data-v1", "civitasone-static-v1", "other-app-cache"]) {
      await (await (async () => sw.caches.get(n) ?? sw.caches.set(n, new FakeCache()).get(n)!)()).put(`${ORIGIN}/a`, new Response("secret"));
    }
    await sw.dispatchMessage({ type: "CIVITASONE_PURGE" });
    expect([...sw.caches.keys()].filter((k) => k.startsWith("civitasone-") && sw.caches.get(k)!.store.has(`${ORIGIN}/a`))).toEqual([]);
    expect(sw.caches.has("other-app-cache")).toBe(true);
  });
});
