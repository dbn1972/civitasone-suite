import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const routesSrc = readFileSync(
  resolve(__dirname, "../src/modules/security-incident/routes.ts"),
  "utf8",
);

describe("F3-B2 security-incident CQRS", () => {
  it("routes have zero sync drizzle writes", () => {
    expect(routesSrc).not.toMatch(/\bdb\.(insert|update|delete|execute|transaction)\b/);
    expect(routesSrc).not.toMatch(/tx\.(insert|update|delete)\b/);
    expect(routesSrc).toMatch(/sendAccepted/);
    expect(routesSrc).toMatch(/commands\./);
  });

  it("consumer uses markProcessed", () => {
    const consumer = readFileSync(
      resolve(__dirname, "../src/modules/security-incident/consumer.ts"),
      "utf8",
    );
    expect(consumer).toMatch(/markProcessed/);
    expect(consumer).toMatch(/registerSecurityIncidentConsumers/);
  });
});
