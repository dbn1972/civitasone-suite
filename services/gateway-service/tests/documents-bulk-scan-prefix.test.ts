import { describe, it, expect } from "vitest";
import { resolveRoute } from "../src/registry.js";

// Bulk scan (document-service modules/bulk-scan) is served under /v1/documents/bulk-scan/*. The web reaches it through the
// BFF proxy as /api/proxy/v1/documents/bulk-scan/* -> gateway /api/v1/documents/bulk-scan/*. No dedicated registry entry is
// needed (the existing `documents` prefix already forwards the remainder); this pins that every bulk-scan route group
// resolves to document-service at the path the service registers, so a registry refactor cannot silently break the UI.
describe("documents prefix carries bulk-scan", () => {
  it.each([
    "/api/v1/documents/bulk-scan/batches",
    "/api/v1/documents/bulk-scan/settings",
    "/api/v1/documents/bulk-scan/review-queue",
    "/api/v1/documents/bulk-scan/batches/b1/files/f1/review/approve",
    "/api/v1/documents/bulk-scan/links/l1/unlink-request",
    "/api/v1/documents/bulk-scan/link-lookup",
    "/api/v1/documents/bulk-scan/search",
    "/api/v1/documents/bulk-scan/providers",
    "/api/v1/documents/bulk-scan/files/d1/download",
    "/api/v1/documents/bulk-scan/files/d1/pages/2/image",
  ])("%s -> document-service /v1/documents%s", (path) => {
    const resolved = resolveRoute(path);
    expect(resolved).not.toBeNull();
    expect(resolved!.route.name).toBe("documents");
    expect(resolved!.route.upstreamPath).toBeUndefined();                        // default: prefix without /api
    expect(path.replace(/^\/api/, "")).toBe("/v1/documents" + resolved!.remainder);
  });
});
