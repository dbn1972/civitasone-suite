/**
 * Unit tests for the PURE PC-001 / PC-002 state machines.
 * No DB, no Fastify — these functions must be deterministic and side-effect free.
 */
import { describe, it, expect } from "vitest";
import {
  PRODUCT_LIFECYCLE_STATES,
  INITIAL_LIFECYCLE_STATE,
  isProductLifecycleState,
  nextLifecycleStates,
  isTerminalLifecycleState,
  validateLifecycleTransition,
  isOpenForNewBusiness,
  // Pre-existing governed-lifecycle exports from the same module.
  GOVERNED_LIFECYCLE_STATUSES,
  isGovernedStatus,
  isValidGovernedTransition,
  validateGovernedTransition,
  canSubmit,
  canApprove,
  canReject,
} from "../src/modules/products/lifecycle-domain.js";
import {
  PRODUCT_VERSION_STATUSES,
  isProductVersionStatus,
  validateVersionTransition,
  checkMakerChecker,
  nextVersionNumber,
  MIN_REJECTION_REASON_LENGTH,
} from "../src/modules/products/version-domain.js";

// ═══════════════════════════════════════════════════════════════════════════════
// PC-002 — product lifecycle state machine
// ═══════════════════════════════════════════════════════════════════════════════
describe("PC-002 lifecycle state machine — state set matches migration 0004", () => {
  it("exposes exactly the CHECK allowlist from the migration", () => {
    expect([...PRODUCT_LIFECYCLE_STATES]).toEqual([
      "active",
      "sunset",
      "closed_to_new_business",
      "retired",
    ]);
  });

  it("recognises every allowed state and rejects invented ones", () => {
    for (const state of PRODUCT_LIFECYCLE_STATES) {
      expect(isProductLifecycleState(state)).toBe(true);
    }
    expect(isProductLifecycleState("withdrawn")).toBe(false);
    expect(isProductLifecycleState("draft")).toBe(false);
    expect(isProductLifecycleState("")).toBe(false);
  });

  it("starts a product with no history at the initial state only", () => {
    expect(INITIAL_LIFECYCLE_STATE).toBe("active");
    expect(validateLifecycleTransition(null, "active").valid).toBe(true);
    const bad = validateLifecycleTransition(null, "retired");
    expect(bad.valid).toBe(false);
    expect(bad.reason).toContain("must start at 'active'");
  });
});

describe("PC-002 lifecycle transitions", () => {
  it("allows active → sunset / closed_to_new_business / retired", () => {
    expect(validateLifecycleTransition("active", "sunset").valid).toBe(true);
    expect(validateLifecycleTransition("active", "closed_to_new_business").valid).toBe(true);
    expect(validateLifecycleTransition("active", "retired").valid).toBe(true);
  });

  it("allows a sunset announcement to be withdrawn back to active", () => {
    expect(validateLifecycleTransition("sunset", "active").valid).toBe(true);
  });

  it("rejects reopening a closed product", () => {
    const result = validateLifecycleTransition("closed_to_new_business", "active");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("Cannot transition lifecycle");
  });

  it("rejects every transition out of the terminal retired state", () => {
    for (const state of PRODUCT_LIFECYCLE_STATES) {
      if (state === "retired") continue;
      expect(validateLifecycleTransition("retired", state).valid).toBe(false);
    }
    expect(isTerminalLifecycleState("retired")).toBe(true);
    expect(isTerminalLifecycleState("active")).toBe(false);
    expect(isTerminalLifecycleState("nonsense")).toBe(false);
  });

  it("rejects a self-transition as a meaningless no-op", () => {
    const result = validateLifecycleTransition("active", "active");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("already in state");
  });

  it("rejects unknown source and target states", () => {
    expect(validateLifecycleTransition("bogus", "active").valid).toBe(false);
    expect(validateLifecycleTransition("active", "bogus").valid).toBe(false);
    expect(validateLifecycleTransition("active", "bogus").reason).toContain("Unknown target");
    expect(validateLifecycleTransition("bogus", "active").reason).toContain("Unknown current");
  });

  it("never advertises a next state that validate would then reject", () => {
    for (const from of PRODUCT_LIFECYCLE_STATES) {
      for (const to of nextLifecycleStates(from)) {
        expect(validateLifecycleTransition(from, to).valid).toBe(true);
      }
    }
  });

  it("advertises no next states for an unknown state", () => {
    expect(nextLifecycleStates("bogus")).toEqual([]);
  });

  it("treats only active and sunset as open for new business", () => {
    expect(isOpenForNewBusiness("active")).toBe(true);
    expect(isOpenForNewBusiness("sunset")).toBe(true);
    expect(isOpenForNewBusiness("closed_to_new_business")).toBe(false);
    expect(isOpenForNewBusiness("retired")).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PC-001 — product version state machine + maker-checker
// ═══════════════════════════════════════════════════════════════════════════════
describe("PC-001 version state machine — status set matches migration 0004", () => {
  it("exposes exactly the CHECK allowlist from the migration", () => {
    expect([...PRODUCT_VERSION_STATUSES]).toEqual([
      "draft",
      "pending_approval",
      "approved",
      "rejected",
    ]);
  });

  it("recognises allowed statuses only", () => {
    expect(isProductVersionStatus("draft")).toBe(true);
    expect(isProductVersionStatus("pending_approval")).toBe(true);
    expect(isProductVersionStatus("submitted")).toBe(false);
  });

  it("allows draft → pending_approval → approved", () => {
    expect(validateVersionTransition("draft", "pending_approval").valid).toBe(true);
    expect(validateVersionTransition("pending_approval", "approved").valid).toBe(true);
  });

  it("allows pending_approval → rejected and rework via rejected → pending_approval", () => {
    expect(validateVersionTransition("pending_approval", "rejected").valid).toBe(true);
    expect(validateVersionTransition("rejected", "pending_approval").valid).toBe(true);
  });

  it("rejects approving a draft directly (approval must follow submission)", () => {
    const result = validateVersionTransition("draft", "approved");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("Cannot transition version");
  });

  it("treats approved as terminal", () => {
    for (const to of PRODUCT_VERSION_STATUSES) {
      if (to === "approved") continue;
      expect(validateVersionTransition("approved", to).valid).toBe(false);
    }
  });

  it("rejects self-transitions and unknown statuses", () => {
    expect(validateVersionTransition("draft", "draft").valid).toBe(false);
    expect(validateVersionTransition("nope", "draft").valid).toBe(false);
    expect(validateVersionTransition("draft", "nope").valid).toBe(false);
  });
});

describe("PC-001 maker-checker rule", () => {
  const MAKER = "00000000-0000-4000-8000-00000000000a";
  const CHECKER = "00000000-0000-4000-8000-00000000000b";

  it("permits a different actor to check", () => {
    expect(checkMakerChecker(MAKER, CHECKER).valid).toBe(true);
  });

  it("forbids the maker from checking their own version", () => {
    const result = checkMakerChecker(MAKER, MAKER);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("Maker-checker violation");
  });

  it("requires a substantive rejection reason length", () => {
    expect(MIN_REJECTION_REASON_LENGTH).toBe(10);
  });
});

describe("PC-001 version numbering", () => {
  it("starts at 1 when a product has no versions", () => {
    expect(nextVersionNumber([])).toBe(1);
  });

  it("returns max + 1 regardless of input order or gaps", () => {
    expect(nextVersionNumber([1, 2, 3])).toBe(4);
    expect(nextVersionNumber([3, 1, 2])).toBe(4);
    expect(nextVersionNumber([1, 7])).toBe(8);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Pre-existing governed-lifecycle helpers in the same module.
// These were untested before this sprint; covered here because the module was
// touched. They model a SEPARATE governance workflow from the PC-002 state set
// above and are kept for backward compatibility.
// ═══════════════════════════════════════════════════════════════════════════════
describe("governed lifecycle helpers (pre-existing exports)", () => {
  it("recognises its own status set", () => {
    expect(isGovernedStatus("draft")).toBe(true);
    expect(isGovernedStatus("closed_to_new")).toBe(true);
    expect(isGovernedStatus("sunset")).toBe(false);
  });

  it("validates the submit → approve happy path", () => {
    expect(validateGovernedTransition("draft", "submitted").valid).toBe(true);
    expect(validateGovernedTransition("submitted", "approved").valid).toBe(true);
    expect(validateGovernedTransition("approved", "active").valid).toBe(true);
  });

  it("treats a self-transition as a no-op that is allowed", () => {
    expect(validateGovernedTransition("draft", "draft").valid).toBe(true);
  });

  it("rejects unknown source and target statuses", () => {
    expect(validateGovernedTransition("bogus", "draft").reason).toContain("Unknown current status");
    expect(validateGovernedTransition("draft", "bogus").reason).toContain("Unknown target status");
  });

  it("rejects a transition that is not in the map", () => {
    const result = validateGovernedTransition("draft", "active");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("Cannot transition from");
  });

  it("treats closed_to_new as terminal", () => {
    expect(isValidGovernedTransition("closed_to_new", "active")).toBe(false);
    expect(isValidGovernedTransition("bogus", "active")).toBe(false);
  });

  it("exposes canSubmit / canApprove / canReject guards", () => {
    expect(canSubmit("draft").valid).toBe(true);
    expect(canSubmit("approved").valid).toBe(false);
    expect(canApprove("submitted").valid).toBe(true);
    expect(canApprove("draft").valid).toBe(false);
    // Rejection sends a submitted item back to draft.
    expect(canReject("submitted").valid).toBe(true);
    expect(canReject("approved").valid).toBe(false);
  });

  it("lists every governed status", () => {
    expect(GOVERNED_LIFECYCLE_STATUSES).toContain("draft");
    expect(GOVERNED_LIFECYCLE_STATUSES).toContain("retired");
    expect(GOVERNED_LIFECYCLE_STATUSES).toHaveLength(7);
  });
});
