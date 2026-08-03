import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const routesSrc = readFileSync(
  resolve(__dirname, "../src/modules/custom-fields/routes.ts"),
  "utf8",
);

describe("F3-B2 custom-fields CQRS", () => {
  it("routes have zero sync drizzle writes", () => {
    expect(routesSrc).not.toMatch(/\bdb\.(insert|update|delete|execute)\b/);
    expect(routesSrc).not.toMatch(/repo\.(insert|update|remove)\s*\(\s*db/);
    expect(routesSrc).toMatch(/sendAccepted/);
    expect(routesSrc).toMatch(/commands\.(create|update|delete)CustomField/);
  });

  it("commands + consumer files exist with topics", () => {
    const commands = readFileSync(resolve(__dirname, "../src/modules/custom-fields/commands.ts"), "utf8");
    const consumer = readFileSync(resolve(__dirname, "../src/modules/custom-fields/consumer.ts"), "utf8");
    expect(commands).toMatch(/COMMANDS\.createCustomField/);
    expect(consumer).toMatch(/markProcessed/);
    expect(consumer).toMatch(/registerCustomFieldConsumers/);
  });
});
