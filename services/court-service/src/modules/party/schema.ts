/**
 * party — no table of its own. This module reuses the EXISTING `court.case_parties`
 * table (migration 0001) declared as `caseParties` in ../case-registry/schema.ts.
 *
 * PII at rest (DPDP Act 2023): case_parties.name_enc / address_enc / phone_enc /
 * email_enc use the app-layer encryptedText() Drizzle type, so repo/query code
 * sees CLEARTEXT while the column at rest holds AES-256-GCM CIPHERTEXT.
 *
 * This thin re-export keeps party call sites importing from `./schema.js` while
 * the single canonical table definition stays in case-registry.
 */
export { caseParties, courtSchema } from "../case-registry/schema.js";
