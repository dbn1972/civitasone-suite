/**
 * Max journals the General Ledger page requests in one call. This is the
 * finance-service list endpoint's hard ceiling (listQuerySchema max 500); when
 * the response reaches it the page says the ledger is truncated instead of
 * claiming to show "all fiscal years" (GAP-FINANCE-ACCOUNTING-GENERAL-LEDGER-03).
 */
export const GL_JOURNAL_LIMIT = 500;
