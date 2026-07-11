import { describe, expect, it } from "vitest";
import {
  enqueue,
  markProcessed,
  outboxMessages,
  processed,
  startRelay,
  versionedUpdate,
  VersionConflictError,
} from "../src/shared/outbox.js";

describe("outbox re-exports (@civitasone/outbox canonical implementation)", () => {
  it("re-exports the outbox/inbox tables and core helpers", () => {
    expect(outboxMessages).toBeDefined();
    expect(processed).toBeDefined();
    expect(typeof enqueue).toBe("function");
    expect(typeof markProcessed).toBe("function");
    expect(typeof startRelay).toBe("function");
  });
});

describe("versionedUpdate / optimistic locking", () => {
  it("exposes versionedUpdate as a function", () => {
    expect(typeof versionedUpdate).toBe("function");
  });

  it("VersionConflictError carries a 409 status and structured fields", () => {
    const err = new VersionConflictError("meeting", "11111111-1111-1111-1111-111111111111", 3);
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("VERSION_CONFLICT");
    expect(err.httpStatus).toBe(409);
    expect(err.entity).toBe("meeting");
    expect(err.expectedVersion).toBe(3);
    expect(err.message).toContain("expected version 3");
  });
});
