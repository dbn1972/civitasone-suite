/**
 * ml-assets-05 -- asset-service integrity guards (no database needed; the
 * repo and queue are mocked).
 *
 * - GAP-ASSETS-REGISTER-08: creating an asset with a code that already exists
 *   in the tenant is refused with 409 DUPLICATE_CODE and publishes nothing.
 * - GAP-ASSETS-VERIFICATION-07: a verification session is a one-way
 *   draft -> submitted -> approved lifecycle; out-of-order commands are 409.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RequestContext } from "@civitasone/types";

const publish = vi.fn(async () => undefined);
vi.mock("../src/shared/infra.js", () => ({ queue: { publish: (...a: unknown[]) => (publish as (...x: unknown[]) => unknown)(...a) } }));

const findAssetByCode = vi.fn();
vi.mock("../src/modules/register/repo.js", () => ({ findAssetByCode: (...a: unknown[]) => findAssetByCode(...a) }));

const findVerificationById = vi.fn();
vi.mock("../src/modules/verification/repo.js", () => ({
  findVerificationById: (...a: unknown[]) => findVerificationById(...a),
  findWriteoffById: vi.fn(),
}));

import { createAsset } from "../src/modules/register/commands.js";
import * as vcmd from "../src/modules/verification/commands.js";
import { assertVerificationTransition } from "../src/modules/verification/domain.js";
import { HttpError } from "../src/shared/context.js";
import type { CreateAssetBody } from "../src/modules/register/validators.js";

const ctx = { tenantId: "aaaaaaaa-5555-4000-8000-000000000005", actorId: "bbbbbbbb-5555-4000-8000-000000000005", correlationId: "c-1" } as unknown as RequestContext;
const SESSION = "dddddddd-5555-4000-8000-000000000005";

async function status(p: Promise<unknown>): Promise<number | null> {
  try { await p; return null; } catch (e) { return e instanceof HttpError ? e.status : -1; }
}

beforeEach(() => { publish.mockClear(); findAssetByCode.mockReset(); findVerificationById.mockReset(); });

describe("GAP-ASSETS-REGISTER-08 duplicate asset code", () => {
  const body = { name: "Jeep", code: "VEH/001", categoryId: "11111111-1111-4111-8111-111111111111", acquisitionCost: 100, acquisitionDate: "2026-01-01" } as unknown as CreateAssetBody;

  it("409s on an existing code and publishes nothing", async () => {
    findAssetByCode.mockResolvedValue({ id: "x" });
    expect(await status(createAsset(ctx, body))).toBe(409);
    expect(findAssetByCode).toHaveBeenCalledWith(ctx.tenantId, "VEH/001");
    expect(publish).not.toHaveBeenCalled();
  });

  it("accepts a new code", async () => {
    findAssetByCode.mockResolvedValue(null);
    const out = await createAsset(ctx, body);
    expect(out.status).toBe("accepted");
    expect(publish).toHaveBeenCalledOnce();
  });
});

describe("GAP-ASSETS-VERIFICATION-07 session lifecycle", () => {
  it("domain: only the allowed predecessor passes", () => {
    expect(() => assertVerificationTransition("draft", "add-item")).not.toThrow();
    expect(() => assertVerificationTransition("draft", "submit")).not.toThrow();
    expect(() => assertVerificationTransition("submitted", "approve")).not.toThrow();
    expect(() => assertVerificationTransition("approved", "add-item")).toThrow(HttpError);
    expect(() => assertVerificationTransition("approved", "submit")).toThrow(HttpError);
    expect(() => assertVerificationTransition("draft", "approve")).toThrow(HttpError);
    expect(() => assertVerificationTransition("submitted", "submit")).toThrow(HttpError);
  });

  it("an approved session rejects new items, re-submit and re-approve (409, nothing enqueued)", async () => {
    findVerificationById.mockResolvedValue({ id: SESSION, status: "approved" });
    const item = { assetId: SESSION, condition: "good" };
    expect(await status(vcmd.addVerificationItem(ctx, SESSION, item))).toBe(409);
    expect(await status(vcmd.submitVerification(ctx, SESSION))).toBe(409);
    expect(await status(vcmd.approveVerification(ctx, SESSION))).toBe(409);
    // only the rejection audits were published -- no domain command
    expect(publish.mock.calls.map((c) => (c as unknown[])[0])).toEqual(["audit.event.record", "audit.event.record", "audit.event.record"]);
  });

  it("a draft cannot be approved before it is submitted", async () => {
    findVerificationById.mockResolvedValue({ id: SESSION, status: "draft" });
    expect(await status(vcmd.approveVerification(ctx, SESSION))).toBe(409);
    expect((publish.mock.calls[0] as unknown[])[0]).toBe("audit.event.record");
    expect(JSON.stringify(publish.mock.calls[0])).toContain("verification_approve_rejected");
  });

  it("an unknown session is a 404", async () => {
    findVerificationById.mockResolvedValue(null);
    expect(await status(vcmd.submitVerification(ctx, SESSION))).toBe(404);
  });

  it("the happy path still enqueues", async () => {
    findVerificationById.mockResolvedValue({ id: SESSION, status: "draft" });
    await vcmd.addVerificationItem(ctx, SESSION, { assetId: SESSION, condition: "good" });
    await vcmd.submitVerification(ctx, SESSION);
    findVerificationById.mockResolvedValue({ id: SESSION, status: "submitted" });
    await vcmd.approveVerification(ctx, SESSION);
    expect(publish).toHaveBeenCalledTimes(3);
  });
});
