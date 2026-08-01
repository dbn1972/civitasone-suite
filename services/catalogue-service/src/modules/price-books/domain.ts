/**
 * QP-002 — price book resolution. PURE, no I/O.
 *
 * MONEY RULE: amounts are `bigint` minor units (paise) everywhere in this file.
 * Nothing is ever converted to `number`. Comparisons use bigint operators so a
 * value above Number.MAX_SAFE_INTEGER (2^53 - 1) is compared exactly.
 */

export interface CandidateBook {
  id: string;
  segment: string;
  currency: string;
  geography: Record<string, unknown>;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  status: string;
}

export interface CandidateEntry {
  priceBookId: string;
  productId: string;
  amountMinor: bigint;
  currency: string;
}

export interface GeographyQuery {
  circleCode?: string | undefined;
  regionCode?: string | undefined;
  officeCode?: string | undefined;
}

/** Only active books within their effective window are eligible to price. */
export function bookIsEligible(book: CandidateBook, at: Date): boolean {
  if (book.status !== "active") return false;
  if (book.effectiveFrom.getTime() > at.getTime()) return false;
  if (book.effectiveTo !== null && book.effectiveTo.getTime() < at.getTime()) return false;
  return true;
}

/**
 * Geography specificity, mirroring the PC-004 weighting so the two resolvers
 * behave consistently: office (4) > region (2) > circle (1), empty = 0.
 * A book whose geography names a level that the query does not match is excluded.
 */
export function geographyMatch(
  geography: Record<string, unknown>,
  query: GeographyQuery,
): { matches: boolean; score: number } {
  const levels: ReadonlyArray<[string, number, string | undefined]> = [
    ["officeCode", 4, query.officeCode],
    ["regionCode", 2, query.regionCode],
    ["circleCode", 1, query.circleCode],
  ];
  let score = 0;
  for (const [key, weight, queryValue] of levels) {
    const bookValue = geography[key];
    if (bookValue === undefined || bookValue === null) continue; // wildcard
    if (typeof bookValue !== "string") return { matches: false, score: 0 };
    if (queryValue === undefined || bookValue !== queryValue) return { matches: false, score: 0 };
    score += weight;
  }
  return { matches: true, score };
}

export interface ResolvedPrice {
  priceBookId: string;
  productId: string;
  /** bigint minor units — the route serialises this with `.toString()`. */
  amountMinor: bigint;
  currency: string;
  /** Geography specificity of the winning book. */
  specificity: number;
}

/**
 * Resolve the effective price for a product in a segment + currency.
 *
 * Selection order:
 *   1. eligible books only (active + in effective window)
 *   2. exact segment and currency match
 *   3. geography must match the query (wildcards allowed)
 *   4. most geographically specific book wins
 *   5. tie-break on the later effectiveFrom (the most recently activated book)
 *   6. final tie-break on the LOWER amount, so a duplicate configuration never
 *      overcharges the customer
 *
 * Returns null when nothing prices the product.
 */
export function resolveEffectivePrice(
  books: readonly CandidateBook[],
  entries: readonly CandidateEntry[],
  params: { productId: string; segment: string; currency: string; geography?: GeographyQuery },
  at: Date = new Date(),
): ResolvedPrice | null {
  const query = params.geography ?? {};
  const eligible = new Map<string, { book: CandidateBook; score: number }>();

  for (const book of books) {
    if (book.segment !== params.segment) continue;
    if (book.currency !== params.currency) continue;
    if (!bookIsEligible(book, at)) continue;
    const geo = geographyMatch(book.geography, query);
    if (!geo.matches) continue;
    eligible.set(book.id, { book, score: geo.score });
  }
  if (eligible.size === 0) return null;

  let best: ResolvedPrice | null = null;
  let bestFrom = 0;

  for (const entry of entries) {
    if (entry.productId !== params.productId) continue;
    if (entry.currency !== params.currency) continue;
    const match = eligible.get(entry.priceBookId);
    if (!match) continue;

    const candidate: ResolvedPrice = {
      priceBookId: entry.priceBookId,
      productId: entry.productId,
      amountMinor: entry.amountMinor,
      currency: entry.currency,
      specificity: match.score,
    };
    const candidateFrom = match.book.effectiveFrom.getTime();

    if (best === null) {
      best = candidate;
      bestFrom = candidateFrom;
      continue;
    }
    if (candidate.specificity > best.specificity) {
      best = candidate;
      bestFrom = candidateFrom;
    } else if (candidate.specificity === best.specificity) {
      if (candidateFrom > bestFrom) {
        best = candidate;
        bestFrom = candidateFrom;
      } else if (candidateFrom === bestFrom && candidate.amountMinor < best.amountMinor) {
        // bigint comparison — exact even above 2^53.
        best = candidate;
      }
    }
  }

  return best;
}

/**
 * Compute tax on a bigint minor-unit amount from an integer basis-point rate
 * (QP-001 `taxRateBps`). Arithmetic is entirely in BigInt; the division
 * truncates toward zero, which is the conventional rounding for paise.
 */
export function taxOnAmountMinor(amountMinor: bigint, taxRateBps: number): bigint {
  if (!Number.isInteger(taxRateBps)) {
    throw new TypeError("taxRateBps must be an integer number of basis points");
  }
  return (amountMinor * BigInt(taxRateBps)) / 10000n;
}
