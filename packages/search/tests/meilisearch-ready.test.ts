import { describe, it, expect, vi, afterEach } from "vitest";
import { MeilisearchEngine, SearchFilterError } from "../src/meilisearch.js";

afterEach(() => vi.unstubAllGlobals());
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });

describe("ensureReady", () => {
  it("creates a missing index, applies the settings (incl. kind) and waits for the settings task to succeed", async () => {
    const calls: string[] = [];
    let polls = 0;
    vi.stubGlobal("fetch", vi.fn(async (u: string, init: RequestInit) => {
      const path = u.replace("http://m", "");
      calls.push(`${init.method} ${path}`);
      if (init.method === "GET" && path === "/indexes/ix") return json({}, 404);
      if (init.method === "POST" && path === "/indexes") return json({ taskUid: 1 }, 202);
      if (init.method === "PATCH") { expect(JSON.parse(String(init.body)).filterableAttributes).toContain("kind"); return json({ taskUid: 2 }, 202); }
      if (path === "/tasks/1") return json({ status: "succeeded" });
      if (path === "/tasks/2") return json({ status: ++polls < 2 ? "processing" : "succeeded" });
      return json({}, 500);
    }));
    await new MeilisearchEngine({ host: "http://m", indexName: "ix" }).ensureReady();
    expect(polls).toBe(2); // it really waited for the asynchronous settings task
    expect(calls[calls.length - 1]).toBe("GET /tasks/2");
  });

  it("THROWS when the settings are rejected or the task fails (so a caller can retry later)", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: RequestInit) => init.method === "PATCH" ? json({}, 500) : json({}, 200)));
    await expect(new MeilisearchEngine({ host: "http://m", indexName: "ix" }).ensureReady()).rejects.toThrow(/settings failed/);
    vi.stubGlobal("fetch", vi.fn(async (u: string, init: RequestInit) => init.method === "PATCH" ? json({ taskUid: 9 }, 202) : u.endsWith("/tasks/9") ? json({ status: "failed", error: { message: "boom" } }) : json({}, 200)));
    await expect(new MeilisearchEngine({ host: "http://m", indexName: "ix" }).ensureReady()).rejects.toThrow(/failed: boom/);
  });
});

describe("search error typing", () => {
  it("invalid_search_filter -> SearchFilterError (code invalid_search_filter); other failures stay plain errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ code: "invalid_search_filter", message: "Attribute `kind` is not filterable" }, 400)));
    const e = new MeilisearchEngine({ host: "http://m" });
    const err = await e.search({ q: "x", tenantId: "t" }).catch((x: unknown) => x);
    expect(err).toBeInstanceOf(SearchFilterError);
    expect((err as SearchFilterError).code).toBe("invalid_search_filter");
    vi.stubGlobal("fetch", vi.fn(async () => json({ code: "internal" }, 500)));
    const other = await e.search({ q: "x", tenantId: "t" }).catch((x: unknown) => x);
    expect(other).not.toBeInstanceOf(SearchFilterError);
    expect((other as Error).message).toBe("Meilisearch search failed: 500");
  });
});
