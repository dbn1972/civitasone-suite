/**
 * UAT follow-up (duplicate employee number): log-safe error serializer. The single
 * implementation lives in @civitasone/observability (shared with workflow-service and
 * meeting-service); see packages/observability/src/safe-error-log.ts.
 */
export { safeErr, isPostgresError, isUniqueViolation, SAFE_LOG_SERIALIZERS, type SafeErr } from "@civitasone/observability";
