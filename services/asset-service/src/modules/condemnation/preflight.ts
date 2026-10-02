import { HttpError } from "../../shared/context.js";

/**
 * GAP-ASSETS-CONDEMNATION-08: synchronous checks run by the routes BEFORE a
 * command is queued. The consumers still re-assert every rule inside their
 * transaction (that is the authority); these exist so a clerk gets an
 * immediate 403 / 409 / 422 instead of a 202 for a command that will be
 * silently rejected later. Pure -- the route reads the row and passes it in.
 */

type Versioned = { version: number };

function assertCurrentVersion(row: Versioned, sent: number, what: string): void {
  if (row.version !== sent) {
    throw new HttpError(409, "STALE_VERSION", `${what} was changed by someone else; reload it and try again`);
  }
}

export function preflightSubmitSurvey(survey: (Versioned & { status: string }) | undefined, sentVersion: number): void {
  if (!survey) throw new HttpError(404, "NOT_FOUND", "survey not found");
  assertCurrentVersion(survey, sentVersion, "the survey");
  if (survey.status !== "draft") throw new HttpError(409, "NOT_DRAFT", "the survey has already been submitted");
}

export function preflightApproveRecommendation(
  rec: (Versioned & { status: string; createdBy: string }) | undefined,
  actorId: string,
  sentVersion: number,
): void {
  if (!rec) throw new HttpError(404, "NOT_FOUND", "recommendation not found");
  // Maker-checker (GFR Rule 196): the approver may not be the creator.
  if (rec.createdBy === actorId) {
    throw new HttpError(403, "MAKER_CHECKER_VIOLATION", "the approver cannot be the person who created the recommendation");
  }
  assertCurrentVersion(rec, sentVersion, "the recommendation");
  if (rec.status !== "pending") throw new HttpError(409, "NOT_PENDING", "the recommendation is no longer pending");
}

export function preflightCompleteAuction(
  auction: (Versioned & { status: string; reserveValueMinor: bigint }) | undefined,
  body: { version: number; highestBidMinor: number },
): void {
  if (!auction) throw new HttpError(404, "NOT_FOUND", "auction not found");
  assertCurrentVersion(auction, body.version, "the auction");
  if (auction.status !== "pending") throw new HttpError(409, "NOT_PENDING", "the auction is not open");
  if (BigInt(body.highestBidMinor) < auction.reserveValueMinor) {
    throw new HttpError(422, "BID_BELOW_FLOOR", "the winning bid is below the auction reserve");
  }
}
