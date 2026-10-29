/**
 * CLOS3-S6-11: an invalidate() that runs while a getOrLoad loader is in flight
 * must not be undone by that loader writing its (pre-update) result afterwards.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { Cache, MemoryCache, resetInflightMap } from "../src/index.js";

beforeEach(() => resetInflightMap());

function gate<T>() {
  let release!: (v: T) => void;
  const p = new Promise<T>((r) => { release = r; });
  return { p, release };
}
const mk = () => {
  const cache = new Cache({ service: "svc", store: new MemoryCache(), defaultTtlSeconds: 60 });
  return cache;
};

describe("getOrLoad vs invalidate race", () => {
  it("(a) does not write the stale value back after invalidate; next read reloads", async () => {
    const cache = mk();
    const key = cache.makeKey("t1", "item", "1");
    let source = "old";
    let loads = 0;
    const g = gate<void>();
    const loader = async () => { loads++; const v = source; await g.p; return v; };

    const first = cache.getOrLoad(key, loader);
    await Promise.resolve(); await Promise.resolve();
    source = "new";
    await cache.invalidate(key);
    g.release();
    expect(await first).toBe("old"); // the in-flight caller keeps what it read

    const second = await cache.getOrLoad(key, async () => { loads++; return source; });
    expect(second).toBe("new");
    expect(loads).toBe(2);
  });

  it("(b) same for getOrLoadWithNegative, including the null path", async () => {
    const cache = mk();
    const key = cache.makeKey("t1", "item", "2");
    let source: string | null = null;
    const g = gate<void>();
    const first = cache.getOrLoadWithNegative(key, async () => { const v = source; await g.p; return v; });
    await Promise.resolve(); await Promise.resolve();
    source = "created";
    await cache.invalidate(key);
    g.release();
    expect(await first).toBeNull();
    // the stale negative sentinel must not have been cached
    expect(await cache.getOrLoadWithNegative(key, async () => source)).toBe("created");

    const key2 = cache.makeKey("t1", "item", "3");
    let s2: string | null = "old";
    const g2 = gate<void>();
    const f2 = cache.getOrLoadWithNegative(key2, async () => { const v = s2; await g2.p; return v; });
    await Promise.resolve(); await Promise.resolve();
    s2 = "new";
    await cache.invalidate(key2);
    g2.release();
    expect(await f2).toBe("old");
    expect(await cache.getOrLoadWithNegative(key2, async () => s2)).toBe("new");
  });

  it("(c) invalidateResource during an in-flight load of a key under that resource", async () => {
    const cache = mk();
    const key = cache.makeKey("t1", "item", "4");
    let source = "old";
    const g = gate<void>();
    const first = cache.getOrLoad(key, async () => { const v = source; await g.p; return v; });
    await Promise.resolve(); await Promise.resolve();
    source = "new";
    await cache.invalidateResource("t1", "item");
    g.release();
    await first;
    expect(await cache.getOrLoad(key, async () => source)).toBe("new");
  });

  it("(d) a reader arriving after invalidate does not coalesce onto the stale in-flight load", async () => {
    const cache = mk();
    const key = cache.makeKey("t1", "item", "5");
    let source = "old";
    const g = gate<void>();
    const first = cache.getOrLoad(key, async () => { const v = source; await g.p; return v; });
    await Promise.resolve(); await Promise.resolve();
    source = "new";
    await cache.invalidate(key);
    const late = await cache.getOrLoad(key, async () => source);
    expect(late).toBe("new");
    g.release();
    await first;
    // and the stale loader finishing last must not clobber the fresh cached value
    expect(await cache.getOrLoad(key, async () => "SHOULD-NOT-LOAD")).toBe("new");
  });

  it("an unrelated key invalidated mid-load does not suppress caching", async () => {
    const cache = mk();
    const key = cache.makeKey("t1", "item", "6");
    const g = gate<void>();
    const first = cache.getOrLoad(key, async () => { await g.p; return "v"; });
    await Promise.resolve(); await Promise.resolve();
    await cache.invalidate(cache.makeKey("t1", "item", "other"));
    g.release();
    await first;
    expect(await cache.getOrLoad(key, async () => "reloaded")).toBe("v");
  });
});

describe("listOrLoad vs invalidateResource race", () => {
  it("does not write a pre-write list back after invalidateResource; next read reloads", async () => {
    const cache = mk();
    let source = ["old"];
    let loads = 0;
    const g = gate<void>();
    const first = cache.listOrLoad("t1", "item", "h", async () => { loads++; const v = source; await g.p; return { data: v }; });
    await Promise.resolve(); await Promise.resolve();
    source = ["new"];
    await cache.invalidateResource("t1", "item");
    g.release();
    expect((await first).data).toEqual(["old"]); // the in-flight caller keeps what it read

    const second = await cache.listOrLoad("t1", "item", "h", async () => { loads++; return { data: source }; });
    expect(second.data).toEqual(["new"]);
    expect(loads).toBe(2);
  });
});
