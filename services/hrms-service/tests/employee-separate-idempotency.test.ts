/**
 * HIGH regression: separateEmployee() (employee/commands.ts) used to publish
 * via bare queue.publish() with no explicit messageId -- the queue
 * auto-mints a fresh random one per call, so a retried or double-clicked
 * Separate action for the SAME employee produced a SECOND, unrelated
 * messageId that sailed straight past the queue's own idempotency dedup
 * (markProcessed), letting the consumer re-run the whole separation
 * transaction (including re-publishing hrms.employee.separated, which
 * payroll-service reacts to by computing a Full & Final settlement) a
 * second time.
 *
 * Mirrors recruitment-hire-idempotency.test.ts's shape for the same class of
 * fix (PR #1542's hireApplication). This is the commands.ts (publish-side)
 * half; the consumer-side markProcessed guard is exercised in
 * employee-consumer.test.ts's employeeSeparate suite.
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

import { separateEmployee } from "../src/modules/employee/commands.js";
import type { SeparateBody } from "../src/modules/lifecycle/validators.js";
import type { RequestContext } from "@civitasone/types";

const TENANT = "10000000-aaaa-4000-8000-000000000001";
const ACTOR = "20000000-bbbb-4000-8000-000000000001";

function ctx(correlationId = randomUUID()): RequestContext {
  return { tenantId: TENANT, actorId: ACTOR, correlationId } as unknown as RequestContext;
}

function body(overrides: Partial<SeparateBody> = {}): SeparateBody {
  return {
    separationType: "retirement", effectiveDate: "2026-06-30",
    encashmentDays: 200, ...overrides,
  } as SeparateBody;
}

beforeEach(() => { vi.clearAllMocks(); });

describe("HIGH: separateEmployee derives a deterministic messageId", () => {
  it("produces the SAME messageId for two calls with the same employeeId + effectiveDate (retry / double-click)", async () => {
    const employeeId = randomUUID();
    await separateEmployee(ctx(), employeeId, body());
    await separateEmployee(ctx(), employeeId, body());

    expect(publishMock).toHaveBeenCalledTimes(2);
    const first = publishMock.mock.calls[0]![1] as { messageId: string };
    const second = publishMock.mock.calls[1]![1] as { messageId: string };

    // The actual dedup key: same messageId means the queue's own
    // markProcessed (INSERT ... ON CONFLICT DO NOTHING) rejects the second
    // publish as already-seen before the consumer ever re-runs the
    // separation transaction a second time -- this is what a fresh
    // randomUUID() per call defeated.
    expect(first.messageId).toBe(second.messageId);
  });

  it("produces a DIFFERENT messageId for a different employeeId", async () => {
    const first = publishAndGetMessageId(await separateEmployee(ctx(), randomUUID(), body()), 0);
    const second = publishAndGetMessageId(await separateEmployee(ctx(), randomUUID(), body()), 1);
    expect(first).not.toBe(second);
  });

  // The reinstate-then-separate-again case: lifecycle/consumer.ts's
  // COMMANDS.lifecycleReinstate lets a terminated/separated/retired employee
  // return to active service, after which they can legitimately be
  // separated again. Keying on employeeId ALONE would make that second,
  // genuine separation collide with (and be silently dropped by) the dedup
  // guard for the first. Including effectiveDate avoids that false
  // collision while still deduping real retries (which always resubmit the
  // same effectiveDate).
  it("produces a DIFFERENT messageId for the same employeeId with a different effectiveDate", async () => {
    const employeeId = randomUUID();
    await separateEmployee(ctx(), employeeId, body({ effectiveDate: "2026-06-30" }));
    await separateEmployee(ctx(), employeeId, body({ effectiveDate: "2027-09-15" }));

    const first = publishMock.mock.calls[0]![1] as { messageId: string };
    const second = publishMock.mock.calls[1]![1] as { messageId: string };
    expect(first.messageId).not.toBe(second.messageId);
  });

  it("the derived messageId is a syntactically valid v5 UUID (outbox messageId column is typed uuid)", async () => {
    await separateEmployee(ctx(), randomUUID(), body());
    const { messageId } = publishMock.mock.calls[0]![1] as { messageId: string };
    expect(messageId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });
});

function publishAndGetMessageId(_result: unknown, callIndex: number): string {
  return (publishMock.mock.calls[callIndex]![1] as { messageId: string }).messageId;
}
