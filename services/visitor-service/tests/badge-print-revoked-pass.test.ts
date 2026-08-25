/**
 * Tests for modules/badge-print/consumer.ts — revoked-pass guard.
 *
 * printJobCreate (consumer.ts) loads the digital_passes row purely to read
 * badge data (qrJwt, validFrom/validUntil, permittedAreas, passNumber) — it
 * never inspects `pass.status` or `pass.revoked`. Confirmed by static
 * search: `grep -n 'revoked' src/modules/badge-print/{routes,consumer}.ts`
 * returns zero matches in this module. digital-pass/consumer.ts's
 * passRevoke handler sets BOTH status:"revoked" and revoked:true (plus
 * revokedAt/revokeReason) when a pass is revoked, so this fixture mirrors
 * that real post-revocation shape.
 *
 * Net effect: a security guard (or attacker with a stale device credential)
 * can print a fully legitimate-looking physical badge — visitor name, QR
 * code, permitted areas — for a pass that has already been revoked (lost
 * card, security incident, visitor banned mid-visit, etc.). The printed
 * badge's own QR JWT would presumably fail a *scan* against the revoked
 * pass at a turnstile, but the physical badge itself still gets produced
 * and handed out, which is the exact failure mode Requirement 5.x badge
 * printing should prevent for a REVOKED pass.
 *
 * This mirrors the existing tests/badge-print-consumer.test.ts mock-tx /
 * MemoryQueue harness exactly (same fixture shapes, same mocking
 * convention) so it drops into the existing test suite style. The
 * `it.fails()` block encodes the CORRECT behavior (revoked pass -> no
 * print job created) and fails today because the guard doesn't exist;
 * vitest's `.fails()` inversion keeps the suite green until it's added —
 * flip it to a plain `it()` once the consumer gains the check.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryQueue } from "@civitasone/queue";

const markProcessedMock = vi.fn(async () => true);
const enqueueMock = vi.fn(async () => undefined);
const versionedUpdateMock = vi.fn(async () => undefined);

let templateRow: Record<string, unknown> | undefined;
let passRow: Record<string, unknown> | undefined;
let visitRow: Record<string, unknown> | undefined;

let selectCallIdx = 0;

function makeSelectChain(rows: Record<string, unknown>[]) {
  return {
    from: () => ({
      where: () => ({
        limit: async () => rows,
      }),
    }),
  };
}

const insertedPrintJobs: Record<string, unknown>[] = [];

const fakeTx = {
  select: vi.fn(() => {
    selectCallIdx++;
    // Order of selects in printJobCreate: template, pass, visit
    if (selectCallIdx === 1) return makeSelectChain(templateRow ? [templateRow] : []);
    if (selectCallIdx === 2) return makeSelectChain(passRow ? [passRow] : []);
    return makeSelectChain(visitRow ? [visitRow] : []);
  }),
  insert: vi.fn(() => ({
    values: vi.fn(async (row: Record<string, unknown>) => {
      insertedPrintJobs.push(row);
    }),
  })),
  update: vi.fn(() => ({ set: () => ({ where: async () => undefined }) })),
};

vi.mock("../src/shared/db.js", () => ({
  db: {
    transaction: async (fn: (tx: unknown) => unknown) => fn(fakeTx),
  },
}));

vi.mock("../src/shared/outbox.js", () => ({
  markProcessed: (...args: unknown[]) => markProcessedMock(...args),
  enqueue: (...args: unknown[]) => enqueueMock(...args),
  versionedUpdate: (...args: unknown[]) => versionedUpdateMock(...args),
}));

vi.mock("../src/shared/infra.js", () => ({
  queue: { publish: vi.fn(async () => undefined) },
  cache: { invalidate: vi.fn(async () => undefined), makeKey: (...args: unknown[]) => args.join(":") },
}));

vi.mock("../src/modules/badge-print/renderer.js", () => ({
  renderBadge: (_body: string, _data: unknown) => "RENDERED_ZPL_PAYLOAD",
  validateTemplatePlaceholders: () => ({ valid: true, invalidPlaceholders: [] }),
}));

vi.mock("../src/modules/badge-print/domain.js", () => ({
  computeJobScore: (_priority: string, _now: Date) => 100,
  shouldRetry: (retryCount: number) => retryCount < 3,
  computeNextRetryAt: (_retryCount: number, _now: Date) => new Date("2025-06-15T12:00:00Z"),
  createNewVersion: (current: { templateVersion: number; id: string }) => ({
    templateVersion: current.templateVersion + 1,
    previousVersionId: current.id,
  }),
}));

vi.mock("ioredis", () => ({
  Redis: vi.fn(() => null),
}));

const { registerBadgePrintConsumers } = await import("../src/modules/badge-print/consumer.js");
const { COMMANDS } = await import("../src/topics.js");

const TENANT = "11111111-1111-1111-1111-111111111111";
const ACTOR = "22222222-2222-2222-2222-222222222222";
const TEMPLATE_ID = "33333333-3333-3333-3333-333333333333";
const PASS_ID = "44444444-4444-4444-4444-444444444444";
const VISIT_ID = "55555555-5555-5555-5555-555555555555";
const JOB_ID = "66666666-6666-6666-6666-666666666666";
const DEVICE_ID = "77777777-7777-7777-7777-777777777777";

function freshQueue(): MemoryQueue {
  const queue = new MemoryQueue();
  registerBadgePrintConsumers(queue);
  return queue;
}

async function publishAndFlush(queue: MemoryQueue, topic: string, payload: unknown, waitMs = 20): Promise<void> {
  await queue.publish(topic, {
    type: topic,
    tenantId: TENANT,
    actorId: ACTOR,
    correlationId: "corr-1",
    schemaVersion: "1.0",
    payload,
  });
  await new Promise((r) => setTimeout(r, waitMs));
}

beforeEach(() => {
  markProcessedMock.mockReset().mockResolvedValue(true);
  enqueueMock.mockReset().mockResolvedValue(undefined);
  versionedUpdateMock.mockReset().mockResolvedValue(undefined);
  fakeTx.select.mockClear();
  fakeTx.insert.mockClear();
  fakeTx.update.mockClear();
  selectCallIdx = 0;
  insertedPrintJobs.length = 0;

  templateRow = {
    id: TEMPLATE_ID, tenantId: TENANT, name: "Standard Badge", printerLanguage: "zpl",
    templateBody: "^XA{{visitor_name}}^XZ", badgeWidthMm: 86, badgeHeightMm: 54,
    visitorCategory: "standard", status: "active", templateVersion: 1, version: 1,
  };

  // Realistic post-revocation shape: passRevoke (digital-pass/consumer.ts)
  // sets BOTH status:"revoked" and revoked:true (+ revokedAt/revokeReason).
  passRow = {
    id: PASS_ID, tenantId: TENANT, visitRequestId: VISIT_ID, locationId: "loc-1",
    passNumber: "VP-001", qrJwt: "jwt-token", permittedAreas: ["area-1", "area-2"],
    validFrom: new Date("2025-06-15T08:00:00Z"), validUntil: new Date("2025-06-15T18:00:00Z"),
    status: "revoked", revoked: true, revokedAt: new Date("2025-06-15T09:00:00Z"),
    revokeReason: "visitor banned mid-visit — security incident",
  };

  visitRow = {
    id: VISIT_ID, tenantId: TENANT, visitorName: "Jane Doe",
    hostEmployeeId: "host-1", visitorCategory: "standard",
  };
});

describe("printJobCreate — revoked-pass guard (badge-print / digital-pass boundary)", () => {
  const createPayload = {
    id: JOB_ID, tenantId: TENANT, passId: PASS_ID, deviceId: DEVICE_ID,
    priority: "standard", printerLanguage: "zpl", visitorCategory: "standard",
  };

  it("sanity check: an ACTIVE pass is allowed to print (baseline, not the bug)", async () => {
    passRow = { ...passRow, status: "active", revoked: false, revokedAt: null, revokeReason: null };
    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.printJobCreate, createPayload);

    expect(insertedPrintJobs).toHaveLength(1);
  });

  it(
    "[FIXED] a REVOKED pass must NOT produce a printable badge",
    async () => {
      // passRow is already revoked (status:"revoked", revoked:true) from beforeEach.
      const queue = freshQueue();
      await publishAndFlush(queue, COMMANDS.printJobCreate, createPayload);

      // Correct behavior: the consumer should reject/dead-letter this and
      // insert nothing. Today it renders and queues the badge exactly as
      // it would for an active pass.
      expect(insertedPrintJobs).toHaveLength(0);
    },
  );
});
