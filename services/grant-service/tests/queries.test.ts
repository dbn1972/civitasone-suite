/**
 * Grant Service — application read-model projection.
 *
 * Source: modules/application/queries.ts
 *
 * Regression coverage for the bug where a withdrawn application (a real,
 * reachable DB status — see application.grant_applications' CHECK constraint
 * in migrations/0008_check_constraints_status_columns.sql, and
 * APPLICATION_STATUSES in modules/application/domain.ts) read back as
 * "active" on GET /v1/grants/grants and GET /v1/grants/applications, because
 * mapGrantStatus had no branch for it and fell through to the default.
 */
import { describe, it, expect } from "vitest";
import { mapGrantStatus } from "../src/modules/application/queries.js";

describe("mapGrantStatus", () => {
  it("maps approved to active (an approved application is a live, disbursing grant)", () => {
    expect(mapGrantStatus("approved")).toBe("active");
  });

  it("maps disbursing to active", () => {
    expect(mapGrantStatus("disbursing")).toBe("active");
  });

  it("maps completed to completed", () => {
    expect(mapGrantStatus("completed")).toBe("completed");
  });

  it("maps suspended to suspended", () => {
    expect(mapGrantStatus("suspended")).toBe("suspended");
  });

  it("maps rejected to cancelled", () => {
    expect(mapGrantStatus("rejected")).toBe("cancelled");
  });

  it("maps cancelled to cancelled", () => {
    expect(mapGrantStatus("cancelled")).toBe("cancelled");
  });

  // The bug: a real application.grant_applications.status value that used to
  // fall through to the "active" default instead of the terminal/negative
  // bucket it belongs in alongside rejected/cancelled.
  it("maps withdrawn to cancelled (regression: used to silently fall through to active)", () => {
    expect(mapGrantStatus("withdrawn")).toBe("cancelled");
  });

  // draft/submitted/under_review are genuinely pre-decision statuses with no
  // dedicated bucket in this reduced 4-value read model; they intentionally
  // still fall through to "active" ("still in play"). Locking that in here so
  // a future change to the default doesn't silently swallow withdrawn again.
  it("falls through pre-decision and unknown statuses to active", () => {
    expect(mapGrantStatus("draft")).toBe("active");
    expect(mapGrantStatus("submitted")).toBe("active");
    expect(mapGrantStatus("under_review")).toBe("active");
    expect(mapGrantStatus("some-future-status")).toBe("active");
  });
});
