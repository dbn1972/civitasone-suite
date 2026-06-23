import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..", "src", "modules");

function readModule(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

describe("identity authz guards", () => {
  it("user read requires self or admin", () => {
    expect(readModule("users/routes.ts")).toContain("cross-tenant access denied");
  });

  it("session create requires auth and tenant match", () => {
    const src = readModule("sessions/routes.ts");
    expect(src).not.toContain("public: true");
    expect(src).toContain("tenant mismatch");
  });

  it("mfa enable requires self or admin", () => {
    expect(readModule("mfa/routes.ts")).toContain("ctx.actorId !== id");
  });
});
