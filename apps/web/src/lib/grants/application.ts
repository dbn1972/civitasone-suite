/**
 * Grant-application review/decision actions (COMP-012).
 *
 * All five routes already exist and are validated server-side in
 * grant-service/src/modules/application/routes.ts:
 *   PATCH /v1/grants/applications/:id/assign-reviewer
 *   PATCH /v1/grants/applications/:id/score
 *   PATCH /v1/grants/applications/:id/approve
 *   PATCH /v1/grants/applications/:id/reject
 *   PATCH /v1/grants/applications/:id/withdraw
 *
 * grants/applications/[id]/page.tsx linked to `/grants/applications/:id/<action>`
 * sub-routes that were never built (dead links) instead of calling these. This
 * module is the client-side action layer the dialogs in ApplicationActions.tsx
 * call, following the crm/opportunity.ts + browserFetch convention (BFF proxy,
 * httpOnly session cookie, `code: message` error surfacing).
 */
import { browserFetch, errorMessageFromResponse } from "@/lib/api/browserClient";

export interface AssignReviewerRequest {
  reviewerRef: string;
  reviewerName?: string;
}

export interface ScoreApplicationRequest {
  reviewerRef: string;
  technicalScore: number;
  financialScore: number;
  recommendation?: string;
}

export interface ApproveApplicationRequest {
  /** Sanctioned amount, in minor units (paise). */
  amountApprovedMinor: number;
}

export interface RejectApplicationRequest {
  reason: string;
}

export interface WithdrawApplicationRequest {
  reason: string;
}

async function patchApplication(id: string, action: string, body: unknown): Promise<void> {
  const res = await browserFetch(`v1/grants/applications/${id}/${action}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await errorMessageFromResponse(res));
}

export function assignReviewer(id: string, req: AssignReviewerRequest): Promise<void> {
  return patchApplication(id, "assign-reviewer", req);
}

export function scoreApplication(id: string, req: ScoreApplicationRequest): Promise<void> {
  return patchApplication(id, "score", req);
}

export function approveApplication(id: string, req: ApproveApplicationRequest): Promise<void> {
  return patchApplication(id, "approve", req);
}

export function rejectApplication(id: string, req: RejectApplicationRequest): Promise<void> {
  return patchApplication(id, "reject", req);
}

export function withdrawApplication(id: string, req: WithdrawApplicationRequest): Promise<void> {
  return patchApplication(id, "withdraw", req);
}
