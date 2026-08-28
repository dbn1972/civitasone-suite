import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { deriveFilingId, hashFilingContent } from "./domain.js";
import { submitFilingBody, type SubmitFilingBody } from "./validators.js";

export type SubmitFilingResult = { accepted: true; filingId: string };

/** Submit a filing on a case (§12/§31). The filing id is derived from a CONTENT
 *  hash of the submitted fields (hashFilingContent: filingType + fee amounts)
 *  rather than a fresh random value, so an identical resubmission — a client
 *  double-click or a network-timeout retry — reuses the same id and dedupes via
 *  the existing onConflictDoNothing insert instead of creating a second,
 *  fee-bearing row. See hashFilingContent's doc comment (domain.ts) for the
 *  accepted tradeoff against a deliberately-repeated, genuinely-distinct filing. */
export async function submitFiling(
  ctx: RequestContext, caseId: string, input: SubmitFilingBody,
): Promise<SubmitFilingResult> {
  const body = submitFilingBody.parse(input);
  const idempotencyKey = hashFilingContent(body.filingType, body.filingFeeMinor, body.courtFeeMinor);
  const filingId = deriveFilingId(ctx.tenantId, caseId, body.filingType, idempotencyKey);

  await queue.publish(COMMANDS.submitFiling, {
    messageId: filingId,
    type: COMMANDS.submitFiling,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    // BigInt → string: BigInt is not JSON-serialisable, so fee amounts cross the
    // queue wire as base-10 strings; the consumer decodes them back with parseMinor.
    payload: {
      ...body,
      filingFeeMinor: body.filingFeeMinor.toString(),
      courtFeeMinor: body.courtFeeMinor.toString(),
      id: filingId,
      caseId,
      tenantId: ctx.tenantId,
    },
  });

  return { accepted: true, filingId };
}
