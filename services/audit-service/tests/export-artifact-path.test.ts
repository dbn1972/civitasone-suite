import { describe, it, expect } from "vitest";
import path from "node:path";

/**
 * CodeQL js/path-injection (#930 #931): the export artifact path is built only from validated
 * UUIDs + a fixed extension allow-list and must never resolve outside EXPORT_DIR.
 */
const { exportArtifactPath } = await import("../src/modules/exports/routes.js");

const T = globalThis.crypto.randomUUID();
const E = globalThis.crypto.randomUUID();
const BASE = path.resolve(process.env.EXPORT_DIR ?? "/tmp/audit-exports");

describe("exportArtifactPath", () => {
  it("builds <EXPORT_DIR>/<tenant>/<id>.<fmt> for valid inputs", () => {
    expect(exportArtifactPath(T, E, "json")).toBe(path.join(BASE, T, `${E}.json`));
    expect(exportArtifactPath(T, E, "csv")).toBe(path.join(BASE, T, `${E}.csv`));
  });
  it.each(["..", "../x", "a/b", "", "%2e%2e", "T".repeat(36), `${T}/../..`])("rejects tenant %j", (t) => {
    expect(exportArtifactPath(t, E, "json")).toBeNull();
  });
  it.each(["..", "../../etc/passwd", `${E}/..`, ""])("rejects export id %j", (id) => {
    expect(exportArtifactPath(T, id, "json")).toBeNull();
  });
  it.each(["", "sh", "json/../../x", "JSON", "json\0"])("rejects format %j", (f) => {
    expect(exportArtifactPath(T, E, f)).toBeNull();
  });
});
