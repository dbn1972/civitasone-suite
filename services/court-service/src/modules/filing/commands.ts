import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { deriveFilingId } from "./domain.js";
import { submitFilingBody, type SubmitFilingBody } from "./validators.js";

export type SubmitFilingResult = { accepted: true; filingId: string };

/** Submit a filing on a case (§12/§31). A case may have many filings, so the
 *  filing id is derived with a fresh random idempotencyKey per submit. */
export async function submitFiling(
  ctx: RequestContext, caseId: string, input: SubmitFilingBody,
): Promise<SubmitFilingResult> {
  const body = submitFilingBody.parse(input);
  const filingId = deriveFilingId(ctx.tenantId, caseId, body.filingType, randomUUID());

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
