import { describe, it, expect } from "vitest";
import { knownServiceTone, serviceBucket, serviceStatusTone, countServiceBuckets, tenantStatusTone } from "./serviceStatus";

describe("service status vocabulary", () => {
  it("maps PM2 and health vocabularies explicitly", () => {
    expect(serviceBucket("running")).toBe("up");
    expect(serviceBucket("online")).toBe("up");
    expect(serviceBucket("errored")).toBe("down");
    expect(serviceBucket("stopped")).toBe("down");
    expect(serviceBucket("degraded")).toBe("degraded");
    expect(serviceBucket("Degraded ")).toBe("degraded");
  });
  it("puts an unrecognised status in unknown, not degraded", () => {
    expect(serviceBucket("foo")).toBe("unknown");
    expect(serviceBucket(undefined)).toBe("unknown");
    expect(countServiceBuckets([{ status: "running" }, { status: "foo" }, { status: "online" }, { status: "stopped" }]))
      .toEqual({ up: 2, degraded: 0, down: 1, unknown: 1 });
  });
  it("tones", () => {
    expect(serviceStatusTone("running")).toBe("good");
    expect(serviceStatusTone("stopped")).toBe("bad");
    expect(serviceStatusTone("degraded")).toBe("warn");
    expect(serviceStatusTone("foo")).toBe("mut");
  });
  it("tenant tones: trial amber, suspended red, active green", () => {
    expect(tenantStatusTone("trial")).toBe("warn");
    expect(tenantStatusTone("Suspended")).toBe("bad");
    expect(tenantStatusTone("active")).toBe("good");
  });  it("knownServiceTone defers to the shared map for words outside the vocabulary", () => {
    expect(knownServiceTone("degraded")).toBe("warn");
    expect(knownServiceTone("active")).toBeUndefined();
    expect(knownServiceTone("pending")).toBeUndefined();
  });
});
