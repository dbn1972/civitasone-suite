/**
 * BUG-3 regression: hireApplication() (recruitment/commands.ts) must derive a
 * STABLE messageId/employeeId from the applicationId, not a fresh
 * randomUUID() on every call -- otherwise a retried or double-clicked Hire
 * action for the SAME application mints a different messageId each time,
 * sailing straight past the queue's own idempotency dedup (packages/outbox's
 * markProcessed, an atomic `INSERT ... ON CONFLICT DO NOTHING RETURNING`
 * keyed on messageId -- see bus.ts) and letting the hire consumer create a
 * second employee record for one application.
 *
 * This is the commands.ts (publish-side) half of the BUG-3 fix. The
 * consumer-side guard (claimApplicationForHire, an atomic application-status
 * UPDATE) is covered separately in recruitment-consumer.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";

const { publishMock } = vi.hoisted(() => ({
  publishMock: vi.fn(async () => "ok"),
}));

vi.mock("../src/shared/infra.js", () => ({
  queue: { publish: (...a: any[]) => publishMock(...a) },
  cache: { invalidate: vi.fn(async () => undefined), makeKey: (...p: string[]) => p.join(":") },
}));

import { hireApplication } from "../src/modules/recruitment/commands.js";
import type { HireApplicationBody } from "../src/modules/recruitment/validators.js";
import type { RequestContext } from "@civitasone/types";

const TENANT = "10000000-aaaa-4000-8000-000000000001";
const ACTOR = "20000000-bbbb-4000-8000-000000000001";

function ctx(correlationId = randomUUID()): RequestContext {
  return { tenantId: TENANT, actorId: ACTOR, correlationId } as unknown as RequestContext;
}

const body: HireApplicationBody = {
  employeeNo: "EMP-100", dateOfJoining: "2026-08-01", basicMinor: 5000000,
  departmentId: randomUUID(), designationId: randomUUID(), employeeType: "permanent",
};

beforeEach(() => { vi.clearAllMocks(); });

describe("BUG-3: hireApplication derives a deterministic employeeId/messageId", () => {
  it("produces the SAME messageId and payload.employeeId for two calls with the same applicationId", async () => {
    const applicationId = randomUUID();
    const first = await hireApplication(ctx(), applicationId, body);
    const second = await hireApplication(ctx(), applicationId, body);

    // The response id (== employeeId) must be stable across retries -- a
    // double-clicked Hire button should look idempotent to the caller too.
    expect(first.id).toBe(second.id);

    expect(publishMock).toHaveBeenCalledTimes(2);
    const firstEnvelope = publishMock.mock.calls[0]![1] as { messageId: string; payload: { employeeId: string } };
    const secondEnvelope = publishMock.mock.calls[1]![1] as { messageId: string; payload: { employeeId: string } };

    // The actual dedup key: same messageId means the queue's own
    // markProcessed (INSERT ... ON CONFLICT DO NOTHING) rejects the second
    // publish as already-seen before the consumer ever creates a second
    // employee -- this is what a fresh randomUUID() per call defeated.
    expect(firstEnvelope.messageId).toBe(secondEnvelope.messageId);
    expect(firstEnvelope.payload.employeeId).toBe(secondEnvelope.payload.employeeId);
    expect(firstEnvelope.messageId).toBe(first.id);
  });

  it("produces a DIFFERENT messageId for a different applicationId", async () => {
    const a = await hireApplication(ctx(), randomUUID(), body);
    const b = await hireApplication(ctx(), randomUUID(), body);
    expect(a.id).not.toBe(b.id);
  });

  it("the derived id is a syntactically valid UUID (envelope/employee-id columns are typed uuid)", async () => {
    // MEDIUM finding follow-up: hireApplication now derives this via
    // idempotentId() (@civitasone/auth, tenant-scoped since PR #1565)
    // instead of the ad hoc uuidV5() helper -- see this function's own doc
    // comment. idempotentId() slices a SHA-256 digest directly into
    // UUID-shaped groups without forcing an RFC 4122 version/variant
    // nibble, so this no longer asserts specifically "version 5" (it isn't
    // one any more) -- only what actually matters for a `uuid`-typed
    // column: the hex-and-hyphen shape.
    const result = await hireApplication(ctx(), randomUUID(), body);
    expect(result.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });
});
