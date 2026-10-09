/**
 * GAP2-DOMAINS-NEW-07: there is NO `domains` backend today (no gateway
 * registry entry and no service serving POST /v1/domains), so a real
 * registration would 404 at the gateway. While this is false the form shows an
 * honest "not available" notice and disables Register; the full submit path
 * (POST, useFormError handling, route to /domains) is kept intact behind it so
 * that flipping this to true once the registration service exists re-enables
 * the original behaviour with no further code change.
 *
 * OPEN ITEM: flip to true when a `domains` gateway prefix -> service lands.
 */
export const DOMAIN_REGISTRATION_AVAILABLE = false;
