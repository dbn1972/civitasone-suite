import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("F3-B2 identity MFA/SCIM CQRS", () => {
  it("mfa routes have zero sync drizzle writes", () => {
    const src = readFileSync(resolve(__dirname, "../src/modules/mfa/routes.ts"), "utf8");
    expect(src).not.toMatch(/\bdb\.(insert|update|delete|execute|transaction)\b/);
    expect(src).toMatch(/setupMfa|recordMfaVerify/);
  });

  it("scim routes have zero sync drizzle writes", () => {
    const src = readFileSync(resolve(__dirname, "../src/modules/scim/routes.ts"), "utf8");
    expect(src).not.toMatch(/\bdb\.(insert|update|delete|execute|transaction)\b/);
    expect(src).toMatch(/commands\.scim/);
  });

  it("consumers markProcessed", () => {
    const mfa = readFileSync(resolve(__dirname, "../src/modules/mfa/consumer.ts"), "utf8");
    const scim = readFileSync(resolve(__dirname, "../src/modules/scim/consumer.ts"), "utf8");
    expect(mfa).toMatch(/markProcessed/);
    expect(scim).toMatch(/markProcessed/);
  });
});
