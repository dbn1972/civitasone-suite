import { describe, it, expect, vi, afterEach } from "vitest";
import nextConfig from "../../../next.config.mjs";
import {
  NEXT_PAGE_REDIRECT_META_ID,
  __resetPageLifecycleForTests,
  isLeavingPage,
  runWhenPageSettled,
} from "./pageLifecycle";

function addRedirectMeta(): HTMLMetaElement {
  const meta = document.createElement("meta");
  meta.id = NEXT_PAGE_REDIRECT_META_ID;
  meta.httpEquiv = "refresh";
  meta.content = "0;url=/estab/list";
  document.head.appendChild(meta);
  return meta;
}

const tick = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  document.getElementById(NEXT_PAGE_REDIRECT_META_ID)?.remove();
  __resetPageLifecycleForTests();
});

// F132 (UAT-P2-D2)
describe("pageLifecycle", () => {
  it("runs the work once the loaded page is settled", async () => {
    const fn = vi.fn();
    runWhenPageSettled(fn);
    expect(fn).not.toHaveBeenCalled();
    await tick();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("skips the work on a page that is redirecting (Next.js redirect meta)", async () => {
    addRedirectMeta();
    const fn = vi.fn();
    runWhenPageSettled(fn);
    await tick();
    expect(fn).not.toHaveBeenCalled();
    expect(isLeavingPage()).toBe(true);
  });

  it("skips the work once the page is being unloaded", async () => {
    const fn = vi.fn();
    runWhenPageSettled(fn);
    window.dispatchEvent(new Event("pagehide"));
    await tick();
    expect(fn).not.toHaveBeenCalled();
  });

  it("a bfcache restore makes the page live again", () => {
    window.dispatchEvent(new Event("pagehide"));
    expect(isLeavingPage()).toBe(true);
    const restored = new Event("pageshow") as PageTransitionEvent;
    Object.defineProperty(restored, "persisted", { value: true });
    window.dispatchEvent(restored);
    expect(isLeavingPage()).toBe(false);
  });

  // Review of #2447 (HIGH): a cancelled unload ("Leave site?" -> Stay) must not
  // leave the page flagged as leaving, or the session warning stops for good.
  it("a (cancellable) beforeunload does not mark the page as leaving", async () => {
    window.dispatchEvent(new Event("beforeunload", { cancelable: true }));
    expect(isLeavingPage()).toBe(false);
    const fn = vi.fn();
    runWhenPageSettled(fn);
    await tick();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("becoming visible again clears a stale leaving flag", () => {
    window.dispatchEvent(new Event("pagehide"));
    expect(isLeavingPage()).toBe(true);
    const spy = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(isLeavingPage()).toBe(false);
    spy.mockRestore();
  });

  it("any pageshow (not only bfcache) marks the page live", () => {
    window.dispatchEvent(new Event("pagehide"));
    window.dispatchEvent(new Event("pageshow"));
    expect(isLeavingPage()).toBe(false);
  });

  it("cancel (unmount) prevents the work", async () => {
    const fn = vi.fn();
    const cancel = runWhenPageSettled(fn);
    cancel();
    await tick();
    expect(fn).not.toHaveBeenCalled();
  });

  it("waits for the load event while the document is still loading", async () => {
    const spy = vi.spyOn(document, "readyState", "get").mockReturnValue("loading");
    const fn = vi.fn();
    runWhenPageSettled(fn);
    await tick();
    expect(fn).not.toHaveBeenCalled();
    spy.mockReturnValue("complete");
    window.dispatchEvent(new Event("load"));
    await tick();
    expect(fn).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("/estab/files is a config-level 308 to /estab/list (no streamed shell to abort)", async () => {
    const cfg = nextConfig as unknown as { redirects: () => Promise<unknown> };
    const rules = (await cfg.redirects()) as Array<{ source: string; destination: string; permanent: boolean }>;
    expect(rules).toContainEqual({ source: "/estab/files", destination: "/estab/list", permanent: true });
    // only the exact grouping segment: /estab/files/new and /estab/files/:id keep working
    expect(rules.some((r) => r.source.startsWith("/estab/files/"))).toBe(false);
  });
});
