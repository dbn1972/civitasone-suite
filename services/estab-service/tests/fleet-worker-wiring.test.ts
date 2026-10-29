/**
 * UAT FQ9 #17: POST /v1/estab/fuel-logs, /trip-logs, /vehicle-documents and /driver-roster returned 202
 * but wrote nothing — the routes publish estab.fleet.* commands and no worker subscribed
 * (queue_publish_no_subscribers). Given the worker entrypoint, Then it registers the fleet consumers;
 * and given those consumers on a queue, Then every fleet command the routes publish has a subscriber.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Queue } from "@civitasone/queue";
import { registerFleetConsumers } from "../src/modules/fleet/consumer.js";
import { COMMANDS } from "../src/topics.js";

describe("estab worker wiring: fleet", () => {
  const src = readFileSync(join(import.meta.dirname, "..", "src", "worker.ts"), "utf8");

  it("imports and registers the fleet consumers", () => {
    expect(src).toMatch(/import \{ registerFleetConsumers \} from "\.\/modules\/fleet\/consumer\.js"/);
    expect(src).toMatch(/^registerFleetConsumers\(queue\);$/m);
  });

  it("subscribes every fleet command the routes publish", () => {
    const topics: string[] = [];
    const fake = { subscribe: (topic: string) => { topics.push(topic); } } as unknown as Queue;
    registerFleetConsumers(fake);
    expect(topics).toEqual(expect.arrayContaining([
      COMMANDS.fuelLogCreate, COMMANDS.tripLogCreate, COMMANDS.tripLogComplete,
      COMMANDS.vehicleDocCreate, COMMANDS.driverRosterCreate,
    ]));
  });
});
