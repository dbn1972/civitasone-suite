/**
 * UAT Phase 2 security review #2446 (3): the gateway must never proxy a
 * service's service-to-service route group. Every service mounts those under
 * an `internal` segment directly after its prefix (`/v1/<svc>/internal/...`,
 * or `/<svc>/internal/...` for the unversioned identity routes), reached via
 * the gateway as `/api/v1/<svc>/internal/...` or `/api/<svc>/internal/...`.
 *
 * Generic on purpose: a new internal route group is covered without editing
 * the gateway. Only the exact segment `internal` matches (e.g. a helpdesk
 * `internal-tickets` path is not blocked). `pathname` is the canonicalised
 * request path (path-guard has already decoded / collapsed it).
 */
const INTERNAL_SERVICE_PATH = /^\/api\/(?:v\d+\/)?[a-z0-9_-]+\/internal(?:\/|$)/i;

export function isInternalServicePath(pathname: string): boolean {
  return INTERNAL_SERVICE_PATH.test(pathname);
}
