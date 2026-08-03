/**
 * DID-to-tenant mapping tests.
 *
 * Tests the pure domain function `resolveTenant` for DID resolution,
 * number normalization, and route-level CRUD for DID mappings.
 *
 * Validates: Requirements 15.2
 */
import { describe, it, expect, beforeEach } from "vitest";
import { MemoryQueue } from "@civitasone/queue";
import { resolveTenant, normalizeNumber, DEFAULT_TENANT_ID, type DidMapping } from "../src/modules/did/domain.js";
import {
  createDidMappingBody,
  createDidMappingPayload,
  deleteDidMappingPayload,
} from "../src/modules/did/validators.js";
import { COMMANDS } from "../src/topics.js";

const TENANT_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const TENANT_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const FALLBACK = "00000000-0000-0000-0000-000000000001";

const mappings: DidMapping[] = [
  { didNumber: "+918001112222", tenantId: TENANT_A, active: true },
  { didNumber: "+918003334444", tenantId: TENANT_B, active: true },
  { didNumber: "+918005556666", tenantId: TENANT_A, active: false }, // inactive
];

// ── normalizeNumber ───────────────────────────────────────────────

describe("normalizeNumber", () => {
  it("strips whitespace from phone numbers", () => {
    expect(normalizeNumber("+91 800 111 2222")).toBe("+918001112222");
  });

  it("strips dashes from phone numbers", () => {
    expect(normalizeNumber("+91-800-111-2222")).toBe("+918001112222");
  });

  it("strips parentheses from phone numbers", () => {
    expect(normalizeNumber("(+91)8001112222")).toBe("+918001112222");
  });

  it("keeps already-normalized numbers unchanged", () => {
    expect(normalizeNumber("+918001112222")).toBe("+918001112222");
  });

  it("handles empty string", () => {
    expect(normalizeNumber("")).toBe("");
  });

  it("handles mixed formatting", () => {
    expect(normalizeNumber("+91 (800) 111-2222")).toBe("+918001112222");
  });
});

// ── resolveTenant ─────────────────────────────────────────────────

describe("resolveTenant", () => {
  it("resolves a known DID to the correct tenant", () => {
    const result = resolveTenant("+918001112222", mappings, FALLBACK);
    expect(result).toBe(TENANT_A);
  });

  it("resolves a different known DID to its tenant", () => {
    const result = resolveTenant("+918003334444", mappings, FALLBACK);
    expect(result).toBe(TENANT_B);
  });

  it("falls back to defaultTenantId for unknown DID", () => {
    const result = resolveTenant("+919999999999", mappings, FALLBACK);
    expect(result).toBe(FALLBACK);
  });

  it("falls back when calleeNumber is empty", () => {
    const result = resolveTenant("", mappings, FALLBACK);
    expect(result).toBe(FALLBACK);
  });

  it("skips inactive mappings and falls back", () => {
    // +918005556666 is mapped but inactive
    const result = resolveTenant("+918005556666", mappings, FALLBACK);
    expect(result).toBe(FALLBACK);
  });

  it("matches normalized numbers (spaces/dashes stripped)", () => {
    // The stored DID is "+918001112222", caller dials with formatting
    const result = resolveTenant("+91 800-111-2222", mappings, FALLBACK);
    expect(result).toBe(TENANT_A);
  });

  it("handles empty mappings list gracefully", () => {
    const result = resolveTenant("+918001112222", [], FALLBACK);
    expect(result).toBe(FALLBACK);
  });

  it("uses the provided default tenant ID (not a hardcoded value)", () => {
    const customFallback = "cccccccc-cccc-cccc-cccc-cccccccccccc";
    const result = resolveTenant("+919999999999", mappings, customFallback);
    expect(result).toBe(customFallback);
  });

  it("resolves correctly when multiple DIDs map to the same tenant", () => {
    const multiMappings: DidMapping[] = [
      { didNumber: "+911111111111", tenantId: TENANT_A, active: true },
      { didNumber: "+912222222222", tenantId: TENANT_A, active: true },
    ];
    expect(resolveTenant("+911111111111", multiMappings, FALLBACK)).toBe(TENANT_A);
    expect(resolveTenant("+912222222222", multiMappings, FALLBACK)).toBe(TENANT_A);
  });

  it("matches first active mapping when duplicates exist", () => {
    const dupes: DidMapping[] = [
      { didNumber: "+918001112222", tenantId: TENANT_A, active: true },
      { didNumber: "+918001112222", tenantId: TENANT_B, active: true },
    ];
    // First match wins
    expect(resolveTenant("+918001112222", dupes, FALLBACK)).toBe(TENANT_A);
  });
});

// ── DEFAULT_TENANT_ID ─────────────────────────────────────────────

describe("DEFAULT_TENANT_ID", () => {
  it("has a valid UUID fallback", () => {
    // Either from env or the hardcoded fallback
    expect(DEFAULT_TENANT_ID).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });
});

// ── CQRS validators + topics ──────────────────────────────────────

describe("DID mapping CQRS validators", () => {
  it("accepts a valid create body", () => {
    const body = createDidMappingBody.parse({ didNumber: "+918001112222", label: "Main line" });
    expect(body.active).toBe(true);
    expect(body.didNumber).toBe("+918001112222");
  });

  it("rejects invalid phone numbers in create body", () => {
    expect(() => createDidMappingBody.parse({ didNumber: "not-a-phone!!!" })).toThrow();
  });

  it("parses create command payload", () => {
    const id = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const tenantId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    const payload = createDidMappingPayload.parse({
      id,
      tenantId,
      didNumber: "+918001112222",
      label: null,
      active: true,
    });
    expect(payload.id).toBe(id);
  });

  it("parses delete command payload", () => {
    const id = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const tenantId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    expect(deleteDidMappingPayload.parse({ id, tenantId }).id).toBe(id);
  });
});

describe("DID mapping CQRS topics", () => {
  it("defines create and delete command topics", () => {
    expect(COMMANDS.createDidMapping).toBe("telephony.did.create");
    expect(COMMANDS.deleteDidMapping).toBe("telephony.did.delete");
  });
});

describe("DID mapping write-via-queue", () => {
  let queue: MemoryQueue;
  const published: Array<{ type: string; payload: Record<string, unknown> }> = [];

  beforeEach(() => {
    queue = new MemoryQueue();
    published.length = 0;
    queue.subscribe(COMMANDS.createDidMapping, async (msg) => {
      published.push({ type: msg.type, payload: msg.payload as Record<string, unknown> });
    });
    queue.subscribe(COMMANDS.deleteDidMapping, async (msg) => {
      published.push({ type: msg.type, payload: msg.payload as Record<string, unknown> });
    });
  });

  it("publishes createDidMapping to the queue", async () => {
    const tenantId = "11111111-aaaa-4000-8000-000000000001";
    const id = "22222222-bbbb-4000-8000-000000000002";
    await queue.publish(COMMANDS.createDidMapping, {
      messageId: id,
      type: COMMANDS.createDidMapping,
      tenantId,
      actorId: "00000000-aaaa-4000-8000-000000000001",
      correlationId: "c1",
      schemaVersion: "1.0",
      payload: { id, tenantId, didNumber: "+918001112222", label: null, active: true },
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(published).toHaveLength(1);
    expect(published[0]?.type).toBe("telephony.did.create");
    expect(published[0]?.payload.didNumber).toBe("+918001112222");
  });

  it("publishes deleteDidMapping to the queue", async () => {
    const tenantId = "11111111-aaaa-4000-8000-000000000001";
    const id = "22222222-bbbb-4000-8000-000000000002";
    const messageId = "33333333-cccc-4000-8000-000000000003";
    await queue.publish(COMMANDS.deleteDidMapping, {
      messageId,
      type: COMMANDS.deleteDidMapping,
      tenantId,
      actorId: "00000000-aaaa-4000-8000-000000000001",
      correlationId: "c2",
      schemaVersion: "1.0",
      payload: { id, tenantId },
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(published).toHaveLength(1);
    expect(published[0]?.type).toBe("telephony.did.delete");
    expect(published[0]?.payload.id).toBe(id);
  });
});
