# Agenda notice period and recording a held meeting

## Agenda submission notice (how long before a meeting agenda proposals close)

Setting: `agenda.submission_deadline_days` (whole days, 0..365). Default **7**, the value that used to be hard-coded.

Resolution order for a meeting of committee `C` in tenant `T`:

1. committee override: config entry `meeting_policy_committee` / `agenda.submission_deadline_days.<committeeId>`
2. tenant setting: config entry `meeting_policy` / `agenda.submission_deadline_days`
3. default: 7

Both levels are ordinary config-registry entries, written with `POST /v1/meetings/config` (tenant_admin / super_admin), audited and versioned like every other setting, and removed with `PATCH /v1/meetings/config/:id/deactivate`. Writes are validated (400 for a negative, fractional, non-numeric or > 365 value; 404 for an override naming a committee that is not in the tenant). `GET /v1/meetings/committees/:committeeId/agenda-notice` returns the effective value and its source (`committee`, `tenant` or `default`).

A tenant or committee that has configured nothing behaves exactly as before: 7 days.

### Statutory minimum

The code encodes no statutory minimum for this setting (0 is allowed). The statutory notice of a **meeting** is a different rule and is unchanged: `meeting.notice_period_days` (default 0 = not enforced) is checked when a meeting is scheduled and a shorter notice is refused with `MEETING_SHORT_NOTICE` unless a waiver is recorded. A proposal that misses the agenda deadline still needs chairperson approval (`MEETING_PAST_DEADLINE`). A committee override cannot weaken either rule. A body with a statutory notice requirement should set `meeting.notice_period_days`.

## Recording a meeting that has already been held

`POST /v1/meetings/record-held` (202, `X-Idempotency-Key` required). Roles: `meeting_admin`, `tenant_admin`, `super_admin`, `admin`, or `committee_secretary` who is the meeting's named secretary or holds `secretary` standing on its committee.

Body: title, type, committeeId?, chairpersonId, secretaryId, `scheduledAt?` (defaults to `actualStartAt`), `actualStartAt`, `actualEndAt`, `attendees[]` (employeeId, role, status, mode, optional check-in/out), `minutes { content, templateType? }`, `quorumEstablished?` (only for a meeting without a committee; with a committee quorum is computed from the attendees against its rule).

Rules: every date-time must be in the past (400 otherwise, re-checked by the consumer), the end must follow the start, a sitting is at most 24 hours, the date may be at most `MEETING_RECORD_HELD_MAX_PAST_YEARS` (default 10) back, attendee check-in/out must lie within an hour of the sitting.

Effect, in one transaction: the meeting in `minutes_pending` with the real scheduled/actual times; participants and attendance records (method `manual`); a minutes **draft** (approved through the normal minutes flow); one transition-log row `draft -> minutes_pending`; an audit record `record_held`. No domain events, invitations or calendar entries are produced.

Numbering: the meeting number is allocated from the same gap-free counter as every other meeting, in the series of the financial year of the **held date** (a meeting held in 2025-26 is `<code>/2025-26/NNN`). All validations and the duplicate guard (`MEETING_ALREADY_RECORDED`: same committee, title and time) run before the allocation, in the same transaction as the insert, so a refused or failed recording consumes no number.
