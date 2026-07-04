/**
 * @civitasone/search — Unit tests for the search adapter.
 *
 * Tests the Meilisearch and OpenSearch engines against mock HTTP/client
 * responses, plus the factory function and interface contracts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createSearchEngine, MeilisearchEngine, OpenSearchEngine } from "../src/index.js";
import type { SearchDocument, SearchQuery } from "../src/types.js";

// ─────────────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────────────
describe("createSearchEngine", () => {
  const origEnv = process.env.SEARCH_ENGINE;

  afterEach(() => {
    if (origEnv === undefined) delete process.env.SEARCH_ENGINE;
    else process.env.SEARCH_ENGINE = origEnv;
  });

  it("defaults to MeilisearchEngine when SEARCH_ENGINE is unset", () => {
    delete process.env.SEARCH_ENGINE;
    const engine = createSearchEngine();
    expect(engine).toBeInstanceOf(MeilisearchEngine);
  });

  it("creates MeilisearchEngine when SEARCH_ENGINE=meilisearch", () => {
    process.env.SEARCH_ENGINE = "meilisearch";
    const engine = createSearchEngine();
    expect(engine).toBeInstanceOf(MeilisearchEngine);
  });

  it("creates OpenSearchEngine when SEARCH_ENGINE=opensearch", () => {
    process.env.SEARCH_ENGINE = "opensearch";
    const engine = createSearchEngine();
    expect(engine).toBeInstanceOf(OpenSearchEngine);
  });

  it("respects explicit provider parameter over env", () => {
    process.env.SEARCH_ENGINE = "meilisearch";
    const engine = createSearchEngine("opensearch");
    expect(engine).toBeInstanceOf(OpenSearchEngine);
  });

  it("throws on unknown provider", () => {
    expect(() => createSearchEngine("elasticsearch" as never)).toThrow(/Unknown search engine/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// MeilisearchEngine
// ─────────────────────────────────────────────────────────────────────────────
describe("MeilisearchEngine", () => {
  let engine: MeilisearchEngine;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    engine = new MeilisearchEngine({ host: "http://meili-test:7700", apiKey: "test-key" });
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("initialize creates index if 404", async () => {
    fetchSpy
      .mockResolvedValueOnce(new Response("", { status: 404 })) // GET index → 404
      .mockResolvedValueOnce(new Response(JSON.stringify({ taskUid: 1 }), { status: 202 })) // POST create
      .mockResolvedValueOnce(new Response(JSON.stringify({ taskUid: 2 }), { status: 202 })); // PATCH settings

    await engine.initialize({ indexName: "test_docs" });

    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(fetchSpy.mock.calls[1]![0]).toContain("/indexes");
  });

  it("initialize skips creation if index exists", async () => {
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ uid: "knowledge_documents" }), { status: 200 }));

    await engine.initialize();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("search returns hits with scores", async () => {
    const meiliResponse = {
      hits: [
        { id: "abc", documentId: "doc-1", title: "Budget", content: "FY 2026", tags: ["finance"], _rankingScore: 0.95 },
      ],
      estimatedTotalHits: 1,
      processingTimeMs: 5,
    };
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify(meiliResponse), { status: 200 }));

    const result = await engine.search({
      q: "budget",
      tenantId: "tenant-1",
      limit: 10,
      offset: 0,
    });

    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]!.documentId).toBe("doc-1");
    expect(result.hits[0]!.score).toBe(0.95);
    expect(result.totalHits).toBe(1);
    expect(result.processingTimeMs).toBe(5);
  });

  it("search throws on non-200 response", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("", { status: 500 }));

    await expect(engine.search({ q: "test", tenantId: "t1" })).rejects.toThrow(/500/);
  });

  it("index sends document to Meilisearch", async () => {
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ taskUid: 1 }), { status: 202 }));

    const doc: SearchDocument = {
      id: "id-1",
      tenantId: "t-1",
      documentId: "d-1",
      title: "Test Doc",
      content: "Hello world",
      tags: ["test"],
    };

    await engine.index(doc);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchSpy.mock.calls[0]!;
    expect(url).toContain("/indexes/knowledge_documents/documents");
    expect(opts!.method).toBe("POST");
    const body = JSON.parse(opts!.body as string) as unknown[];
    expect(body).toHaveLength(1);
  });

  it("healthy returns true on 200", async () => {
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ status: "available" }), { status: 200 }));
    expect(await engine.healthy()).toBe(true);
  });

  it("healthy returns false on network error", async () => {
    fetchSpy.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    expect(await engine.healthy()).toBe(false);
  });

  it("search includes category and tags in filter", async () => {
    const meiliResponse = { hits: [], estimatedTotalHits: 0, processingTimeMs: 1 };
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify(meiliResponse), { status: 200 }));

    await engine.search({
      q: "leave",
      tenantId: "t1",
      category: "hr",
      tags: ["attendance", "geo"],
    });

    const body = JSON.parse(fetchSpy.mock.calls[0]![1]!.body as string) as { filter: string[] };
    expect(body.filter).toContain('tenantId = "t1"');
    expect(body.filter).toContain('category = "hr"');
    expect(body.filter.some((f: string) => f.includes("attendance"))).toBe(true);
  });

  it("bulkIndex sends documents in batches", async () => {
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({ taskUid: 1 }), { status: 202 }));

    const docs: SearchDocument[] = Array.from({ length: 5 }, (_, i) => ({
      id: `id-${i}`,
      tenantId: "t1",
      documentId: `doc-${i}`,
      title: `Doc ${i}`,
      content: `Content ${i}`,
      tags: [],
    }));

    await engine.bulkIndex(docs);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchSpy.mock.calls[0]![1]!.body as string) as unknown[];
    expect(body).toHaveLength(5);
  });

  it("remove sends delete request with filter", async () => {
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ taskUid: 1 }), { status: 202 }));

    await engine.remove("t1", "doc-1");

    const [url, opts] = fetchSpy.mock.calls[0]!;
    expect(url).toContain("/documents/delete");
    const body = JSON.parse(opts!.body as string) as { filter: string };
    expect(body.filter).toContain("t1");
    expect(body.filter).toContain("doc-1");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// OpenSearchEngine — constructor and interface shape
// ─────────────────────────────────────────────────────────────────────────────
describe("OpenSearchEngine", () => {
  it("constructs without error", () => {
    const engine = new OpenSearchEngine({ node: "http://localhost:9200" });
    expect(engine).toBeInstanceOf(OpenSearchEngine);
  });

  it("implements SearchEngine interface (all methods exist)", () => {
    const engine = new OpenSearchEngine({ node: "http://localhost:9200" });
    expect(typeof engine.initialize).toBe("function");
    expect(typeof engine.index).toBe("function");
    expect(typeof engine.bulkIndex).toBe("function");
    expect(typeof engine.search).toBe("function");
    expect(typeof engine.remove).toBe("function");
    expect(typeof engine.removeAll).toBe("function");
    expect(typeof engine.healthy).toBe("function");
    expect(typeof engine.close).toBe("function");
  });

  it("healthy returns false when OpenSearch is not running", async () => {
    const engine = new OpenSearchEngine({ node: "http://localhost:19999" });
    const result = await engine.healthy();
    expect(result).toBe(false);
  });
});
