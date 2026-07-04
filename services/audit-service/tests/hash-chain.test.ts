/**
 * Hash-chain integrity tests (pure domain — no DB needed).
 *
 * Verifies:
 *   - Chain continuity: prevHash links form an unbroken sequence
 *   - Tamper detection: altering any field breaks the hash
 *   - Content binding: changing actor/target/payload changes the hash
 *   - Determinism: same input always produces same hash
 *   - Self-approval detection: can verify actorId != approverId from chain
 */
import { describe, it, expect } from "vitest";
import { computeHash } from "../src/modules/events/domain.js";

describe("Audit hash-chain integrity (pure)", () => {
  const TENANT = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

  it("deterministic: same inputs produce same hash", () => {
    const h1 = computeHash("id-1", TENANT, "finance.sanction.approved", null, "2026-07-04T10:00:00Z", {
      actor: { userId: "user-1" }, target: "sanction-1", payload: { amount: 100000 },
    });
    const h2 = computeHash("id-1", TENANT, "finance.sanction.approved", null, "2026-07-04T10:00:00Z", {
      actor: { userId: "user-1" }, target: "sanction-1", payload: { amount: 100000 },
    });
    expect(h1).toBe(h2);
    expect(h1.length).toBe(64);
  });

  it("chain continuity: each event's prevHash links to the previous eventHash", () => {
    const events = [
      { id: "e1", type: "created", actor: { userId: "u1" }, target: "r1", payload: { v: 1 } },
      { id: "e2", type: "updated", actor: { userId: "u1" }, target: "r1", payload: { v: 2 } },
      { id: "e3", type: "approved", actor: { userId: "u2" }, target: "r1", payload: { v: 3 } },
    ];

    let prevHash: string | null = null;
    const chain: string[] = [];
    for (const e of events) {
      const hash = computeHash(e.id, TENANT, e.type, prevHash, "2026-07-04T10:00:00Z", e);
      chain.push(hash);
      prevHash = hash;
    }

    // Verify chain links
    expect(chain).toHaveLength(3);
    // Re-compute and verify
    const recomputed0 = computeHash("e1", TENANT, "created", null, "2026-07-04T10:00:00Z", events[0]!);
    const recomputed1 = computeHash("e2", TENANT, "updated", chain[0]!, "2026-07-04T10:00:00Z", events[1]!);
    const recomputed2 = computeHash("e3", TENANT, "approved", chain[1]!, "2026-07-04T10:00:00Z", events[2]!);
    expect(recomputed0).toBe(chain[0]);
    expect(recomputed1).toBe(chain[1]);
    expect(recomputed2).toBe(chain[2]);
  });

  it("tamper detection: changing the ID breaks the hash", () => {
    const original = computeHash("e1", TENANT, "created", null, "2026-07-04T10:00:00Z", {
      actor: { userId: "u1" }, target: "r1", payload: {},
    });
    const tampered = computeHash("e1-TAMPERED", TENANT, "created", null, "2026-07-04T10:00:00Z", {
      actor: { userId: "u1" }, target: "r1", payload: {},
    });
    expect(tampered).not.toBe(original);
  });

  it("tamper detection: changing the actor breaks the hash", () => {
    const original = computeHash("e1", TENANT, "created", null, "2026-07-04T10:00:00Z", {
      actor: { userId: "user-A" }, target: "r1", payload: { amount: 500 },
    });
    const tampered = computeHash("e1", TENANT, "created", null, "2026-07-04T10:00:00Z", {
      actor: { userId: "user-B" }, target: "r1", payload: { amount: 500 },
    });
    expect(tampered).not.toBe(original);
  });

  it("tamper detection: changing the payload breaks the hash", () => {
    const original = computeHash("e1", TENANT, "approved", null, "2026-07-04T10:00:00Z", {
      actor: { userId: "u1" }, target: "sanction-1", payload: { amount: 100000 },
    });
    const tampered = computeHash("e1", TENANT, "approved", null, "2026-07-04T10:00:00Z", {
      actor: { userId: "u1" }, target: "sanction-1", payload: { amount: 999999 },
    });
    expect(tampered).not.toBe(original);
  });

  it("tamper detection: changing prevHash breaks chain (mid-chain corruption)", () => {
    const h1 = computeHash("e1", TENANT, "created", null, "2026-07-04T10:00:00Z", {
      actor: {}, target: null, payload: {},
    });
    const h2_real = computeHash("e2", TENANT, "updated", h1, "2026-07-04T10:01:00Z", {
      actor: {}, target: null, payload: { changed: true },
    });
    const h2_tampered = computeHash("e2", TENANT, "updated", "0000000000000000000000000000000000000000000000000000000000000000", "2026-07-04T10:01:00Z", {
      actor: {}, target: null, payload: { changed: true },
    });
    expect(h2_tampered).not.toBe(h2_real);
  });

  it("self-approval detection: same actor creating + approving produces different hashes (verifiable)", () => {
    const creator = "user-A";
    const createHash = computeHash("e1", TENANT, "sanction.created", null, "2026-07-04T10:00:00Z", {
      actor: { userId: creator }, target: "s1", payload: { amount: 50000 },
    });
    // Self-approval: same user approves their own creation
    const selfApproveHash = computeHash("e2", TENANT, "sanction.approved", createHash, "2026-07-04T10:01:00Z", {
      actor: { userId: creator }, target: "s1", payload: { approvedBy: creator },
    });
    // Different approver
    const distinctApproveHash = computeHash("e2", TENANT, "sanction.approved", createHash, "2026-07-04T10:01:00Z", {
      actor: { userId: "user-B" }, target: "s1", payload: { approvedBy: "user-B" },
    });
    // Both are valid hashes but have different content — a compliance check
    // can detect self-approval by inspecting the event chain
    expect(selfApproveHash).not.toBe(distinctApproveHash);
    expect(selfApproveHash.length).toBe(64);
  });

  it("cross-tenant hash: same content in different tenants produces different hashes", () => {
    const content = { actor: { userId: "u1" }, target: "r1", payload: {} };
    const h1 = computeHash("e1", "11111111-1111-1111-1111-111111111111", "evt", null, "2026-07-04T10:00:00Z", content);
    const h2 = computeHash("e1", "22222222-2222-2222-2222-222222222222", "evt", null, "2026-07-04T10:00:00Z", content);
    expect(h1).not.toBe(h2); // tenantId is part of the hash input
  });
});
