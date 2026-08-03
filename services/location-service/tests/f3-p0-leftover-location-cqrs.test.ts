import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MOD = join(__dirname, "../src/modules");

describe("F3 P0 leftover location CQRS", () => {
  it("road/map/spatial mutation routes return 202 / sendAccepted", () => {
    const road = readFileSync(join(MOD, "road-network/routes.ts"), "utf8");
    const map = readFileSync(join(MOD, "map-markers/routes.ts"), "utf8");
    const spatial = readFileSync(join(MOD, "spatial-exchange/routes.ts"), "utf8");
    expect(road).not.toContain("code(201)");
    expect(map).not.toContain("code(201)");
    expect(spatial).not.toContain("code(201)");
    expect(road).toContain("sendAccepted");
    expect(map).toContain("code(202)");
    expect(spatial).toContain("sendAccepted");
    expect(map).not.toContain("upsertGeoPoint");
  });

  it("consumers present", () => {
    expect(readFileSync(join(MOD, "road-network/consumer.ts"), "utf8")).toContain("markProcessed");
    expect(readFileSync(join(MOD, "spatial-exchange/consumer.ts"), "utf8")).toContain("markProcessed");
  });
});
