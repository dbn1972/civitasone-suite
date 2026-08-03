/**
 * Regression: contract version creation is queue-first CQRS.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const modulePath = join(__dirname, "../src/modules/versions");
const routes = readFileSync(join(modulePath, "routes.ts"), "utf8");
const commands = readFileSync(join(modulePath, "commands.ts"), "utf8");
const consumer = readFileSync(join(modulePath, "consumer.ts"), "utf8");

describe("contract versions CQRS wiring", () => {
  it("creates versions through sendAccepted, not a synchronous 201 response", () => {
    const createRoute = /app\.post\("\/v1\/contract\/contracts\/:id\/versions"[\s\S]*?\n  \}\);/.exec(routes);

    expect(createRoute).not.toBeNull();
    expect(createRoute![0]).toContain("sendAccepted");
    expect(createRoute![0]).toContain("commands.createVersion");
    expect(createRoute![0]).not.toMatch(/reply\.code\(201\)/);
  });

  it("publishes a version-create command without repository inserts", () => {
    expect(commands).toContain("queue.publish(COMMANDS.versionCreate");
    expect(commands).toContain('status: "accepted"');
    expect(commands).not.toMatch(/repo\.insert(?:Version|Redlines)/);
  });

  it("persists idempotently in the consumer and emits the created event", () => {
    expect(consumer).toContain("markProcessed(tx, msg.messageId)");
    expect(consumer).toContain("tx.insert(contractVersions)");
    expect(consumer).toContain("tx.insert(redlines)");
    expect(consumer).toContain("EVENTS.versionCreated");
  });
});
