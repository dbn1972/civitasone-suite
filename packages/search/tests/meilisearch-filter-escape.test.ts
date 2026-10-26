import { describe, it, expect, vi, afterEach } from "vitest";
import { MeilisearchEngine } from "../src/index.js";

describe("Meilisearch filter literal escaping (CodeQL alert 4105)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("a quote/backslash in tenantId can never break out of the quoted filter literal", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ hits: [], estimatedTotalHits: 0, processingTimeMs: 1 }), { status: 200 }));
    const engine = new MeilisearchEngine({ host: "http://meili.local", apiKey: "k" });

    await engine.search({ q: "x", tenantId: 't1" OR tenantId = "t2\\', category: 'a"b\\' });

    const body = JSON.parse(fetchSpy.mock.calls[0]![1]!.body as string) as { filter: string[] };
    for (const f of body.filter) {
      // exactly one opening and one closing quote around the value: no injected quote, no backslash
      expect(f.split('"').length - 1).toBe(2);
      expect(f).not.toContain("\\");
    }
  });
});
