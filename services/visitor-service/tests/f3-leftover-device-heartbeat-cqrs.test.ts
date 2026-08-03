import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const ROOT = new URL("../src/modules/device-registry/", import.meta.url);

describe("F3 leftover visitor device heartbeat CQRS", () => {
  it("device-registry routes have no sync Drizzle writes", async () => {
    const source = await readFile(new URL("routes.ts", ROOT), "utf8");
    expect(source).not.toMatch(/\b(?:db|tx)\.(?:insert|update|delete)\s*\(/);
    expect(source).not.toMatch(/db\.transaction/);
    expect(source).toContain("publishDeviceHeartbeat");
  });

  it("consumer markProcessed precedes devices update for heartbeat", async () => {
    const source = await readFile(new URL("consumer.ts", ROOT), "utf8");
    const idx = source.indexOf("COMMANDS.deviceHeartbeat");
    const mp = source.indexOf("markProcessed", idx);
    const update = source.indexOf("tx.update(devices)", idx);
    expect(mp).toBeGreaterThan(-1);
    expect(update).toBeGreaterThan(mp);
  });
});
