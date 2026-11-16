/**
 * Section 8 NF-1: plain read endpoints that serialise a full ledger / opening-balance row must not grow a `fundId` key for a
 * tenant with no fund accounting (govt byte-identity). A NULL fund_id is dropped from the row; a real fund id is kept.
 */
export function omitNullFundId<T extends { fundId?: string | null }>(row: T): Omit<T, "fundId"> | T {
  if (row.fundId !== null && row.fundId !== undefined) return row;
  const { fundId: _drop, ...rest } = row;
  return rest;
}
