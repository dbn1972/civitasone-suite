-- UAT FQ9 #31 (SECURITY): scrub raw device bearer tokens from the transactional outbox.
--
-- Until this fix, device-registry/consumer.ts put the RAW device bearer token into the payload of
-- `visitor.device.registered` (key `token`) and `visitor.device.credential_rotated` (key `token`)
-- outbox events. `_outbox.messages` keeps rows after relay until purge, so every device token ever
-- issued is readable by any role that can SELECT the outbox. The code no longer writes it; this
-- removes the key from rows already written.
--
-- Idempotent: `payload - 'token'` on a row without the key is a no-op, and the WHERE clause only
-- touches rows that still carry it, so re-running updates 0 rows. No other payload key is changed;
-- `credentialIssued: true` is added so these rows match the shape new events carry. No relayed
-- message can be recalled from the broker, and this does NOT invalidate the leaked tokens: after
-- applying it, ROTATE the credential of every bearer-token device registered/rotated before the fix
-- (POST /v1/visitor/devices/:deviceId/rotate-credential), because any token that sat in the outbox
-- must be treated as disclosed.
--
-- Rollback: none (the removed values are secrets that must not be restored).
UPDATE _outbox.messages
   SET payload = (payload - 'token') || jsonb_build_object('credentialIssued', true)
 WHERE topic IN ('visitor.device.registered', 'visitor.device.credential_rotated')
   AND payload ? 'token';
