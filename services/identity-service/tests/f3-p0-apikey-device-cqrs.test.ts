import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "..");
const src = (rel: string) => readFileSync(resolve(root, rel), "utf8");

describe("F3 P0 identity apikey/device CQRS", () => {
  it("api key issue returns 202 via queue", () => {
    const routes = src("src/modules/apikeys/routes.ts");
    const commands = src("src/modules/apikeys/commands.ts");
    expect(routes).toMatch(/code\(202\)/);
    expect(routes).not.toMatch(/code\(201\)/);
    expect(commands).toMatch(/queue\.publish/);
    expect(commands).not.toMatch(/db\.transaction\(async \(tx\) => \{\s*await repo\.insert/);
  });

  it("device register publishes upsert and returns 202", () => {
    const routes = src("src/modules/devices/routes.ts");
    expect(routes).toMatch(/queue\.publish/);
    expect(routes).toMatch(/code\(202\)/);
    expect(routes).not.toMatch(/upsertDevice\(/);
  });

  it("worker registers consumers with markProcessed", () => {
    const worker = src("src/worker.ts");
    expect(worker).toMatch(/registerApiKeyConsumers/);
    expect(worker).toMatch(/registerDeviceConsumers/);
    expect(src("src/modules/apikeys/consumer.ts")).toMatch(/markProcessed/);
    expect(src("src/modules/devices/consumer.ts")).toMatch(/markProcessed/);
  });
});
