import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { db } from "../../shared/db.js";
import { HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";

export async function createVerification(ctx: RequestContext, body: {
  verificationDate: string; notes?: string;
}) {
  const id = randomUUID();
  await db.transaction(async (tx) => {
    await repo.insertVerification(tx, {
      id, tenantId: ctx.tenantId, verificationDate: body.verificationDate,
      verifiedBy: ctx.actorId, status: "draft", notes: body.notes ?? null,
    });
  });
  return { id, status: "draft" };
}

export async function addVerificationItem(ctx: RequestContext, verificationId: string, body: {
  assetId: string; condition: string; foundAtLocation?: boolean; remarks?: string;
}) {
  const id = randomUUID();
  await db.transaction(async (tx) => {
    await repo.insertVerificationItem(tx, {
      id, verificationId, tenantId: ctx.tenantId, assetId: body.assetId,
      condition: body.condition, foundAtLocation: body.foundAtLocation ?? true,
      remarks: body.remarks ?? null,
    });
  });
  return { id };
}

export async function submitVerification(ctx: RequestContext, verificationId: string) {
  await db.transaction(async (tx) => {
    await repo.updateVerification(tx, verificationId, ctx.tenantId, { status: "submitted" });
  });
  return { id: verificationId, status: "submitted" };
}

export async function approveVerification(ctx: RequestContext, verificationId: string) {
  await db.transaction(async (tx) => {
    await repo.updateVerification(tx, verificationId, ctx.tenantId, {
      status: "approved", approvedBy: ctx.actorId, approvedAt: new Date(),
    });
  });
  return { id: verificationId, status: "approved" };
}

export async function requestWriteoff(ctx: RequestContext, assetId: string, remarks?: string) {
  const id = randomUUID();
  await db.transaction(async (tx) => {
    await repo.insertWriteoffRequest(tx, {
      id, tenantId: ctx.tenantId, assetId, requestedBy: ctx.actorId,
      status: "pending", committeeRemarks: remarks ?? null,
    });
  });
  return { id, status: "pending" };
}

export async function approveWriteoffRequest(ctx: RequestContext, requestId: string) {
  // P0-2 Segregation of Duties (GFR Rule 173): the approver must be a different
  // person than the requester. Self-approval of one's own write-off is rejected.
  const request = await repo.findWriteoffById(requestId, ctx.tenantId);
  if (!request) throw new HttpError(404, "NOT_FOUND", "writeoff request not found");
  if (request.status !== "pending") {
    throw new HttpError(409, "CONFLICT", `writeoff request is already ${request.status}`);
  }
  if (request.requestedBy === ctx.actorId) {
    throw new HttpError(403, "SELF_APPROVAL_FORBIDDEN", "approver must be different from requester (segregation of duties)");
  }
  await db.transaction(async (tx) => {
    await repo.approveWriteoff(tx, requestId, ctx.tenantId, ctx.actorId);
  });
  return { id: requestId, status: "approved" };
}
