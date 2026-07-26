# Runbook: meeting-service

> Tier 2. Follows the standard template in `docs/operations/SLO-SLI-RUNBOOKS.md` §5.
> SLO: 99.9% availability, p95 read < 300 ms, meeting lifecycle integrity (quorum enforcement, voting accuracy).

- **Purpose:** committee/board meeting governance — meeting creation/scheduling (single + series), committee management (constitution, membership, tenure, quorum rules), agenda item management, attendance recording (quorum enforcement), decision recording with downstream routing (project/legal/finance decisions trigger cross-service actions), minutes generation, action-item tracking, document management, voting (with configurable voting rules), video-conferencing integration, AI-assisted minute summarization, calendar integration, and config registry for meeting types/templates. Owns `civitas_meeting`. PII-encrypted (participant contact details). 15 modules covering the full governance meeting lifecycle.

- **Owner / escalation:** primary: Governance/Meeting Domain Owner. Secondary: SRE. Page on voting integrity failures or quorum enforcement bypass.

- **Dependencies:**
  - Own Postgres DB (`civitas_meeting`), RLS enabled, tenant-scoped. PII encrypted (participant contact info).
  - Redis — read-through cache for meeting status, committee membership, agenda, upcoming calendar.
  - SQS/RabbitMQ topics (`src/topics.ts`): commands for meeting CRUD/transition/cancel/series, committee CRUD/membership, agenda CRUD, attendance, decision record, minutes, action-item lifecycle, document, voting, VC-integration, AI-assist, meeting-type, config-registry; events for meeting lifecycle, committee changes, attendance marked, vote concluded, meeting completed, decisions.
  - Cross-service produces: `meeting.attendance.marked`, `meeting.vote.concluded`, `meeting.meeting.completed` (consumed by analytics-service for governance dashboards), `meeting.decision.legal` (consumed by legal-service for board decision triage), `meeting.decision.project` (consumed by project-service for board decision triage).
  - External: video-conferencing provider (Zoom/WebEx/custom — env-gated via `VC_PROVIDER`), AI summarization endpoint (env-gated via `AI_SUMMARY_ENABLED`).

- **Key dashboards:**
  - `/ops/*` (heartbeat, DLQ, consumer error rate, outbox relay).
  - Grafana: meetings by status (scheduled/in-progress/completed/cancelled), quorum achievement rate, action-item completion rate, decision routing (to legal/project/finance), voting participation rate.
  - Alert: meeting transition failure = WARN; quorum not met for statutory committee = WARN (meeting may be invalid); voting integrity check failure = CRITICAL.

- **Common failure modes → action:**
  - *Meeting start blocked (quorum not met)* → quorum is enforced at transition from `scheduled` → `in_progress`. If attendance is below the quorum threshold configured for the committee, the transition is rejected. This is correct behavior — verify attendance records are complete. If late attendees arrive, record their attendance and retry the transition.
  - *Series generation not materializing* → meeting series (recurring meetings) generate concrete instances via `meeting.series.generate`. If instances aren't appearing, check if the series has a valid pattern (dayOfWeek, dayOfMonth) and the generation window (startDate/endDate). The generate command is idempotent — safe to re-trigger.
  - *Decision routing to legal/project not working* → decisions with legal/project implications emit `meeting.decision.legal` or `meeting.decision.project`. If these events aren't arriving downstream, verify the decision record includes the correct routing tag. The consumer maps decision types to outbound events.
  - *Action-item deadlines not alerting* → action-items have due dates; alerts should fire via notification-service. If alerts stop, verify the scheduled sweep for overdue action-items is running.
  - *VC integration failing* → video-conferencing link generation is env-gated. If the VC provider API is down, meetings can proceed without VC (in-person). The VC link is informational, not blocking.
  - *AI summary quality poor* → AI summarization is advisory only and env-gated. If quality is unacceptable, disable via `AI_SUMMARY_ENABLED=false`. Minutes are always also manually editable.
  - *Voting result contested* → votes are recorded per participant with timestamp. The voting module enforces: (1) only eligible voters can vote, (2) one vote per member per motion, (3) voting closes at the configured threshold or time limit. If results are contested, the full vote log is available for audit.
  - *Committee membership tenure expired* → membership has a `tenureEnd` date. Expired memberships should auto-deactivate. If an expired member is still appearing as active, check the tenure sweep job.

- **Rollback:** redeploy previous image tag. Decisions and votes are immutable (legally binding governance records). Meeting transitions can only move forward (no rollback from completed to in-progress).

- **Recovery (RPO/RTO):** restore DB from ≤15-min backup; replay outbox. After restore: (1) verify no decisions were lost during the gap (decisions are the most critical output — they trigger cross-service workflows); (2) confirm voting records are intact; (3) re-generate any missing meeting-series instances for the next 30 days.
